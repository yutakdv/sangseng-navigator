# 04 — 보안 / 시크릿 이력 / Infra·Docker·SAM (§8~§10)

Phase 2 체크포인트 · 2026-08-08.

---

## A. 16개 엔드포인트 × 가드 유무 (§8 필수 표)

| # | Method / Path | 가드 | DEMO_READ_ONLY 차단 | 토큰 필요 | 무방비 변경? |
|---|---|---|---|---|---|
| 1 | GET `/api/health` | 없음 | — | — | 읽기 |
| 2 | GET `/api/dashboard` | 없음 | — | — | 읽기(공개 의도) |
| 3 | GET `/api/candidates` | 없음 | — | — | 읽기(공개 의도) |
| 4 | GET `/api/risk-signal` | 없음 | — | — | 읽기(공개 의도) |
| 5 | GET `/api/cards` | 없음 | — | — | 읽기(공개 의도) |
| 6 | POST `/api/cards/generate` | `require_mutation_access` | ✅ 403 | ✅ | **아니오** |
| 7 | GET `/api/cards/{cid}` | 없음 | — | — | 읽기(공개 의도) |
| 8 | POST `/api/cards/{cid}/decision` | `require_mutation_access` | ✅ 403 | ✅ | **아니오** |
| 9 | POST `/api/cards/{cid}/simulate` | `require_mutation_access` | ⚠ 403 (계약엔 없음) | ✅ | 아니오 |
| 10 | POST `/api/cards/{cid}/progress` | `require_mutation_access` | ✅ 403 | ✅ | **아니오** |
| 11 | POST `/api/cards/{cid}/verification` | `require_mutation_access` | ✅ 403 | ✅ | **아니오** |
| 12 | POST `/api/cards/{cid}/progress-records` | `require_mutation_access` | ✅ 403 | ✅ | **아니오** |
| 13 | GET `/api/cards/{cid}/progress-records` | `require_internal_access` | ❌ (의도) | ✅ | 읽기(보호됨) |
| 14 | GET `/api/progress-report` | `require_internal_access` | ❌ (의도) | ✅ | 읽기(보호됨) |
| 15 | GET `/api/widget/recommend` | 없음 | — | — | 읽기(공개 의도) |
| 16 | GET `/api/kpi` | 없음 | — | — | 읽기(공개 의도) |

→ **변경(POST) 6개 전부 인증 가드가 붙어 있다. 무방비 변경 엔드포인트 0건.**

### fail-open / fail-closed 판정
`backend/app/security.py:17-23`:
```python
def _require_bearer(request: Request) -> None:
    expected = os.environ.get("MUTATION_API_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503,
            detail="상태 변경 인증이 구성되지 않았습니다. MUTATION_API_TOKEN을 설정해 주세요")
```
→ **토큰 미설정 시 503으로 닫힌다 (fail-closed). fail-open 아님.**
비교는 `secrets.compare_digest`(`security.py:33`) — 타이밍 공격 대비.

### `local-dev-token`의 배포 유출 경로
`docker-compose.yml:48,67`이 `${MUTATION_API_TOKEN:-local-dev-token}` 기본값을 쓴다.
배포 경로(`infra/deploy-backend.sh:13`)는 `[ -n "${MUTATION_API_TOKEN:-}" ]`일 때만 파라미터를 넘기고,
비어 있으면 SAM Default `''`가 적용돼 BE가 **503**으로 닫힌다.
→ **`local-dev-token`이 배포로 새는 경로 없음.** (다만 토큰 미설정으로 배포하면 변경 API 전체가 503)

### IDOR
`card_id`만 알면 상태를 바꿀 수 있는 구조가 맞다 — 사용자·소유자 개념이 없다.
유일한 방어는 단일 Bearer 토큰(`security.py:40` 주석이 "이후 사용자 계정/역할 체계가 도입되면
이 지점에서 주체와 권한을 request.state에 연결한다"고 한계를 명시).
토큰 보유자 = 전권. 로그인 없는 데모 서비스의 설계상 수용된 제약.

### 입력 검증 상한
- `GET /api/widget/recommend?limit=`: `routes/widget.py:103` `visible_limit = max(1, min(MAX_LIMIT, limit))`,
  `MAX_LIMIT = 120` (`:13`) → `?limit=99999` → **120건으로 클램프. 전량 덤프 불가.**
- `GET /api/cards/{cid}/progress-records?limit=`: `routes/progress.py:134` `Query(50, ge=1, le=100)` → FastAPI가 422.
- `GET /api/progress-report?from/to`: `routes/progress.py:159-164` — `from > to` 400,
  `to`가 KST 오늘보다 미래 400, `(to-from) >= 366일` 400 → **스캔 폭발 방지됨.**
- 커서: `progress_db._decode_cursor:138-151`이 base64 디코딩 실패·필수 키 누락·빈 문자열을 `ValueError`,
  `list_card_records:169-170`이 `card_id` 불일치 커서를 거부 → 위변조 커서로 남의 카드 조회 불가.
- `region`/`category`: 화이트리스트 없이 문자열 동등 비교(`routes/widget.py:92`) — 매칭 실패 시 빈 배열.
  주입 위험 없음(정적 JSON 필터링, DB 쿼리 아님).

### 로그 위생
`backend/app/llm.py:14-19` `_KEY_PATTERN = re.compile(r"\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_\-*]{4,}")`,
`redact()`가 `llm.py:90`에서 최종 실패 메시지에만 적용. `LLMError(...) from None`(`:93`)으로
원인 체인을 끊어 SDK 예외의 부분 마스킹된 키가 트레이스백에 남지 않게 한다.
단 `cardgen.py:421,520`은 `log.warning(..., exc_info=True)` — 다만 그 시점 예외는 이미 `LLMError`이므로
마스킹된 메시지만 남는다.
**프롬프트 본문(카드 생성 입력 ①~⑧)은 로그에 실리지 않는다** — `llm.py:83,91`의 log는
provider/model/schema/attempt/elapsed/error만 남긴다.

---

## B. 시크릿 이력 검사 (§8 필수) — 결과: 이력 오염 없음

전 브랜치 155개 커밋 대상 `git log --all -S` 픽액스 검사 (서브에이전트 실측, 원문은 아래 요약).

| 패턴 | 히트 커밋 | 실제 내용 |
|---|---|---|
| `sk-` | 7 | `llm.py`의 마스킹 정규식, `risk-signal` 라우트명(부분문자열), `queue-microtask`(package-lock), `task-11-report`, PNG 바이너리 바이트, `.env.example` 빈 키, 20번 감사 프롬프트 문서 |
| `sk-ant` | 3 | `llm.py` 정규식, `.env.example` 빈 키 |
| `AKIA` | 1 | `docs/plan/20-codebase-audit-prompt.md:382` (이 감사 프롬프트가 검사 명령을 문자열로 적은 것) |
| `ANTHROPIC_API_KEY=` | 3 | `.env.example` 빈 대입, 감사 프롬프트 |
| `OPENAI_API_KEY=` | 4 | `.env.example` 빈 대입, `.superpowers/sdd/*.md`의 "빈 값으로 재기동" 서술 |
| `KAKAO_REST_API_KEY=` / `VWORLD_API_KEY=` | 2 | `.env.example` 빈 대입 |
| `MUTATION_API_TOKEN=` | 1 | `.env.example:93` 빈 대입 |
| `serviceKey` | 10 | 전부 **파라미터 이름** 또는 마스킹 정규식(`p3_merchants.py:93`, `p4_stores.py:67,118`) |

추가 검사:
```
git grep -nIE '(API_KEY|SECRET|TOKEN|serviceKey|apikey)[":= ]{1,4}[A-Za-z0-9/+_-]{20,}' -- . ':!*package-lock.json'
→ (출력 없음)
git grep -nIE '(eyJ[A-Za-z0-9_-]{20,}|aws_secret_access_key)' -- .
→ backend/local_init.py:7 / docs/plan/14:187  둘 다 DynamoDB Local 더미값 "local"
```

**판정: 155개 커밋 어디에도 실키 값이 없다.** `.env`는 한 번도 커밋된 적 없다
(`git log --all --diff-filter=A -- '*.env' '.env' '**/.env'` → 0 커밋).
`.gitignore:2`가 `.env`를 잡고 `git check-ignore -v .env` → `.gitignore:2:.env`.

`.env.example`의 21개 키 중 값이 있는 건 6개뿐이며 전부 비밀이 아니다:
`LLM_PROVIDER=openai`, `OPENAI_MODEL=gpt-4o-mini`, `ANTHROPIC_MODEL=claude-sonnet-5`,
`AWS_REGION=ap-northeast-2`, `DEMO_READ_ONLY=false`, `NEXT_PUBLIC_DEMO_READ_ONLY=false`.

### 로컬 `.env` 실파일 (커밋 안 됨, 참고)
실제 키 4개 보유: `OPENAI_API_KEY`(sk-p…, 164자), `DATA_GO_KR_API_KEY`(64자),
`KAKAO_REST_API_KEY`(32자), `NEXT_PUBLIC_KAKAO_MAP_KEY`(32자).
`.env`에 **없는** 키: `MUTATION_API_TOKEN`, `DEMO_READ_ONLY`, `ALLOWED_ORIGINS`,
`ANTHROPIC_API_KEY`, `PROGRESS_RECORDS_TABLE`, `API_MUTATION_TOKEN`,
`NEXT_PUBLIC_DEMO_READ_ONLY`, `NEXT_PUBLIC_OPERATOR_*`, `VWORLD_API_KEY`, `RESERVED_CONCURRENCY`.
→ Docker 모드는 compose 기본값(`local-dev-token` 등)으로 동작하므로 문제 없음.

### 커밋된 바이너리·문서 (Public 전환 대비)
- `.gitignore:31-33`이 `기획서_V.I.B.E.pdf`·`MVP_상생나침반_개정판.pdf`를 제외 — **둘 다 커밋 이력 0건.**
- **커밋된 PDF 2개**: `(SDU COSS) …산출물 제출 요구사항 안내.pdf`(134KB),
  `산출물_평가표_20260808.pdf`(412KB) — `.gitignore`가 잡지 않음. 대회 배포 문서.
- 커밋된 PNG: `image-1.png`(1.6MB), `image-2.png`(1.7MB), `frontend/public/og.png`(1.27MB),
  `gangwonland-esg-promo-v2.png`(2.1MB) 등 — 합계 약 7MB.
- `data/raw/api_cache/`: 커밋된 10개 파일 중 키 포함 0건.
  `merchants_raw.json`의 유일한 매치는 `"params_note": "serviceKey/pageNo/numOfRows 필수…"` 문자열.
  `geocode.json`은 `.gitignore:37`로 제외되고 커밋 이력 0건.
- 빌드 산출물 git 추적 0건 (`.pytest_cache` ×3, `tsconfig.tsbuildinfo`, `infra/.aws-sam` 전부 ignore됨).
- `.superpowers/sdd/` 하위 에이전트 작업 보고 마크다운 13개가 **추적된다** (`.gitignore`는 `.agents/`·`.claude/`만 제외).

---

## C. CORS 2중 구성

| 층 | 값 | 근거 |
|---|---|---|
| 앱 | `ALLOWED_ORIGINS` env. Lambda 기본 `""` → 허용 오리진 0개. 로컬 기본 `http://localhost:3100,http://127.0.0.1:3100` | `main.py:20-21` |
| 앱 가드 | `"*"` 포함 시 `RuntimeError`로 **기동 실패** | `main.py:22-23` |
| 게이트웨이 | `HttpApi.CorsConfiguration.AllowOrigins = !Split[',', !Ref AllowedOrigins]`, Default `https://configure-me.invalid` | `template.yaml:33-39`, `:13` |

`template.yaml:34-36` 주석이 "HTTP API에 CorsConfiguration이 붙어 있으면 API Gateway가 통합이 돌려준
CORS 헤더를 무시하고 자기 설정으로 덮는다"고 명시 → 그래서 같은 파라미터를 양쪽에 건다.
`deploy-backend.sh:16`이 `AllowedOrigins`를 **한 번만** 넘기고 그 값이 두 층에 동시 적용된다.
→ **두 층이 어긋날 수 없는 구조.** 미설정 배포 시 증상: 브라우저에서 모든 API 호출이 CORS 차단
(서버는 200을 주지만 브라우저가 응답을 버림).

---

## D. Docker / Compose (§10)

### 포트 정합성 — 의혹 해소
프롬프트 §2가 CRITICAL 후보로 지목한 부분:

| 층 | 값 | 근거 |
|---|---|---|
| 호스트 | `${FRONTEND_PORT:-3100}` | `docker-compose.yml:60` |
| 컨테이너 | `3000` | `docker-compose.yml:60` |
| 앱 | `next dev --port 3000` | `frontend/Dockerfile:13` → `npm run dev:docker` → `package.json` `"dev:docker": "next dev --port 3000"` |

→ **정합. CRITICAL 아님.** (`"dev": "next dev --port 3100"`은 컨테이너 밖 실행용이라 별개.)

### 컨테이너 내부 주소 — `localhost:8000` 전수 검사
`NEXT_PUBLIC_API_BASE`는 compose가 `http://backend:8000`으로 준다(`:66`).
FE 소스에 `localhost:8000` 하드코딩 없음 — `lib/api.ts:44`가 env만 읽는다.
→ **ECONNREFUSED 경로 없음.**

### 볼륨
| 마운트 | 목적 |
|---|---|
| `./backend/app:/app/app` (rw) | BE 핫리로드 (`:53`) |
| `./backend/app:/app/app:ro` + `./backend/seed_demo.py:/app/seed_demo.py:ro` | seed 전용, 읽기전용 (`:31-32`) |
| `./data/processed:/app/app/data:ro` | **Lambda 번들과 동일 경로 재현** (`:33`, `:54`) |
| `./frontend:/app` + 익명 `/app/node_modules`, `/app/.next` | FE 핫리로드 (`:79-81`) |

익명 볼륨 `/app/node_modules`는 `package.json` 변경 시 stale해진다 —
의존성 추가 후에는 `docker compose build frontend` 또는 볼륨 삭제가 필요(문서화 안 됨).

### healthcheck 부재 → 실패 시나리오
`dynamodb`에 healthcheck 없음, `seed`/`backend`는 `depends_on: [dynamodb]`(condition 없음) →
**컨테이너 "시작"만 보장하고 "준비"는 보장하지 않는다.**
- `seed`는 `:37-38`의 30회×2초 재시도 루프로 공백을 메운다 (최대 60초).
- **`backend`에는 재시도가 없다.** 다만 `db.py:16`의 boto3 `Table()`은 지연 객체라 기동은 성공하고,
  실패는 첫 DynamoDB 접근 시점에 난다. seed 완료 전에 `/api/cards`를 부르면
  `ResourceNotFoundException` → 500.
- `dynamodb`가 `-inMemory -sharedDb`(`:14`)라 **컨테이너 재시작 시 테이블·데이터 전소**.
  `restart` 정책이 없어(seed만 `"no"` 명시) 죽으면 조용히 내려간 채로 남는다.

### `.dockerignore`
- `frontend/.dockerignore` 존재: `node_modules`, `.next`, `out`, `.git`, `.env*.local` — 적절.
- **`backend/.dockerignore` 없음.** backend Dockerfile은 `COPY requirements.txt .` + `COPY app ./app`로
  선택 복사하므로 **이미지는 오염되지 않는다.** 다만 빌드 컨텍스트로 `backend/` 전체(**111MB**,
  이 중 `.venv` 110MB)가 매 빌드마다 데몬에 전송된다.

---

## E. SAM (§10)

| 항목 | 값 | 평가 근거 |
|---|---|---|
| `Timeout` | 30초 (`template.yaml:24`) | `cardgen.LLM_TIMEOUT=12` × 재시도 2회 + backoff 0.5s = **최악 24.5초** < 30초. `llm.py:9-10` 주석이 이 계산을 명시. 여유 있음 |
| `MemorySize` | 512MB (`:25`) | 정적 JSON 최대 `merchants.json` 330KB + `usage_daily` 136KB. `dataload._load_versioned`가 lru_cache(32). 충분 |
| `ReservedConcurrency` | 5 (`:11`) | 무인증 공개 generate가 호출마다 LLM을 부르므로 요금 폭주 방지선 |
| 로그 보존 | 7일 (`:100`) | 비용 방지 |
| `CodeUri` | `../backend` (`:41`) | **실측**: `infra/.aws-sam/build/ApiFunction/`에 `.venv`·`tests`·`seed_demo.py`·`local_init.py`·`pytest.ini`·`__pycache__` **전부 없음**. `app` + `requirements.txt` + 설치된 deps만. 번들 56MB → **프롬프트가 우려한 tests 번들 포함은 사실이 아니다** |

### DynamoDB 정책 커버리지
`template.yaml:57-65`: `DynamoDBCrudPolicy` ×2 + `dynamodb:TransactWriteItems` 명시.
- GSI Query: SAM `DynamoDBCrudPolicy`는 `table/${TableName}/index/*`를 리소스에 포함 → **커버됨.**
- `describe_table`/`create_table`(`progress_db.ensure_table:67-102`), `clear_table:106-121`:
  **정책에 없다.** 호출 경로 추적 결과 —
  `ensure_table` ← `seed_demo.py:444`, `local_init.py:20`
  `clear_table` ← `seed_demo.py:449`
  둘 다 **Lambda 런타임 코드가 아니다**(`app/` 밖, 번들에도 미포함).
  → **Lambda에서 호출될 경로 없음. 권한 부족 문제 발생하지 않는다.**

### 로컬/배포 테이블 정의 대조
| | `template.yaml` | `seed_demo.py` / `progress_db.ensure_table` |
|---|---|---|
| Cards PK | `id` (S) (`:70-72`) | `id` (S) (`seed_demo.py:438-441`) |
| Progress PK | `record_id` (S) (`:82-83`) | `record_id` (S) (`progress_db.py:75`) |
| GSI 1 | `card-recorded-at-index` (card_id/recorded_at_key, ALL) (`:85-90`) | 동일 (`progress_db.py:83-90`) |
| GSI 2 | `report-bucket-recorded-at-index` (report_bucket/recorded_at_key, ALL) (`:91-96`) | 동일 (`progress_db.py:91-98`) |
| Billing | PAY_PER_REQUEST (`:80`) | PAY_PER_REQUEST (`progress_db.py:100`) |

→ **필드·인덱스 단위로 동일. "로컬은 되고 배포는 깨지는" 구멍 없음.**

### `deploy-backend.sh` (읽기만 함, 실행 안 함)
- `:7` `rm -rf ../backend/app/data && cp -r ../data/processed ../backend/app/data` → **데이터 복사 단계 존재.**
  현재 `backend/app/data/`는 **비어 있고 `.gitignore:25`로 제외**되어 있다 — 배포 시 생성되는 것이 정상.
  복사 누락 시 `/api/health`의 `data_loaded:false`가 잡아낸다(`main.py:73-82`, 05 §5).
- 파라미터 전달: `AllowedOrigins`(`:16`), `MutationApiToken`(`:13`), `DemoReadOnly`(`:17`) 전부 있음.
  **`OPENAI_MODEL`·`ANTHROPIC_MODEL`은 없다** → 배포 Lambda는 항상 코드 기본값 사용.
- 롤백: 스크립트 자체 롤백 없음. `set -euo pipefail`로 중단하고,
  스택 배포 실패는 CloudFormation 기본 자동 롤백에 맡긴다.

### CI/CD
`.github/` 디렉터리 **없음** → lint·타입체크·테스트·금칙어 검사 전부 수동.
`pipeline/tests/`는 `backend/pytest.ini`(testpaths=tests, backend 루트) 밖이라 어떤 설정에도 안 잡히고,
`pipeline/requirements.txt`에 pytest가 없다 → 별도 실행이 필요.
