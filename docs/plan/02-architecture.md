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
   └───────────▶ API Gateway(HTTP API) ─VPC Link─▶ 내부 ALB ─▶ ECS Fargate(FastAPI+uvicorn)
                          [AWS ap-northeast-2]                        │        │
                                                             DynamoDB(cards)  OpenAI API
```

## 핵심 설계 결정과 이유

| 결정 | 이유 |
|---|---|
| **파이프라인은 배치, 결과는 정적 JSON 커밋** | 공공데이터는 연간/저빈도 갱신이라 런타임 조회가 불필요. 서버가 API 키 없이 파일만 읽으면 되고, 산출물이 컨테이너 이미지에 그대로 실려 재현 가능하다. 심사 때 "데이터 어디서 났나" 질문에 레포로 답변 가능 |
| **BE = ECS Fargate + 내부 ALB + HTTP API(VPC Link)** | **배포 중 무중단**이 목적. 롤링 배포 + 대상그룹 드레이닝으로 진행 중 요청이 끊기지 않고, 상시 가동이라 콜드스타트가 없다. 대가는 ALB·Fargate 고정비(월 $30 수준, 09 §3) |
| **상태 저장 = DynamoDB 온디맨드 1테이블** | Action Card 승인/상태/타임스탬프만 저장(수십 건). 온디맨드라 유휴 $0, 프리티어 25GB. RDS는 과잉 |
| **FE = Vercel (Hobby 무료)** | git push 자동 배포 + PR별 Preview URL(2인 협업에 유용), Next.js 네이티브 지원이라 정적 export 제약(동적 라우트 등) 없음, https·CDN 기본 제공. AWS 쪽엔 순수 API 비용만 남는다 |
| **지도 = 화면별 분리** | 카드 상세는 MapLibre GL + OpenFreeMap으로 재현성을 확보하고, 방문객 위젯은 보유한 Kakao Maps JS 키를 활용하며 키·도메인 문제에는 지도형 fallback을 둔다 |
| **개발 중엔 DynamoDB Local(Docker), AWS 배포는 개발 완료 후 최종 1회** | (2026-08-03 변경) 개발 기간 AWS 의존 제거 — IAM 권한 이슈·비용·네트워크와 무관하게 로컬 완결 테스트. `docker compose up`으로 BE+DynamoDB Local 기동, `db.py`가 `DYNAMO_ENDPOINT` env로 분기 (14 문서 T7). 배포는 전체 개발 완료 후 09 문서 절차로 1회 |
| **LLM = OpenAI 단일 (`gpt-4o-mini`)** | 제출된 기획서와 일치 + 비용 최소. 초기에는 `LLM_PROVIDER` 로 Anthropic 도 택일할 수 있게 뒀으나 실제로 쓰지 않아 제거했다 — 값이 하나뿐인 스위치는 설정 표면만 늘린다 |
| **IaC = 순수 CloudFormation 2스택** | 수명이 다른 계층을 분리한다(`sangseng-foundation` = VPC·ECR·DynamoDB·IAM / `sangseng-service` = ALB·ECS·API GW). 코드만 바뀌면 service 만 갱신해 5분에 끝나고, 신규 툴체인이 0이다 |

## 비용 (월 기준, 데모+테스트 트래픽 — 상세는 09 문서 §3)

계정이 조직 소속이라 상시 무료 티어를 조직 전체가 공유한다 — **프리티어를 가정하지 않는다.**

| 항목 | 과금 기준 | 예상 |
|---|---|---|
| 내부 ALB 고정비 | $0.0225 / ALB-시간 | **$16.43** |
| Fargate ARM Spot ×2 (0.25 vCPU / 0.5 GB) | $0.011175 / vCPU-시간, $0.001227 / GB-시간 | **$4.98** |
| 퍼블릭 IPv4 ×2 | $0.005 / IP-시간 | **$7.30** |
| ALB LCU · CloudWatch Logs(7일) · ECR · API GW · DynamoDB | 데모 트래픽 기준 | ~$1.6 |
| VPC Link · DynamoDB Gateway Endpoint · SSM 표준 | 무과금 | **$0** |
| **AWS 합계 (LLM 제외)** | | **≈ $30 / 월, 상한 $42(온디맨드 기준)** |
| Vercel | Hobby 무료 (대역폭 100GB/월) | **$0** |
| LLM (참고) | gpt-4o-mini $0.15/$0.60 per 1M tok | 데모 수백 호출 기준 수백 원~수천 원 |

**절반 이상이 ALB 고정비다.** 그 대가로 배포 중 무중단과 콜드스타트 없는 상시 가용을 얻는다.

비용 안전장치: 리전 `ap-northeast-2` 하나만 사용, 로그 보존 7일, Billing 알림 설정,
종료 후 `./infra/scripts/teardown.sh` 로 AWS 철거 (Vercel은 방치해도 $0).

## 지도 결정 — 카드 상세는 MapLibre, 방문객 위젯은 Kakao Maps JS

카드 상세의 지도(가맹점 핀 + 후보 마커 + 500m 반경 원)는 **2단계 스코어링 근거를 눈으로 보여주는
데모 핵심 장면**이라 유지할 가치가 크다. 다만 스택은 과거 경험을 반영해 교체한다.

| 후보 | 판정 | 이유 |
|---|---|---|
| Kakao 지도 JS SDK | ✅ 방문객 위젯 | 실제 추천 가맹점 탐색에는 보유한 JS 키를 활용한다. 키·도메인 등록이 안 된 환경은 좌표 기반 지도형 fallback으로 이어진다 |
| Leaflet + OSM 래스터 타일 | ❌ | Safari 렌더 출력 문제 경험 (DOM 타일 방식) |
| Naver 지도 | ❌ | NCP 가입 + 도메인 등록 필요 — 같은 계열 리스크 |
| **MapLibre GL JS + OpenFreeMap** | ✅ 채택 | WebGL 캔버스 렌더라 Safari 지원 안정적. OpenFreeMap 타일은 **API 키·도메인 등록·가입 전부 불필요**(스타일 URL만 사용), 무료. 오픈소스(Mapbox GL 포크) |

- 사용법: `maplibre-gl` npm 패키지 + 스타일 `https://tiles.openfreemap.org/styles/liberty`,
  OpenStreetMap 저작자 표시(attribution) 유지. 구현 태스크는 08 문서 F4
- 500m 반경 원은 GeoJSON polygon(원 근사 64각형)을 fill 레이어로 그린다 — 플러그인 불필요
- **카드 상세 최종 폴백**: 그래도 렌더 문제가 나오면 지도를 자르고 "후보 지점 거리 표 + 정적 지도 캡처 이미지"로
  대체한다 (데모 서사는 유지됨). 방문객 위젯은 추천 좌표를 지도형 fallback에 찍고 카카오 길찾기로 연결한다.
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

MapLibre는 카드 상세의 실제 위치 탐색용으로 유지하고, 허브는 진단 서사에 필요한 개념도만
사용한다. 이렇게 하면 키 의존성이나 SDK 인증 실패가 첫 화면의 핵심 서사를 방해하지 않는다.

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

- 컨테이너에 필요한 시크릿은 **LLM API 키와 변경 API 토큰뿐** (공공데이터 키는 파이프라인=로컬에서만 사용)
- **SSM Parameter Store SecureString** 으로만 주입한다 — CloudFormation 템플릿·스택 이벤트·태스크 정의
  어디에도 값이 남지 않는다. 태스크 실행 역할에 `ssm:GetParameters` 를 명시로 부여한다
  (`AmazonECSTaskExecutionRolePolicy` 에 포함되지 않아 누락 시 로그 없이 죽는다)
- DynamoDB 권한은 태스크 역할 인라인 정책으로 **해당 테이블·인덱스에만** 최소 부여
- **네트워크 경계**: ALB 는 `scheme: internal` 이라 인터넷에서 닿지 않고, 진입은 API Gateway 뿐이다.
  태스크 SG 는 ALB SG 출처 8000 포트만 허용한다
- CORS: 모든 호출이 Vercel 서버에서 오는 **서버-대-서버**라 브라우저 프리플라이트가 없다.
  그래도 앱의 `ALLOWED_ORIGINS` 는 배포 기본값이 빈 목록이고 `*` 는 앱 시작 단계에서 거부한다 (09 §5)
- 인증·권한을 붙이기 전 공개 데모는 `DEMO_READ_ONLY=true`로 모든 mutation을 차단한다. mutation 라우트의
  공통 dependency가 이후 조직 사용자 인증과 RBAC를 연결할 경계이며, 임시 헤더 기반 가짜 인증은 두지 않는다
