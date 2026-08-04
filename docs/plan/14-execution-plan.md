# 14. 실행 계획 — 잔여 개발 전체 태스크 런북 (2026-08-03 기준)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development(권장) 또는
> superpowers:executing-plans로 태스크 단위 실행. 단계는 체크박스로 추적한다.
> 계산식·API 계약·코드 원문은 05~09 문서가 정본 — 이 문서는 **실행 순서와 절차**를 규정한다.
> 코드가 이미 계획 문서에 원문으로 존재하는 태스크는 해당 섹션을 "그대로 사용"으로 지시한다.
> ⚠ **착수 전 [15-plan-review.md](15-plan-review.md) 확인** — 배포 블로커 2건(§3)은 착수 첫 커밋에서
> 수정하고, 계약 공백 3건(§4)은 해당 태스크 진입 시 05 문서부터 수정한다 (반영 시점표: 15 §8).

**Goal:** 데이터포털 키 입력(내일) 이후부터 제출까지, 남은 전 태스크를 막힘 없이 순서대로 완주한다.

**Architecture:** 파이프라인(venv 네이티브) → 정적 JSON → BE는 **Docker(BE+DynamoDB Local)로 테스트**
→ 전체 완성 후 **AWS 배포는 최종 1회**(09 §4) → Vercel 연결 → 리허설 → 제출.

**Tech:** 기존 스택 (docs/plan/README) + `docker compose` (DynamoDB Local 2.x, python:3.12-slim).

## Global Constraints (모든 태스크 공통 — docs/plan/README 제약에 추가)

- **개발 중 AWS 배포 금지** — 테스트는 전부 Docker/로컬. `sam deploy`는 T17에서만
- **Claude 저자 표기 금지** — 커밋 트레일러·PR 푸터에 Co-Authored-By/Generated 문구 넣지 않음 (CLAUDE.md)
- 브랜치 규칙: 태스크(또는 인접 태스크 묶음)마다 `feat/<이름>-<주제>` → PR → 스모크 확인 후 셀프 머지 가능 (03 §협업)
- 파이프라인 실행은 항상 `.venv`(Python 3.12): `source .venv/bin/activate` 후 `cd pipeline`
- LLM 실호출 태스크(T10~T13)는 `gpt-4o-mini` 고정, 호출부 5초 타임아웃+규칙 기반 fallback (05 §8)
- 모델·effort: 표기 없는 태스크는 Opus high급 루틴, **[xhigh]** 표기는 Fable xhigh 권장 (README 매핑)

## 현재 상태 (완료분 — 재작업 금지)

| 완료 | 내용 |
|---|---|
| Phase 0 | CSV 3종 `data/raw/` 커밋, COLMAP 실측 확정, OpenAI 키 검증, Kakao 키+카카오맵 활성화 검증(사북읍 주소 → 37.2267/128.8164), GitHub 초기 커밋·push |
| Phase 1 | backend 골격(`/api/health` 스모크 통과), infra SAM 템플릿(`sam validate`·`build` 통과), pipeline 골격 |
| Phase 2 일부 | **P1**(usage_monthly.json — 12개월×18업종 507,628건, 정선군=잔여지역 판정) · **P7**(risk_signal.json — 4개 시군구 14.6~15.1%) — 멀티에이전트 독립 재계산 검증 통과 |
| 보류 | AWS 배포(IAM 권한 — T17 Step 1에서 해소), Vercel 연결(frontend 생성 후 — T15/T17) |

## 실행 순서 (의존성)

```
[내일 아침] T0 키 입력·승인 확인
   ├─▶ T1 P2 입장객 ─▶ T4 P5 진단지표(+05 계약 확장) ─▶ T5 P6 스코어링 ─▶ T6 P8 민감도
   ├─▶ T2 P3 가맹점·지오코딩 ─┬▶ T5
   └─▶ T3 P4 소진공·업종매핑 ─┘
[오늘부터 가능] T7 Docker 환경 ─▶ T8 B1 ─▶ T9 B2 ─▶ T10 B3 ─▶ T11 B4 ─▶ T12 B5 ─▶ T13 B6 ─▶ T14 B7
[FE 병렬]      T15 F1~F9 (mock 기반 — BE와 무관하게 진행)
[전부 완료 후] T16 로컬 풀루프 ─▶ T17 AWS 최종 배포 ─▶ T18 제출
```

---

### T0. 데이터포털 키 입력·승인 확인 (유탁, 5분)

- [ ] `.env`의 `DATA_GO_KR_API_KEY=`에 **Decoding 키** 입력 (특수문자 있으면 따옴표 — .env.example 상단)
- [ ] data.go.kr [마이페이지]→[활용신청 현황]에서 3건(가맹점 상세정보/일자별 카지노 입장객/소진공 상가) **승인** 확인
- [ ] 각 API 상세에서 **요청 URL·파라미터·응답 예시**를 복사해 `pipeline/p2~p4` 작성 시 상단 주석에 붙일 준비
      (승인 페이지 명세가 정본 — 문서 추측 금지, 04 §1-2)
- **검증:** 아래 한 줄이 JSON/XML 정상 응답 (엔드포인트는 승인 페이지 값으로 교체):
  `curl -sG "<입장객API URL>" --data-urlencode "serviceKey=$DATA_GO_KR_API_KEY" --data-urlencode "numOfRows=1"`

### T1. P2 카지노 입장객 (`pipeline/p2_visitors.py`)

**Files:** Create `pipeline/p2_visitors.py` / Modify `data/processed/usage_monthly.json`(병합)
**Interfaces:** `usage_monthly.json`에 `visitors_monthly: {"2025-01": 385200, ...}` 채움 — T4(P5)의 전환율 분모

- [ ] 스크립트 골격: 승인 페이지 명세를 상단 주석으로 → `data/raw/api_cache/visitors.json` 캐시 우선
      (`--refresh`로만 재호출), 페이징 `totalCount` 완주, `_type=json` 미지원 시 `xmltodict` (06 공통 원칙 1·2)
- [ ] 내국인+외국인 합산 → 월별 합계 → **usage_monthly.json의 월 구간(2025-01~12)과 겹치는 월만** 병합
      (06 공통 원칙 4 — 분자·분모 기간 정합). 겹치는 월이 12개 미만이면 그 사실을 stdout에 명시
- [ ] 재시도 3회 후 명확한 에러로 중단 (silent 실패 금지)
- **검증:** `python p2_visitors.py` 후
  `python -c "import json;d=json.load(open('../data/processed/usage_monthly.json'));v=d['visitors_monthly'];print(len(v), min(v.values()), max(v.values()))"`
  — 월별 값이 수만~수십만 범위
- **커밋:** `feat: P2 카지노 입장객 수집·월합산` + `data: visitors_monthly 병합`

### T2. P3 가맹점 상세정보 + 지오코딩 (`pipeline/p3_merchants.py`)

**Files:** Create `pipeline/p3_merchants.py` / Create `data/processed/merchants.json`
**Interfaces:** `merchants.json` = 05 §1 `merchants` 배열 스키마 `[{"name","category","eup","lat","lng"}]` — T5·B6 소비

- [ ] 가맹점 API 페이징 완주 → `api_cache/merchants_raw.json` (커밋 대상)
- [ ] `geocode(addr) -> (lat, lng) | None`: Kakao 우선(헤더 `Authorization: KakaoAK`, 0.1초 간격) →
      실패 시 VWorld 폴백. 캐시 `api_cache/geocode.json` **(.gitignore — 커밋 금지, 06 공통 원칙 1 예외)**
- [ ] 주소 문자열에서 읍면동 추출로 `eup` 부여 (REGIONS 6종 외 지역은 `기타`로 두고 카운트 출력)
- [ ] 좌표 유효성 가드(위도 36.5~38.5/경도 127.5~129.5 밖 폐기+로그), 실패분 `geocode_failed` 기록
- **검증:** 성공률 ≥90% stdout 확인, `merchants.json` 샘플 3건 좌표를 지도(geojson.io)로 눈 확인
- **커밋:** `feat: P3 가맹점 수집+지오코딩(Kakao→VWorld 폴백)` + `data: merchants.json`

### T3. P4 소진공 상가 + 업종 매핑 (`pipeline/p4_stores.py`, `pipeline/category_map.py`)

**Files:** Create `pipeline/p4_stores.py`, `pipeline/category_map.py` / Create `data/raw/api_cache/stores_<읍>.json`
**Interfaces:** `category_map.py`의 `CATEGORY_MAP: dict[str, str]`(하이원 업종→소진공 대분류)와
`load_stores(eup) -> list[{"name","lcls","lat","lng"}]` — T5(P6)가 소비

- [ ] 수집: PublicDataReader 소상공인 모듈 시도 → 실패 시 직접 호출(`storeListInDong` 우선,
      행정동 코드 번거로우면 `storeListInRectangle`) — 승인 페이지 명세 기준 (06 P4)
- [ ] **업종 매핑 표 작성 절차:** ① `usage_monthly.json`의 `categories` 18종 출력 ② 소진공 응답의
      `indsLclsNm` unique 출력 ③ 둘을 나란히 놓고 `CATEGORY_MAP` dict 작성 — 매핑 불가 업종은
      `EXCLUDED = [...]`에 명시(발표 답변 소재). 두 목록을 코드 주석에 박제
- [ ] 읍 단위 일괄 수집·캐시 후 반경 필터는 로컬 haversine (호출 폭발 방지 — 06 P4 전략)
- **검증:** 선정 후보 읍 중심 반경 500m 내 상가 수 > 0 확인 스니펫 실행
- **커밋:** `feat: P4 소진공 상가 수집 + 업종 매핑 표` + `data: stores 캐시`

### T4. 05 계약 확장 + P5 진단 지표 (`pipeline/p5_metrics.py`)

**Files:** Modify `docs/plan/05-api-contract.md` §1 → Create `pipeline/p5_metrics.py` → Create `data/processed/dashboard.json`

- [ ] **계약 먼저 (03 §협업 규칙 2 절차):** 05 §1 dashboard 스키마에 13 §10 확정분 3필드 추가 —
      `category_share: [{"category","count","share"}]`(업종 도넛), `growth.qoq_pp`(전분기 대비 %p),
      `ai_stability: 88 | null`(= sensitivity top3_stable_ratio×100, P8 전이면 null) → **FE 팀원에게 공유**
      → `frontend/src/mocks/dashboard.json` 갱신은 FE가 수행
- [ ] P5 구현: `usage_monthly.json` 입력 → 월별 지역 소비 집중도(`gini`→`gini_to_index`→`grade`),
      업종 분산도(`hhi_dispersion_index`), 지역 비중, 전환율(지역 건수 합÷`visitors_monthly`×100,
      `is_proxy: true` 고정), `growth`(mom·qoq — **기준월 = 데이터 최신 월 2025-12**, 06 공통 원칙 3),
      `period_note`에 기준월 명시 → 05 §1 스키마 그대로 저장
- **검증:** `python p5_metrics.py` 후 dashboard.json을 FE mock에 복사 → FE 대시보드 렌더 크로스체크
  (FE 미완이면 `python -m json.tool` + 필드 전수 육안 대조)
- **커밋:** `docs: 05 dashboard 계약 3필드 확장` / `feat: P5 진단 지표` / `data: dashboard.json`

### T5. P6 1·2단계 스코어링 (`pipeline/p6_scoring.py`) **[xhigh]**

**Files:** Create `pipeline/p6_scoring.py` / Create `data/processed/eup_scores.json`, `data/processed/candidates.json`
**Interfaces:** 05 §1 `eup_ranking`/`selected_eups`/`candidates` 스키마 그대로 — B1·B4가 소비

- [ ] 1단계(읍 단위 데이터만): 06 P6 주석 산식 그대로 — 소비저조도(0~1 클리핑)·소비증감(min-max) →
      `EUP_WEIGHTS` 가중합 → 상위 1~2읍 `selected_eups`. 기준월을 JSON에 기록
- [ ] 2단계(선정 읍 내부, 좌표 데이터만): 업종공백도·관광동선근접도(ANCHOR 거리 역수 정규화)·
      기존가맹포화도 → `CAND_WEIGHTS` 가중합 → 업종별 대표 후보 → 상위 5개
- [ ] **1·2단계 데이터가 한 수식에 섞이지 않음을 코드 리뷰로 확인** (절대 규칙 — 함수도 파일 내 분리)
- [ ] 예외: 선정 읍 후보 0개면 차순위 읍 자동 재시도 + 로그
- **검증:** 상위 후보 좌표를 geojson.io에 찍어 사북/고한 일대인지 눈 확인, 멀티에이전트 독립 재계산
  검증 1회(P1 방식과 동일) 권장
- **커밋:** `feat: P6 2단계 스코어링` + `data: eup_scores·candidates`

### T6. P8 가중치 민감도 (`pipeline/p8_sensitivity.py`) — 컷 2순위

- [ ] 06 P8 격자 그대로 재계산 → `sensitivity.json` `{"combos","top3_stable_ratio","detail"}`
- [ ] `top3_stable_ratio`를 T4의 `ai_stability`로 dashboard.json에 반영 (P5 재실행)
- **검증:** ratio 0~1, 슬라이드 1장 소재 확보. **커밋:** `feat: P8 민감도 분석` + `data:`

### T7. Docker 테스트 환경 (오늘부터 가능 — BE 트랙 전제) 

**Files:** Create `docker-compose.yml`(루트), `backend/Dockerfile`, `backend/local_init.py` / Modify `.gitignore`(불필요 — 기존 규칙으로 충분)

- [ ] `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] `docker-compose.yml` (루트):

```yaml
services:
  dynamodb:
    image: amazon/dynamodb-local:latest
    command: -jar DynamoDBLocal.jar -inMemory -sharedDb
    ports: ["8001:8000"]
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: .env
    environment:
      DYNAMO_ENDPOINT: http://dynamodb:8000
      CARDS_TABLE: sangseng-cards
      AWS_ACCESS_KEY_ID: local          # DynamoDB Local은 자격증명 "형식"만 요구
      AWS_SECRET_ACCESS_KEY: local
      AWS_DEFAULT_REGION: ap-northeast-2
    volumes:
      - ./backend/app:/app/app                    # 코드 핫리로드
      - ./data/processed:/app/app/data:ro         # Lambda 번들과 동일 경로에 정적 JSON
    depends_on: [dynamodb]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

- [ ] `backend/local_init.py` — 로컬 테이블 생성(멱등):

```python
"""DynamoDB Local에 cards 테이블 생성 (호스트에서: DYNAMO_ENDPOINT=http://localhost:8001 python local_init.py)"""
import os
import boto3

ddb = boto3.resource("dynamodb", endpoint_url=os.environ.get("DYNAMO_ENDPOINT", "http://localhost:8001"),
                     region_name="ap-northeast-2",
                     aws_access_key_id="local", aws_secret_access_key="local")
name = os.environ.get("CARDS_TABLE") or "sangseng-cards"   # 빈 문자열 방어 — .env의 `CARDS_TABLE=`
if name not in [t.name for t in ddb.tables.all()]:
    ddb.create_table(TableName=name, KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                     AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                     BillingMode="PAY_PER_REQUEST").wait_until_exists()
    print(f"created: {name}")
else:
    print(f"exists: {name}")
```

- **검증:** `docker compose up -d --build` → `curl localhost:8000/api/health` 200 →
  `cd backend && DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python local_init.py` → `created:` 출력
- **커밋:** `infra: Docker 테스트 환경 (BE+DynamoDB Local)`

### T8. B1 정적 데이터 서빙

**Files:** Modify `backend/app/routes/dashboard.py`
**Interfaces:** `GET /api/dashboard`(=dashboard.json 그대로), `GET /api/candidates`(eup_scores+candidates+merchants 병합 — 05 §1)

- [ ] 07 B1 체크리스트 그대로: `load("dashboard")` 반환 + 3파일 병합 candidates 엔드포인트
- [ ] 산출 JSON 없을 때 503 + `{"detail": "..."}` (T4·T5 전이면 이 상태가 정상)
- **검증:** Docker 기동 후 `curl localhost:8000/api/dashboard | jq .conversion.headline_rate`
- **커밋:** `feat: B1 대시보드·후보 정적 서빙`

### T9. B2 DynamoDB CRUD + 카드 상태 API

**Files:** Create `backend/app/db.py` / Modify `backend/app/routes/cards.py`
**Interfaces:** 07 B2의 함수들(`put_card/get_card/list_cards/next_card_id/now_iso`) + 05 §2 엔드포인트 4종

- [ ] `db.py`·`clock.py`는 **07 B2 코드 원문 그대로** — 아래 Docker 분기(T7)는 이제 07 B2 원문에
      포함돼 있다:

```python
_kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
if os.environ.get("DYNAMO_ENDPOINT"):          # Docker/로컬 테스트 (T7)
    _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
_table = boto3.resource("dynamodb", **_kw).Table(os.environ.get("CARDS_TABLE") or "sangseng-cards")
```

- [ ] 상태 전이·에러 규칙은 05 §8 표 그대로 (409/400/404, Decimal 변환, INCENTIVE selected_rate)
- **검증:** curl 시나리오 — 목업 카드 put → `GET /api/cards` → `decision approved` → `progress 완료` →
  pending 아닌 카드 decision 409 확인. 전 응답 JSON 직렬화 오류(500) 없음
- **커밋:** `feat: B2 카드 CRUD·상태 전이 (DynamoDB Local 분기)`

### T10. B3 LLM 어댑터

**Files:** Create `backend/app/llm.py`, `backend/app/prompts.py`

- [ ] `llm.py`는 07 B3 코드 원문 그대로 (재시도·backoff·로그가 원문에 포함됨). `prompts.py`는 07 부록 A-1~A-4 원문 그대로
- **검증:** `cd backend && ../.venv/bin/python -c "from app.llm import generate_json; print(generate_json('한 단어로 답하라','ping',{'type':'object','properties':{'r':{'type':'string'}},'required':['r'],'additionalProperties':False}))"`
- **커밋:** `feat: B3 LLM 어댑터(openai/anthropic)+프롬프트`

### T11. B4 Action Card 생성 + 데모 시드 **[xhigh]**

**Files:** Create `backend/app/services/cardgen.py`, `backend/app/services/season.py`, `backend/seed_demo.py` / Modify `routes/cards.py`

- [ ] 07 B4 그대로: AI 입력 ①~⑥ 조립(JSON 직렬화 → user 메시지) → `CARD_AI_SCHEMA` 강제 → Card 생성
      → 중복 가드(05 §8) → `original_ranking` 항상 포함 → INCENTIVE 3/5/7% 골격
- [ ] `seed_demo.py`: `--init`(T7 local_init 겸용) / `--reset`(테이블 비우고 데모 초기 상태 —
      "영월군 카페 approved+추진중" + "영월군 음식점 pending(Score 2위 → 1순위 제안, 고정 JSON)" + INCENTIVE pending, 11 §1 사전 상태)
- **검증:** Docker에서 generate 2회 → 카드 2장, 조정 사유에 "추진중" 언급 재현 (데모 핵심 사례)
- **커밋:** `feat: B4 카드 생성(AI 입력 6종)+seed_demo`

### T12. B5 정책 시뮬레이션 **[xhigh]**

**Files:** Create `backend/app/services/simulate.py` / Modify `routes/cards.py`

- [ ] 07 B5 그대로: 반사실 재계산(순수 함수 — usage_monthly 입력) + LLM narrative + `assumption_note` 고정
- **검증:** delta_pp ∈ [0.5, 10], narrative에 "예상"·"가정" 포함, INCENTIVE 카드 호출 시 400
- **커밋:** `feat: B5 반사실 시뮬레이션`

### T13. B6 KPI + 위젯

**Files:** Modify `backend/app/routes/kpi.py`, `backend/app/routes/widget.py`

- [ ] 07 B6 그대로: KPI 4종(분모 0 → null, 05 §3), 위젯 추천(완료 카드 매칭 `신규` 우선,
      LLM blurb 5초 타임아웃 fallback, payback = INCENTIVE 완료 카드의 selected_rate)
- **검증:** 완료 카드 만들기 전/후 추천 순서 변화 curl 확인 (데모 마지막 동선)
- **커밋:** `feat: B6 KPI·위젯 추천`

### T14. B7 통합 스모크 (`backend/tests/test_smoke.py`)

- [ ] 07 B7 그대로: TestClient로 health→dashboard→generate→decision→progress→kpi→widget
      (LLM은 monkeypatch, DynamoDB는 `DYNAMO_ENDPOINT`로 Docker Local 사용). `httpx2` dev 의존성 추가
      (starlette 1.3+ TestClient의 HTTP 클라이언트 — `httpx`는 deprecation 경고)
- **검증:** `DYNAMO_ENDPOINT=http://localhost:8001 ../.venv/bin/python -m pytest tests -q` 전체 통과 —
  **이 명령이 이후 모든 PR의 스모크 기준**
- **커밋:** `feat: B7 통합 스모크 테스트`

### T15. FE 트랙 (FE 팀원 — 08 문서가 정본, 13 문서가 디자인 기준)

- [ ] 선행: GitHub 콜라보레이터 초대 수락 (유탁이 초대) → clone → F1 스캐폴딩
- [ ] **F1 머지 직후 (유탁 수동):** Vercel Import + 첫 Deploy — 레포 Import(Root Directory=`frontend/`) → Deploy. `NEXT_PUBLIC_API_BASE` 미설정이므로 mock 모드 배포 = 12 §5 폴백 동작 그대로 (15 §7). 이후 PR마다 Preview URL 자동 생성 → F9 스모크에 사용
- [ ] 순서: F1(스캐폴딩+api.ts+mock 저장소) → F2(공통 컴포넌트·금칙어 grep) → F3(허브) → F5(대시보드)
      → F4(카드 상세+지도) → F6(인센티브) → F8(트래킹) → F7(위젯) → F9(전환·메타·모바일)
- [ ] 유탁 지원 포인트: T4 완료 시 실데이터 mock 전달, T9 완료 시 `NEXT_PUBLIC_API_BASE=http://localhost:8000`
      연동 테스트 합류, F4 지도는 Safari 확인 실패 시 02 폴백 결정을 유탁과 함께
- **Gate:** mock 모드로 데모 시나리오(11 §1) 1~8 클릭 완주

### T16. 로컬 풀루프 (Phase 5 Gate)

- [ ] `docker compose up` + `seed_demo.py --reset` + FE `npm run dev`(API_BASE=localhost:8000)
- [ ] 11 §1 스크립트 1~8 완주: 허브→카드 상세→시뮬레이션→승인→완료→위젯 신규 배지→인센티브 승인(페이백 선택)→페이백 배지
- [ ] 실패 지점은 해당 태스크로 롤백해 수정 (테스트 T14가 회귀 기준)
- **Gate:** 로컬 URL에서 30초 내 완주 ×3회

### T17. AWS 최종 배포 (전체 개발 완료 후에만 — 09 §4)

- [ ] **Step 1 (전날까지, 유탁 수동):** AWS 콘솔(관리자 권한)에서 IAM → 사용자 `Yutak_trading` →
      [권한 추가] → **`AdministratorAccess` 정책 한시 부착** (04 §5 후주 — 개인 계정·캠프 기간 한정).
      인라인 정책 나열 방식은 SAM 배포 필수 권한(iam:CreateRole·PassRole, lambda:*, s3:*, logs:*)
      누락 리스크로 폐기 (15 §3-2). **캠프 종료 후 콘솔에서 정책 분리(회수) 필수.**

- [ ] Step 2: `.env`에 배포 파라미터 2종을 넣고 `cd infra && ./deploy-backend.sh` → Outputs의
      `ApiUrl`·`CardsTable` 기록
      - `ALLOWED_ORIGINS=https://<project>.vercel.app,http://localhost:3100` — 앱 CORS 허용 도메인.
        Vercel 도메인은 F1 머지 직후 첫 Deploy에서 이미 확정돼 있다(T15). 비우면 `*` 유지 (09 §5)
      - `RESERVED_CONCURRENCY` — 생략하면 template Default **5**가 적용된다(무인증 공개 URL의
        LLM 호출 남용 상한, 09 §5.5). 동시성 한도 부족으로 배포가 실패하면 `-1`로 재시도
- [ ] Step 3: `.env`의 `CARDS_TABLE=`에 Outputs 값 → **실 DDB로** `python backend/seed_demo.py --reset`
      (DYNAMO_ENDPOINT 미설정 = 실 AWS)
- [ ] Step 4: `curl $ApiUrl/api/health` → `{"ok":true,"data_loaded":true,"datasets":{...}}` —
      `datasets` 5종이 전부 `true`인지까지 확인(번들 복사 누락 조기 발견, 05 §5) + dashboard·cards 스모크
- [ ] Step 5: Vercel — 프로젝트 [Settings] > [Environment Variables]에 `NEXT_PUBLIC_API_BASE=$ApiUrl` (Production+Preview) → **Production 재배포** → 배포 URL 기록 (04 §6; Import·첫 Deploy는 F1 머지 직후 완료됨 — 15 §7)
- [ ] Step 6: 배포 URL에서 11 §1 리허설 ×10 (Safari·휴대폰 실기기 포함), 09 §5 CORS 검증
      (`AllowedOrigins` 파라미터 하나가 게이트웨이·앱 두 층을 함께 좁힌다 — API Gateway가 Lambda의
      CORS 헤더를 덮으므로 게이트웨이 값이 실제 효력이다. `get-api`로 실값 확인)·§5.5 워밍 룰(선택)
- [ ] Step 6-1: 실 DDB에서 INCENTIVE 카드 승인 왕복 1회 후 `scenarios[].delta_pp`가 `[1.0, 2.0]`
      float로 남는지 확인 (DynamoDB Local에서만 검증된 동작 — `backend/app/db.py` `_clean` 주석)
- **Gate:** 01 성공 기준 전항 + 12 §6 체크리스트 전항

### T18. 제출·심사 운영

- [ ] 12 §4 절차로 Public 전환(시크릿 스캔 → 개인정보 파일 확인 → 전환) → §3 문안으로 제출 양식 기재
- [ ] 대표 스크린샷(허브 1920×1080) 캡처·제출, `git tag submission-final`, main 동결
- [ ] 심사 기간: 12 §5 운영 모드 (시드 리셋·Billing 알림·`sam delete` 금지)

---

## Self-Review 결과 (작성 시점)

- 스펙 커버리지: 01 문서 MVP 모듈 ①(T4) ①-2(T1+T4) ②(T5+T11) ②-3(T12) ③(T13+F7) ④(T11+F6) KPI(T13) — 전부 태스크 존재
- 컷 연동: 시간 부족 시 01 컷 리스트 순서로 T6(민감도)→13 §7 지도 장식 요소→T3 축소(업종 대분류만) 순 제외
- 타입 정합: 산출 JSON 스키마는 전부 05 §1·§6을 가리키며 새 필드는 T4에서 계약 먼저 수정하도록 강제
