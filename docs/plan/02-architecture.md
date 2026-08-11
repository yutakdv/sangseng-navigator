# 02. 아키텍처 — 시스템 구조 + AWS 최소비용 배포

## 전체 구조

```
[개발 시점 · 배치 (유탁 로컬에서 실행)]
data/raw/*.csv (파일데이터) ─┐
공공데이터포털 오픈 API ──────┼─▶ pipeline/ (Python)
Kakao 지오코딩 API ──────────┘      │  집계·스코어링·지오코딩·민감도 분석
                                    ▼
                          data/processed/*.json  (커밋됨 = 재현 가능)
                                    │ (배포 시 backend/app/data/ 로 복사)
[런타임]                            ▼
사용자 ─▶ Vercel (Next.js, xxx.vercel.app)
   │                                │ fetch (NEXT_PUBLIC_API_BASE)
   └────────────────────────────────▶ API Gateway(HTTP API) ─▶ Lambda(FastAPI+Mangum)
                          [AWS ap-northeast-2]                   │        │
                                                        DynamoDB(cards)  LLM API
                                                                          (OpenAI/Claude)
```

## 핵심 설계 결정과 이유

| 결정 | 이유 |
|---|---|
| **파이프라인은 배치, 결과는 정적 JSON 커밋** | 공공데이터는 연간/저빈도 갱신이라 런타임 조회가 불필요. Lambda가 API 키 없이 파일만 읽으면 되고, FE mock도 같은 파일에서 나와 계약 불일치가 없다. 심사 때 "데이터 어디서 났나" 질문에 레포로 답변 가능 |
| **BE = Lambda + HTTP API** | 유휴 비용 0원. 데모 트래픽(수백 req)이면 프리티어로 $0. EC2/App Runner는 유휴 과금 발생 |
| **상태 저장 = DynamoDB 온디맨드 1테이블** | Action Card 승인/상태/타임스탬프만 저장(수십 건). 온디맨드라 유휴 $0, 프리티어 25GB. RDS는 과잉 |
| **FE = Vercel (Hobby 무료)** | git push 자동 배포 + PR별 Preview URL(2인 협업에 유용), Next.js 네이티브 지원이라 정적 export 제약(동적 라우트 등) 없음, https·CDN 기본 제공. AWS 쪽엔 순수 API 비용만 남는다 |
| **지도 = Kakao Maps JS 단일** | 카드 상세·방문객 위젯 모두 보유한 Kakao Maps JS 키를 쓰고(국내 지물 표기가 500m 축척에서 위치를 읽히게 한다), 키·도메인 문제에는 화면별 fallback을 둔다. MapLibre 구현은 원복용으로 보존 |
| **개발 중엔 DynamoDB Local(Docker), AWS 배포는 개발 완료 후 최종 1회** | (2026-08-03 변경) 개발 기간 AWS 의존 제거 — IAM 권한 이슈·비용·네트워크와 무관하게 로컬 완결 테스트. `docker compose up`으로 BE+DynamoDB Local 기동, `db.py`가 `DYNAMO_ENDPOINT` env로 분기 (14 문서 T7). 배포는 전체 개발 완료 후 09 문서 절차로 1회 |
| **LLM 어댑터 (openai↔anthropic 전환)** | 기획서에는 openAI API, MVP안에는 Claude로 명시가 갈림. `LLM_PROVIDER` env로 양쪽 지원해 발표 자료와 코드의 불일치 리스크 제거. 기본값 openai(`gpt-4o-mini`) — 제출된 기획서와 일치 + 비용 최소 |
| **IaC = AWS SAM** | 유탁이 AWS SAA/DVA 보유. 템플릿 1장으로 Lambda+API+DDB 재현 가능, 캠프에서 재배포 1분 |

## 비용 (월 기준, 데모+테스트 트래픽 — 상세는 09 문서 §3)

| 항목 | 과금 기준 | 예상 |
|---|---|---|
| Lambda | 상시 프리티어 월 100만 req + 40만 GB-s | **$0** |
| API Gateway (HTTP API) | 약 $1.2/100만 req(서울) · 12개월 프리티어 100만 | **$0** (프리티어 후에도 월 3만 req ≈ $0.04) |
| DynamoDB (온디맨드) | 쓰기 ~$1.6/100만, 읽기 ~$0.3/100만(서울) · 25GB 상시 무료 | **$0** (수천 req·KB 단위) |
| CloudWatch Logs · 데이터 전송 | 5GB / 100GB 상시 무료 | **$0** |
| **AWS 합계 (LLM 제외)** | | **사실상 $0, 최악 가정 < $1/월** |
| Vercel | Hobby 무료 (대역폭 100GB/월) | **$0** |
| LLM (참고) | gpt-4o-mini $0.15/$0.60 per 1M tok · claude-sonnet-5 $3/$15(인트로 $2/$10) | 데모 수백 호출 기준 수백 원~수천 원 |

비용 안전장치: 리전 `ap-northeast-2` 하나만 사용, 로그 보존 7일, Billing 알림 $1 설정,
종료 후 `sam delete` 한 번으로 AWS 완전 철거 (Vercel은 방치해도 $0).

## 지도 결정 — 카드 상세·방문객 위젯 모두 Kakao Maps JS

카드 상세의 지도(가맹점 핀 + 후보 마커 + 500m 반경 원)는 **2단계 스코어링 근거를 눈으로 보여주는
데모 핵심 장면**이라 유지할 가치가 크다.

> **갱신 이력**: 카드 상세는 원래 MapLibre GL + OpenFreeMap이었고(아래 표 그대로),
> 실제 화면을 띄워 본 뒤 **Kakao Maps JS로 교체**했다. 사유는 국내 배경 지도의 정보량이다 —
> OpenFreeMap은 이 지역에서 리 단위 지명과 도로만 나오고 라벨도 로마자가 앞에 오는 병기라
> ("Gohan 고한읍"), 정작 반경 500m 축척에서 "후보가 어디인지"가 읽히지 않았다.
> Kakao로 바꾸면 같은 축척에서 `상동읍사무소` 같은 지물이 잡혀 후보 위치가 즉시 읽힌다.
> **좌표·근거 계산은 그대로고 그리는 도구만 바뀐 것이다.**

| 후보 | 판정 | 이유 |
|---|---|---|
| **Kakao 지도 JS SDK** | ✅ 채택 (카드 상세 + 방문객 위젯) | 국내 지물·상호 표기가 촘촘해 500m 축척에서 위치가 읽힌다. 보유한 JS 키를 그대로 쓴다. 키·도메인 미등록 환경은 fallback으로 이어진다 |
| Leaflet + OSM 래스터 타일 | ❌ | Safari 렌더 출력 문제 경험 (DOM 타일 방식) |
| Naver 지도 | ❌ | NCP 가입 + 도메인 등록 필요 — 같은 계열 리스크 |
| MapLibre GL JS + OpenFreeMap | ⚠ 폴백으로 보존 | 키·도메인이 전혀 필요 없고 WebGL이라 Safari에 안정적이다. 다만 국내 지명 표기가 빈약해 주 구현에서 내렸다 |

- 사용법: Kakao Maps JS SDK를 `frontend/src/lib/kakaoMaps.ts`의 **공용 로더 하나**로 불러온다
  (카드 상세·방문객 위젯이 같은 스크립트를 공유 — 태그 중복·`window.kakao` 타입 분기 방지).
  키는 `NEXT_PUBLIC_KAKAO_MAP_KEY`(**JavaScript 키**, 지오코딩용 REST 키와 다름)이고
  Kakao 앱 [플랫폼]>[Web]에 배포 도메인이 등록돼 있어야 한다. 구현 태스크는 08 문서 F4
- 500m 반경 원은 `kakao.maps.Circle`이 미터 단위 반지름을 직접 받는다 — 다각형 근사 불필요
- 업종 점·거점·후보 핀은 data-URI SVG `MarkerImage`로 그린다. 업종×크기 조합당 이미지를
  **재사용**한다 — 읍당 가맹점이 최대 639곳(태백시)이라 마커마다 이미지를 만들면 그만큼 객체가 늘어난다
- **구현체 교체 지점은 한 줄**이다: `components/MapView.tsx`의 dynamic import 대상.
  Kakao에 문제가 생기면 보존해 둔 `MapViewClient`(MapLibre)로 되돌린다 —
  두 구현은 `components/MapViewTypes.ts`의 같은 props 계약을 쓴다
- **카드 상세 최종 폴백**: 그래도 렌더 문제가 나오면 지도를 자르고 "후보 지점 거리 표 + 정적 지도 캡처 이미지"로
  대체한다 (데모 서사는 유지됨). 방문객 위젯은 추천 좌표를 지도형 fallback에 찍고 카카오 길찾기로 연결한다.
- 저작자 표시: Kakao SDK가 지도 **왼쪽 아래**에 로고·축척을 직접 그린다. 화면 푸터 문구는
  `lib/constants.ts`의 `SOURCE_NOTE`, 출처 페이지는 `/data`의 "지도 · 외부 서비스" 항목
- 참고: 지오코딩(주소→좌표)은 지도 SDK와 무관한 **서버측 REST 호출**(파이프라인에서만 사용)이라
  이 결정의 영향을 받지 않는다 — 04 문서 참조

### 허브 히어로의 지역 진단 개념도 — 외부 지도 SDK 미사용

허브(`/`) 히어로의 "어디가 문제인가"는 6개 지역을 **한눈에** 보여주는 개관용 지도다. 카드 상세의
500m 반경 지도와 목적·정밀도가 달라 스택을 따로 판단한다.

| 항목 | 결정 |
|---|---|
| 스택 | DOM/CSS 기반 지역 배치 개념도(`RegionTileMap`) |
| 키 | 불필요 — 허브 로드마다 외부 지도 SDK를 호출하지 않는다 |
| 표기 | 실제 행정경계가 아니라 1단계 진단의 지역별 점수·비중을 보여주는 개념도라고 명시 |
| 색 | 1단계 진단 스코어의 인디고 밝기 램프(`scoreColor`) — 무지개 금지(13 §7) |

외부 지도 SDK는 카드 상세의 실제 위치 탐색용으로만 쓰고, 허브는 진단 서사에 필요한 개념도만
사용한다. 이렇게 하면 키 의존성이나 SDK 인증 실패가 첫 화면의 핵심 서사를 방해하지 않는다 —
지도가 Kakao 단일이 된 뒤에도 이 분리는 그대로다(허브는 여전히 키를 쓰지 않는다).

## 데이터 흐름 상세

1. **배치(파이프라인)** — 유탁 로컬에서 `python run_all.py` 실행:
   - CSV 파싱: 하이원포인트 사용현황(월×업종×6개 지역 건수), 국세청 사업자현황
   - API 수집: 카지노 입장객(일자별) → 월 합산, 가맹점 상세정보 → 주소, 소진공 상가(반경 조회)
   - 지오코딩: 가맹점 주소 → 좌표 (Kakao Local API)
   - 계산: 집중도·분산도·전환율·1단계 읍 스코어·2단계 후보 스코어·민감도 분석
   - 출력: `data/processed/*.json` (스키마는 05 문서)
2. **백엔드(런타임)** — 정적 JSON 로드 + DynamoDB CRUD + LLM 호출:
   - 진단/후보 데이터는 JSON 그대로 서빙 (계산 없음)
   - 카드 생성 시: 스코어 JSON + DDB의 추진상태/채택이력 → LLM → 카드 초안 → DDB 저장
   - 시뮬레이션: 집중도 재계산(순수 함수, JSON 입력) + LLM 설명
3. **프론트(런타임)** — `lib/api.ts` 래퍼 하나로 mock/실 API 전환. 카드 상세 지도는 MapLibre GL+OpenFreeMap,
   방문객 위젯 지도는 Kakao Maps JS+fallback이다.

## 보안·시크릿

- Lambda에 필요한 시크릿은 **LLM API 키뿐** (공공데이터 키는 파이프라인=로컬에서만 사용)
- SAM 파라미터(NoEcho)로 주입 → Lambda 환경변수. 캠프 수준에서 충분, 여유 있으면 SSM Parameter Store로 이전
- DynamoDB 권한은 SAM `DynamoDBCrudPolicy`로 해당 테이블에만 최소 부여
- CORS: 로컬 기본값은 `localhost`/`127.0.0.1`만 허용하고, 배포 기본값은 차단 오리진이다. 배포 시
  실제 프론트 오리진을 명시하며 `*`는 앱 시작 단계에서 거부한다 (09 문서)
- 인증·권한을 붙이기 전 공개 데모는 `DEMO_READ_ONLY=true`로 모든 mutation을 차단한다. mutation 라우트의
  공통 dependency가 이후 조직 사용자 인증과 RBAC를 연결할 경계이며, 임시 헤더 기반 가짜 인증은 두지 않는다
