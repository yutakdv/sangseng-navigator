# 04. ENV·API 키·파일데이터 준비 — ★ 개발 시작 전 필수 (발급 절차 상세)

> **★ = 유탁이 직접 준비.** API 활용신청 승인은 1~2일 걸릴 수 있으므로 **가장 먼저** 신청한다.
> 이 문서는 "어느 링크에서 → 무엇을 검색/클릭해서 → 어떤 값을 → 어디에 붙여넣는지"를 값 단위로 적는다.
> 승인 대기 중에는 목업 CSV로 파이프라인 골격을 먼저 만든다 (10 문서 Phase 0 Gate 참조).

## 0. 준비 순서 요약 (의존성 순)

1. data.go.kr 계정 → **오픈 API 3건 활용신청** (승인 대기 시작) — §1
2. 대기하는 동안: **파일데이터 3종 다운로드** → `data/raw/` — §2 (✅ 확보 완료)
3. Kakao REST 키 발급 (5분) — §3
4. LLM 키 발급 (5분) — §4
5. AWS CLI + SAM CLI 셋업 — §5
6. GitHub 초기 커밋 (현재 커밋 0개 — **커밋이 있어야 Vercel Import 가능**) + **FE 팀원
   콜라보레이터 초대** (Private 단계에서는 초대 없이 clone 불가) — 제출 시 Public 전환
   전제이므로 첫 커밋부터 키·개인정보 금지 (12 문서 §4)
7. Vercel 계정 + 레포 연결 — §6. **Import(연결)까지가 Phase 0** — Root Directory가
   `frontend/`라 첫 Deploy 성공은 F1 스캐폴딩 커밋 직후(Phase 1)에야 가능

---

## 1. 공공데이터포털 오픈 API — `DATA_GO_KR_API_KEY` ★

**한 계정의 인증키 하나로 3개 API를 모두 호출한다. 단, API별로 활용신청 승인이 각각 필요하다.**

### 1-1. 인증키 확인

| 단계 | 위치/행동 |
|---|---|
| 접속 | https://www.data.go.kr → 회원가입/로그인 |
| 키 확인 | 우상단 [마이페이지] → 좌측 [오픈API] → [인증키 발급현황] |
| 복사할 값 | **일반 인증키 (Decoding)** ← Encoding 키 아님 |
| 붙여넣을 곳 | `.env`의 `DATA_GO_KR_API_KEY=` |

> Decoding 키를 쓰는 이유: `requests`가 파라미터를 URL 인코딩하므로, 이미 인코딩된
> Encoding 키를 넣으면 이중 인코딩으로 `SERVICE_KEY_IS_NOT_REGISTERED` 오류가 난다.

### 1-2. 활용신청 3건 (각각 검색 → 상세 페이지 → [활용신청] 버튼)

| # | data.go.kr 검색어 | 데이터셋 제목 (오픈API 탭에서 선택) | 용도 |
|---|---|---|---|
| ① | `강원랜드 하이원포인트 가맹점` | (주)강원랜드_하이원포인트 가맹점 상세정보 | 가맹점명·주소 → 지오코딩·지도·위젯 |
| ② | `강원랜드 일자별 카지노 입장객` | (주)강원랜드_일자별 카지노 입장객 현황 | 지역 전환율 분모 |
| ③ | `소상공인시장진흥공단 상가` | 소상공인시장진흥공단_상가(상권)정보 | 업종·좌표 → 업종공백도·포화도 |

- [ ] ★ ①②③ 활용신청 완료 (활용목적: "공모전 출품용 데이터 분석" 등 자유 기재)
- [ ] ★ 승인 후: [마이페이지] → [오픈API] → [활용신청 현황] → 각 API 클릭 →
      **요청 URL(엔드포인트)·요청 파라미터·응답 예시**를 확인해 `pipeline/p2~p4` 스크립트
      상단 주석에 복사해 둔다 (승인 페이지의 명세가 정본 — 문서 추측 금지)
- [ ] 참고: 대부분의 data.go.kr API는 `pageNo`/`numOfRows` 페이징과 `_type=json`(또는
      `resultType=json`) 파라미터를 지원 — JSON 미지원(XML 전용)이면 `xmltodict`로 파싱 (06 문서 공통 원칙)

## 2. 파일데이터 3종 다운로드 → `data/raw/` ★

| # | 어디서 | 검색어 | 받을 파일 | 저장 경로 (이 이름 그대로) |
|---|---|---|---|---|
| ① | data.go.kr → **파일데이터** 탭 | `강원랜드 하이원포인트 사용현황` | (주)강원랜드_하이원포인트 사용현황 CSV | `data/raw/highone_point_usage.csv` |
| ② | data.go.kr → 파일데이터 탭 | `국세청 100대 생활업종` | 국세청_사업자현황(100대 생활업종) CSV | `data/raw/nts_biz_100.csv` |
| ③ | data.go.kr → 파일데이터 탭 | `국세청 사업자 존속연수` | 국세청_사업자현황(존속연수별) CSV | `data/raw/nts_biz_duration.csv` |

- [x] ★ 3종 확보 완료 — 캠프 배포본(`바이브코딩캠프_파일데이터/`)을 지정 경로·이름으로 복사함
      (원본 폴더는 .gitignore 처리, `data/raw/`가 커밋 정본):

```bash
cp "바이브코딩캠프_파일데이터/(주)강원랜드_하이원포인트 사용현황_20251231.csv" data/raw/highone_point_usage.csv
cp "바이브코딩캠프_파일데이터/국세청_사업자현황_100대 생활업종_20260430.csv"      data/raw/nts_biz_100.csv
cp "바이브코딩캠프_파일데이터/국세청_사업자현황_존속연수별_20260430.csv"          data/raw/nts_biz_duration.csv
```

- [x] ★ **헤더(1행) 실측 완료 (2026-08-03)** — 기획 가정과 일치 확인, COLMAP은 06 문서 P1에 반영됨:

| 파일 | 인코딩 | 실제 헤더 | 특이사항 |
|---|---|---|---|
| `highone_point_usage.csv` | cp949 | `가맹점 영업일자,업종,고한읍 건수,사북읍 건수,정선군 건수,태백시 건수,영월군 건수,삼척시 건수` | 기획 가정과 **정확히 일치**. 데이터 5,831행, 최신 월 2025-12 (전망·"최근 3개월"의 기준월) |
| `nts_biz_100.csv` | utf-8 (BOM) | `업종,시도,시군구,␣당월␣,␣전월␣,␣전년동월␣` (␣=공백 — 마지막 컬럼 끝에도 있음) | 수치 컬럼 3개 모두 **앞뒤 공백** → 로드 후 `df.columns.str.strip()` 필수. 전국 데이터 — **시도 리터럴은 `강원특별자치도`** (`"강원"` 완전일치 필터는 0행) |
| `nts_biz_duration.csv` | utf-8 (BOM) | `업태별,시도,시군구,존속연수별, (전체)당월 , (전체전월 , (전체전년동월 , (개인)당월 …` | **헤더 오염은 5·6번째 컬럼 2개**(`(전체전월`·`(전체전년동월` — 괄호 미닫힘), (개인)/(법인) 계열은 정상 → 안전하게 **위치 기반 매핑** 권장. 존속연수는 배타적 9구간(6개월 미만/6개월 이상/1년/2년/3년/5년/10년/20년/30년 이상) — **"2년 미만" = 6개월 미만+6개월 이상+1년 이상** (P7). 시도 리터럴 동일 주의 |

- [x] (해소) TASIS 폴백 불필요 — 파일 확보 완료

## 3. 지오코딩 키 — `KAKAO_REST_API_KEY` ★ (폴백: `VWORLD_API_KEY`)

**주의: 여기서 필요한 것은 Kakao "REST API 키"다.** 과거 발급 문제가 있었던 것은 웹사이트
도메인 등록이 필요한 JS SDK/모빌리티 계열이고, REST 키는 앱 생성만으로 즉시 발급된다.
지도 타일은 지오코딩과 무관하게 키가 전혀 필요 없다(MapLibre+OpenFreeMap — 02 문서).

| 단계 | 위치/행동 |
|---|---|
| 접속 | https://developers.kakao.com → 카카오 계정 로그인 |
| 앱 생성 | [내 애플리케이션] → [애플리케이션 추가하기] → 앱 이름 `sangseng-navigator`, 회사명 자유 |
| 키 복사 | 생성된 앱 클릭 → [앱 설정] > [앱 키] → **REST API 키** |
| ⚠ 서비스 활성화 | **[제품 설정] > [카카오맵] → 활성화(ON)** — 켜지 않으면 로컬 API 호출이 `NotAuthorizedError: disabled OPEN_MAP_AND_LOCAL service`로 거부됨 (2026-08-03 실측) |
| 붙여넣을 곳 | `.env`의 `KAKAO_REST_API_KEY=` |
| 사용 방식 | 파이프라인이 서버측 호출: `GET https://dapi.kakao.com/v2/local/search/address.json?query=<주소>` + 헤더 `Authorization: KakaoAK <키>` |

**폴백 — VWorld 지오코더** (Kakao가 어떤 이유로든 막힐 때):

| 단계 | 위치/행동 |
|---|---|
| 접속 | https://www.vworld.kr → 회원가입/로그인 |
| 키 신청 | 상단 [오픈API] → [인증키 발급] → 활용 URL에 `http://localhost` 입력 가능, 목적 자유 기재 |
| 키 복사 | 발급 완료 화면(또는 마이페이지 인증키 관리)의 인증키 |
| 붙여넣을 곳 | `.env`의 `VWORLD_API_KEY=` |
| 사용 방식 | `GET https://api.vworld.kr/req/address?service=address&request=getcoord&type=ROAD&address=<주소>&key=<키>` |

파이프라인의 `geocode(addr)` 함수가 Kakao → VWorld 순으로 시도한다 (06 문서 P3).

## 4. LLM 키 ★

### OpenAI (기본 provider)

| 단계 | 위치/행동 |
|---|---|
| 접속 | https://platform.openai.com → 로그인 |
| 결제 설정 | [Settings] > [Billing] → 결제수단 등록 + **최소 $5 크레딧 충전** (없으면 429 에러) |
| 키 생성 | https://platform.openai.com/api-keys → [Create new secret key] → 이름 자유 |
| 복사할 값 | 생성 직후 **한 번만 표시되는** `sk-...` 문자열 (창 닫기 전에 복사) |
| 붙여넣을 곳 | `.env`의 `OPENAI_API_KEY=` |

### Anthropic (전환용, 선택)

| 단계 | 위치/행동 |
|---|---|
| 접속 | https://console.anthropic.com → 로그인 |
| 키 생성 | [Settings] > [API keys] → [Create Key] |
| 복사할 값 | `sk-ant-...` 문자열 |
| 붙여넣을 곳 | `.env`의 `ANTHROPIC_API_KEY=` (그리고 `LLM_PROVIDER=anthropic`으로 변경 시 사용) |

## 5. AWS 셋업 ★

| 단계 | 위치/행동 |
|---|---|
| 액세스 키 발급 | https://console.aws.amazon.com → IAM → [사용자] → 본인 사용자 → [보안 자격 증명] 탭 → [액세스 키 만들기] → 용도 "CLI" 선택 |
| CLI 설정 | 터미널 `aws configure` → Access Key ID / Secret / 리전 `ap-northeast-2` / 출력 `json` |
| 확인 | `aws sts get-caller-identity` 가 계정 번호를 출력하면 성공 |
| SAM CLI | `brew install aws-sam-cli` → `sam --version` 확인 |
| CARDS_TABLE | 1차 배포(`infra/deploy-backend.sh`) 후 출력되는 Outputs의 `CardsTable` 값을 `.env`의 `CARDS_TABLE=`에 붙여넣기 |

> IAM 사용자 권한: 캠프 기간에는 `AdministratorAccess`로 진행해도 무방(개인 계정·기간 한정).
> 종료 후 액세스 키 비활성화.

## 6. Vercel ★

| 단계 | 위치/행동 |
|---|---|
| 가입 | https://vercel.com → **Continue with GitHub** (레포 접근 권한 부여) |
| 프로젝트 생성 | [Add New] > [Project] → 이 레포 선택 → **Root Directory를 `frontend`로 변경** → Deploy |
| 환경변수 | 프로젝트 [Settings] > [Environment Variables] → `NEXT_PUBLIC_API_BASE` = SAM Outputs의 `ApiUrl` (Production·Preview 모두 체크) → 저장 후 [Redeploy] |
| 확인 | 발급된 `https://<project>.vercel.app` 접속 |

## 7. FE 팀원 준비물

- [ ] **GitHub 콜라보레이터 초대 수락** — 유탁이 레포 Settings → Collaborators에서 초대
      (Private 단계에서는 초대 없이 clone·push 불가 — 이게 없으면 F1을 시작할 수 없다)
- [ ] Node.js 20+ / npm, 레포 clone 후 `cd frontend && npm install && npm run dev` 성공
- [ ] AWS 자격증명 **불필요** (FE는 mock 또는 배포된 API URL만 사용)
- [ ] `05-api-contract.md` 정독 + `08-frontend-tasks.md` 화면 목록 확인
- [ ] Vercel 팀원 초대(선택): 프로젝트 Settings → Members (Hobby는 개인 계정이라 초대 제한 —
      PR Preview URL 공유로 충분)

## 8. 발표 대응용 사전 조사 (코드 아님, 유탁)

- [ ] 하이원포인트 기존 약관·프로모션 이력 확인 — "페이백이 기존 제도와 중복 아니냐" 질문 대비
- [ ] 「**석탄산업전환지역** 개발 지원에 관한 특별법」 조문 확인 (https://www.law.go.kr 검색) —
      근거 법령 인용. 구 「폐광지역 개발 지원에 관한 특별법」이 개정된 것으로, 강원랜드·하이원
      공식 표기도 "석탄산업전환지역"이다 (맥락상 "폐광지역" 병기는 무방하나 단독 표기는 피한다)

## 9. 시크릿 취급 원칙

- **저장소는 제출 시 Public 전환된다** (12 문서). 커밋 "이력"에 한 번이라도 남은 키·개인정보는
  전환 순간 공개되므로, 아래 원칙은 처음 커밋부터 적용한다
- `기획서_V.I.B.E.pdf`는 대표자 휴대전화 번호 포함 — **커밋 금지** (.gitignore 등재됨)
- 코드·커밋·mock JSON에 API 키 절대 포함 금지 (.env만)
- Lambda로 올라가는 키는 LLM 키뿐 — SAM 파라미터(NoEcho)로 주입 (09 문서).
  공공데이터·지오코딩 키는 파이프라인(로컬)에서만 사용되므로 AWS에 올라가지 않는다
- 키가 실수로 커밋되면: 즉시 해당 키 재발급(로테이션) 후 이력 정리

## 10. 최종 체크리스트 (Phase 0 Gate)

- [ ] `.env`의 ★ 항목 전부 채워짐 (`DATA_GO_KR_API_KEY`, `KAKAO_REST_API_KEY`, `OPENAI_API_KEY`)
- [ ] 오픈 API 3건 활용신청 **승인** 상태 확인
- [x] `data/raw/` 3종 파일 존재 + COLMAP 채움 (§2 실측 완료)
- [ ] `aws sts get-caller-identity` / `sam --version` 성공
- [ ] Vercel 프로젝트 연결 + 빈 배포 성공
- [ ] GitHub 초기 커밋 완료 (`main`에 계획 문서·데이터 → 이후 `feat/*` 브랜치 규칙 적용)
