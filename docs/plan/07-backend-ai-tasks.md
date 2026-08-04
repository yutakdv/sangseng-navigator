# 07. 백엔드 + AI 태스크 (유탁 · Phase 3~5)

> FastAPI 하나로 로컬(uvicorn)과 Lambda(Mangum)를 겸한다. 응답 형태와 엣지 케이스 규칙은
> 05 문서(특히 §8)가 정본. LLM 분기는 `llm.py` 한 곳, 프롬프트는 `prompts.py` 한 곳(부록 A 원문).
>
> **의존성 원칙:** `backend/requirements.txt`는 `fastapi, mangum, boto3, python-dotenv,
> openai, anthropic`만. **pandas·numpy 금지** — 백엔드는 JSON을 읽고 사칙연산만 하면 되고,
> 무거운 패키지는 Lambda 번들 크기·콜드스타트를 악화시킨다 (계산은 파이프라인 소관).
> `uvicorn`·`pytest`·`httpx2`는 **`requirements-dev.txt`** 쪽이다 — Lambda는 Mangum 핸들러라
> uvicorn이 필요 없다. 그래서 로컬에서 `uvicorn app.main:app`이나 `pytest`를 돌리려면
> `.venv/bin/pip install -r backend/requirements-dev.txt`를 **한 번은 해야 한다**
> (Docker는 Dockerfile이 uvicorn을 따로 설치하므로 무관).

## Task B1: FastAPI 스캐폴딩 + 정적 데이터 서빙

**Files:** `backend/app/main.py`, `dataload.py`, `routes/dashboard.py`

```python
# app/main.py
import logging
import os
from pathlib import Path

if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):      # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from mangum import Mangum

from app.routes import cards, dashboard, kpi, widget

# 배포 URL 확정 후 09 문서 §5에서 좁힌다 — 코드 수정 없이 SAM 파라미터(환경변수)만 바꾸면 되게
# 쉼표 구분 목록으로 받는다. 미설정·빈 값이면 지금까지와 같은 전체 허용("*").
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()] or ["*"]

# 로깅: Lambda·로컬 양쪽에서 app 로거(LLM 실패 경고 등)가 보이도록 최소 설정만 한다.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
if not logging.getLogger().handlers:    # uvicorn·Lambda가 이미 붙인 핸들러는 덮지 않는다
    logging.basicConfig(level=LOG_LEVEL)
logging.getLogger("app").setLevel(LOG_LEVEL)

# health의 data_loaded 판정 대상 — risk_signal은 B4 ⑥에서 "없으면 컷"인 선택 입력이라
# datasets에만 싣고 AND 판정에서는 뺀다.
REQUIRED_DATASETS = ("dashboard", "eup_scores", "candidates", "merchants")
OPTIONAL_DATASETS = ("risk_signal",)

app = FastAPI(title="상생 나침반 API")
# 미들웨어 순서 주의: Starlette는 **나중에 add한 것이 바깥**이다. CORS가 바깥이어야
# 에러 응답(예외 처리 결과)에도 CORS 헤더가 붙으므로 GZip을 먼저, CORS를 나중에 add한다.
app.add_middleware(GZipMiddleware, minimum_size=1000)   # /api/candidates 285KB → gzip 44KB (실측)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])
for r in (dashboard.router, cards.router, widget.router, kpi.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    """산출물별 로드 여부까지 보고 (05 문서 §5) — dashboard 하나만 보면 나머지 결손을 놓친다."""
    from app import dataload
    datasets = {}
    for name in REQUIRED_DATASETS + OPTIONAL_DATASETS:
        try:
            dataload.load(name)
            datasets[name] = True
        except FileNotFoundError:
            datasets[name] = False
    return {"ok": True,
            "data_loaded": all(datasets[n] for n in REQUIRED_DATASETS),
            "datasets": datasets}


handler = Mangum(app)   # Lambda 진입점
```

```python
# app/dataload.py — processed JSON 로더 (유일한 데이터 접근 지점)
import functools
import json
from pathlib import Path

# processed 를 먼저 본다 — app/data 는 deploy-backend.sh 가 만든 번들 사본이라 로컬에 옛 산출이
# 남아 있으면 최신 data/processed 를 가린다. 배포 환경에는 레포 루트가 없어 첫 경로가 빗나가고
# 번들 경로로 정상 폴백한다(Lambda·Docker 모두 첫 경로가 존재하지 않는 절대경로로 풀린다).
# Docker 는 data/processed 를 app/data 에 마운트하므로 어느 쪽을 읽든 내용이 같다.
CANDIDATE_DIRS = [
    Path(__file__).parents[2] / "data" / "processed",    # 로컬 개발 — 파이프라인 최신 산출
    Path(__file__).parent / "data",                      # Lambda 번들 / Docker 마운트 지점
]


@functools.lru_cache(maxsize=None)
def load(name: str) -> dict | list:      # candidates·merchants·risk_signal 은 최상위가 list다
    for d in CANDIDATE_DIRS:
        p = d / f"{name}.json"
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError(name)
```

초판(2026-08-03)에서 바뀐 곳과 근거 — 백엔드 감사 반영분:
- `CANDIDATE_DIRS` **탐색 순서 역전**(`data/processed` 우선): 로컬에 남은 옛 번들 사본
  `app/data/usage_monthly.json`이 최신 산출을 가려 `visitors_monthly`가 `None`으로 읽혔다
- `load()` 반환 타입 `dict` → **`dict | list`**: `candidates`·`merchants`·`risk_signal`은 최상위가 배열이다
- `loaded_ok()` **삭제** — `health`가 산출물 5종을 개별 확인하게 되면서 유일한 호출부가 사라졌다
- `health`가 산출물 5종을 개별 보고(`datasets`)하고 `data_loaded`는 **필수 4종 AND** (05 §5)
- CORS `allow_origins`를 **`ALLOWED_ORIGINS` 환경변수**로 받음 — 배포 후 코드 수정 없이 SAM 파라미터만
  바꿔 좁히기 위함 (09 §5)
- **GZip 미들웨어 추가**(`minimum_size=1000`) — `/api/candidates` 285KB → 44KB(실측).
  CORS가 바깥이어야 에러 응답에도 CORS 헤더가 붙으므로 GZip을 먼저 add한다
- `logging` 최소 설정 — Lambda(CloudWatch)뿐 아니라 로컬/Docker에서도 `app` 로거(LLM 실패 경고)가 보이게

- [ ] `GET /api/dashboard` → `load("dashboard")` 그대로 반환
- [ ] `GET /api/candidates` → `eup_scores` + `candidates` + `merchants` 병합 반환 (05 §1)
- [ ] `GET /api/risk-signal` → `load("risk_signal")` **가공 없이 배열 그대로** (05 §1) —
      13 §2-15 요인 카드의 `under2y_ratio` 출처. 감싸거나 필드를 더하면 FE mock(같은 파일)과 갈린다
- [ ] **검증:** `uvicorn app.main:app --port 8000` 후 `curl localhost:8000/api/dashboard | jq .conversion.headline_rate`,
      `curl localhost:8000/api/health` → `datasets` 5종 전부 `true`

## Task B2: DynamoDB CRUD (`db.py`) + 카드 상태 API

```python
# app/clock.py — KST 시각 유틸 (05 문서 §8 '모든 타임스탬프 KST ISO8601')
# db.py 에서 분리한 이유: season.py 같은 순수 계산 모듈이 KST 상수 하나 때문에 app.db 를
# import 하면 boto3 리소스 생성까지 끌려온다.
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def now_iso() -> str:
    return datetime.now(KST).isoformat(timespec="seconds")
```

```python
# app/db.py
import os, boto3
from decimal import Decimal

# clock 으로 옮긴 뒤 재노출 — db.KST·db.now_iso 를 쓰는 기존 호출부(seed_demo.py, tests,
# cardgen, routes)를 그대로 두기 위함
from app.clock import KST, now_iso      # noqa: F401

_kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
if os.environ.get("DYNAMO_ENDPOINT"):          # Docker/로컬 테스트 (14 문서 T7)
    _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
# `or` 로 받는다 — .env 의 `CARDS_TABLE=` (빈 문자열)이면 테이블명이 ""가 되어 카드 API 전부가 500
_table = boto3.resource("dynamodb", **_kw).Table(os.environ.get("CARDS_TABLE") or "sangseng-cards")


def _clean(v):
    """boto3의 Decimal → int/float 변환 (FastAPI JSON 직렬화 깨짐 방지 — 05 문서 §8).

    저장된 표기에 소수점이 있으면 float, 없으면 int — 값이 정수라는 이유로 float 를 int 로
    내리지 않는다. 정수 판정(v == v.to_integral_value())으로 내리면 read-modify-write 때마다
    05 §2 의 scenarios[].delta_pp 가 [1.0, 2.0] → [1, 2] 로 바뀐다.
    """
    if isinstance(v, Decimal):
        return float(v) if "." in str(v) else int(v)
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


def _to_ddb(v):
    """반대 방향: float → Decimal (DynamoDB는 float 저장 불가)."""
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, dict):
        return {k: _to_ddb(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_to_ddb(x) for x in v]
    return v


def put_card(card: dict): _table.put_item(Item=_to_ddb(card))
def get_card(cid: str): return _clean(_table.get_item(Key={"id": cid}).get("Item"))
def list_cards(): return [_clean(i) for i in _table.scan().get("Items", [])]


def next_card_id(prefix: str) -> str:
    """AC-/INC- + 3자리 순번 — 기존 ID의 **최대 순번 + 1** (05 문서 §8).

    개수+1이 아닌 이유: 카드가 삭제되거나 비순차 ID(AC-901 등)가 섞이면 개수+1이 이미 쓰인
    ID를 만들어 put_card 가 기존 카드를 조용히 덮어쓴다.
    Scan 기반이라 동시 generate 경합은 그대로 남지만 데모 규모에서는 무시한다.
    """
    mx = 0
    for c in list_cards():
        cid = c["id"]
        if not cid.startswith(prefix):
            continue
        try:
            mx = max(mx, int(cid[len(prefix):]))
        except ValueError:              # 순번이 아닌 접미사는 건너뛴다
            continue
    return f"{prefix}{mx + 1:03d}"
```

초판에서 바뀐 곳과 근거 — 백엔드 감사 반영분:
- **`clock.py` 분리**: `KST`/`now_iso`를 순수 모듈로 빼고 `db.py`가 재노출한다. `season.py` 같은
  계산 모듈이 KST 상수 하나 때문에 boto3 리소스 생성을 끌어오지 않게 하려는 것 —
  `db.KST`·`db.now_iso` 호출부(`seed_demo.py`·tests)는 그대로 동작한다
- **`_clean`의 Decimal 판정**: 정수값 float(예: `1.0`)를 int로 내리지 않도록 저장 표기 기준으로 바꿈
  (05 §8 숫자 직렬화 행 — `delta_pp`가 `[1, 2]`로 무너지는 것 방지)
- **`next_card_id`가 개수+1 → 최대 순번+1**: 개수+1은 이미 존재하는 ID를 다시 만들어 덮어쓴다

상태 전이 규칙 (`routes/cards.py`) — 05 문서 §8 에러 규칙 준수:
- `decision`: `pending`에서만 허용(아니면 409). `approved`면 `progress="검토중"` + `decided_at` 기록
- INCENTIVE 카드를 `approved`로 바꿀 때는 body의 `selected_rate`(3|5|7)를 카드에 저장(누락 시 400) —
  위젯 페이백 배지의 rate 출처 (05 문서 §2·§4)
- `progress`: `status=approved`에서만 허용(아니면 409). 모든 변경은 `events`에 `{"at", "action"}` append
- 없는 ID는 404
- [ ] `GET /api/cards`(type/status 필터), `GET /api/cards/{id}`, `decision`, `progress` 구현
- [ ] **검증:** curl로 pending 카드 생성→승인→완료 전이, 잘못된 전이는 409, 응답 JSON에
      Decimal 직렬화 오류가 없는지(500 안 남) 확인

## Task B3: LLM 어댑터 (`llm.py`)

provider 분기는 이 파일 안에만 존재. 두 provider 모두 **JSON 스키마 강제 출력**을 사용한다.

```python
# app/llm.py
import os, json, re, time, logging

log = logging.getLogger(__name__)
# Lambda 런타임이 root 로거에 INFO 핸들러를 붙이므로 아래 log.info는 CloudWatch에 그대로 남는다.
# 발표 Q&A("AI 응답 몇 초 걸리나") 근거 + 심사 기간 중 API 키 만료·rate limit을 로그로 감지하기 위함.

RETRY_BACKOFF_SECONDS = 0.5
# 재시도 사이 고정 대기. 최악 지연 = cardgen timeout 12s × 2회 + backoff 0.5s = 24.5s < Lambda 30s
# (09 문서 Timeout: 30, cardgen.LLM_TIMEOUT=12). 마지막 시도 뒤에는 대기하지 않는다.

# 인증 실패 응답에는 SDK가 부분 마스킹한 키가 그대로 들어 있다
# (예: "Incorrect API key provided: sk-proj-****ABCD"). 로그·트레이스백에 남기지 않는다.
_KEY_PATTERN = re.compile(r"\b(sk|sk-ant|sk-proj)-[A-Za-z0-9_\-*]{4,}")


def redact(text: str) -> str:
    return _KEY_PATTERN.sub("<redacted-key>", text)


class LLMError(Exception):
    """LLM 호출 최종 실패 — 원인 예외의 **마스킹된** 타입·메시지만 담는다 (아래 raise ... from None)."""


def generate_json(system: str, user: str, schema: dict, schema_name: str = "result",
                   timeout: float | None = None, attempts: int = 2) -> dict:
    """attempts 는 총 시도 횟수 — 기본 2(최초+재시도 1회)로 기존 호출부 동작은 그대로다.
    지연 상한이 중요한 호출부(위젯 blurb)만 attempts=1 로 재시도를 끄고 fallback 으로 넘긴다.
    """
    provider = os.environ.get("LLM_PROVIDER", "openai")
    model = (os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5") if provider == "anthropic"
             else os.environ.get("OPENAI_MODEL", "gpt-4o-mini"))
    attempts = max(1, attempts)     # 0 이하면 아래 raise last_exc 가 None을 raise 하므로 최소 1회는 돈다
    last_exc: Exception | None = None
    started = time.perf_counter()   # 소요시간은 호출 전체(재시도·backoff 포함) 기준
    for attempt in range(1, attempts + 1):
        try:
            if provider == "anthropic":
                import anthropic
                client = anthropic.Anthropic()
                # timeout 미지정(None)이면 SDK 기본 타임아웃을 그대로 쓴다 — 명시적으로 None을
                # 넘기면 SDK가 "타임아웃 없음(무한 대기)"으로 해석한다.
                extra = {"timeout": timeout} if timeout is not None else {}
                resp = client.messages.create(
                    model=model,
                    max_tokens=4096,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                    thinking={"type": "disabled"},  # sonnet-5는 기본 adaptive thinking — 짧은 JSON 생성엔 지연만 늘어 끔 (Lambda 30s 내 응답 보장)
                    output_config={"format": {"type": "json_schema", "schema": schema}},
                    **extra,
                )
                text = next(b.text for b in resp.content if b.type == "text")
                out = json.loads(text)
            else:
                # 기본: openai
                from openai import OpenAI
                client = OpenAI()
                if timeout is not None:     # with_options(timeout=None)은 "무한 대기"가 된다
                    client = client.with_options(timeout=timeout)
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    response_format={"type": "json_schema",
                                     "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
                )
                out = json.loads(resp.choices[0].message.content)
            log.info("llm ok provider=%s model=%s schema=%s attempt=%d/%d elapsed=%.2fs",
                     provider, model, schema_name, attempt, attempts, time.perf_counter() - started)
            return out
        except Exception as exc:
            last_exc = exc
            if attempt < attempts:
                time.sleep(RETRY_BACKOFF_SECONDS)
    cause = redact(f"{type(last_exc).__name__}: {last_exc}")
    log.info("llm fail provider=%s model=%s schema=%s attempts=%d elapsed=%.2fs error=%s",
             provider, model, schema_name, attempts, time.perf_counter() - started, cause)
    raise LLMError(cause) from None     # 원인 체인을 끊어 마스킹 안 된 SDK 메시지가 새지 않게
```

초판에서 바뀐 곳과 근거 — 백엔드 감사 반영분:
- **재시도가 `attempts` 인자로 명시**(기본 2 = 최초+1회). 위젯 blurb만 `attempts=1`로 재시도를 꺼
  체감 지연 상한을 지킨다 (05 §8 위젯 LLM 실패 행)
- **`RETRY_BACKOFF_SECONDS = 0.5` backoff 추가** — 즉시 재시도는 rate limit을 그대로 다시 맞는다.
  최악 지연이 Lambda Timeout 30s 안에 들어오는 계산을 상수 옆에 병기
- **호출 1건당 로그 1줄**(성공·실패 모두, provider·model·schema·소요시간) — 심사 기간에 키 만료·
  쿼터 초과를 알아챌 유일한 흔적이자 발표 Q&A("AI 응답 몇 초") 근거
- **`timeout` 인자**: 호출부별 상한(cardgen 12초 / simulate 8초 / 위젯 5초). `None`이면 SDK 기본값을
  유지한다 — 두 SDK 모두 명시적 `None`을 "무한 대기"로 해석하므로 분기해서 넘긴다
- 시그니처는 `generate_json(system, user, schema, schema_name=..., timeout=None, attempts=2)`로 고정 —
  호출부(cardgen·simulate·widget)가 이 형태에 의존한다
- **최종 실패는 `LLMError`로 바꿔 올린다** — 호출부가 `log.warning(..., exc_info=True)`로 예외를
  통째로 찍기 때문에, SDK 예외를 그대로 올리면 인증 실패 메시지에 든 **부분 마스킹된 키**가
  트레이스백과 함께 CloudWatch에 남는다. `raise ... from None`으로 원인 체인을 끊고
  `redact()`를 거친 타입·메시지만 남긴다(401·timeout·rate limit 구분은 유지).
  호출부는 계속 `except Exception`이라 잡는 방식은 그대로다

- [ ] 위 구현 + 최종 실패 시 호출부에서 규칙 기반 fallback 사용
- [ ] **검증:** 로컬에서 두 provider 각각 1회 스모크 (`python -c ...`) — 스키마 준수 JSON 반환 확인

## Task B4: Action Card 생성 (`services/cardgen.py`) — AI 필수성의 핵심

AI 입력 스키마 (기획안 §2-2 그대로):

| 입력 | 출처 |
|---|---|
| ① 후보 Score·순위 **+ 도로 접근성** | `candidates.json` (변경 불가 기준선). 근거 필드(`gap`·`proximity`·`saturation`·반경 수치)와 함께 `road_distance_km`·`road_minutes`도 싣는다 — `proximity`가 **직선거리** 기반이라 산악 지형에서 실제 접근성과 역전되는 것을 AI가 근거로 지적할 수 있게 하려는 것이다. **Score·순위 자체는 그대로가 기준선이며 도로시간으로 재정렬하지 않는다**(05 §1). 값은 공개 라우팅 API 추정치라 프롬프트에서도 소요시간 중심 비교로만 쓰게 한다 |
| ② 각 후보의 추진 상태 | DDB — 같은 (읍×업종) 타깃의 기존 카드 progress |
| ③ 계절성 신호 | 아래 캘린더 규칙 표 (`services/season.py`) |
| ④ 최근 지역별 채택 이력 | DDB — approved EXPANSION 카드의 target.eup 분포. **최근 4분기(= `decided_at` 기준 365일) 창 안만** |
| ⑤ 최근 정책 이력 | DDB — 같은 타깃의 rejected 이력. ④와 **동일한 365일 창** |
| ⑥ 지역경제 위험 신호 | `risk_signal.json` (참고용, 컷 가능) |

④·⑤의 창(`RECENT_WINDOW_DAYS = 365`)은 A-1 프롬프트의 "최근 4분기"·"최근"을 그대로 구현한 것이다.
`decided_at`이 없거나 파싱되지 않는 카드(naive 값이라 aware 기준시각과 비교가 깨지는 경우 포함)는
**창 밖**으로 본다 — 결정 시각을 모르는 카드를 최근으로 세면 형평성 판단이 과대 집계되기 때문이다
(생성 경로는 모두 `db.now_iso`의 KST aware 값을 쓴다).

계절성 캘린더 규칙 (고정 dict — LLM 입력 ③):

| 월 | 신호 | 근거 |
|---|---|---|
| 12~2월 | `겨울 성수기 — 스키 시즌 유동인구 집중` | 하이원 스키장 |
| 7~8월 | `여름 성수기 — 휴가철·워터월드` | 리조트 하계 수요 |
| 4~5월, 10~11월 | `간절기 — 트레킹·행사 수요` | 하늘길 등 |
| 그 외 | `평시` | — |

`prompts.py`의 시스템 프롬프트는 **기획안 발표 공개용 원문**을 그대로 사용한다
(규칙: 조정 시 근거 제시 / 상위 2개 후보 비교 필수 / 추진중·완료 중복 제안 금지 /
3분기 연속 1순위면 형평성 하향 가능 / 원 Score 순위 항상 출력 / 리스크 ≥1개 /
추측은 "예상"·"가능성" 표기 / ⑥은 진단 참고용 — 가맹점 확충 외 실행 제안 금지).

출력 JSON 스키마(= 05 문서 Card.ai 필드):
```python
CARD_AI_SCHEMA = {
  "type": "object", "additionalProperties": False,
  "properties": {
    "adjusted": {"type": "boolean"},
    "ai_rank_target": {"type": "string"},
    "comparison": {"type": "string"},
    "reasons": {"type": "array", "items": {"type": "string"}},
    "risks": {"type": "array", "items": {"type": "string"}},
    "expected_effect": {"type": "string"},
    "confidence": {"type": "string", "enum": ["상", "중", "하"]}
  },
  "required": ["adjusted", "ai_rank_target", "comparison", "reasons", "risks", "expected_effect", "confidence"]
}
```

- [ ] `POST /api/cards/generate {"type":"EXPANSION"}`: 입력 ①~⑥ 조립 → LLM → Card 생성(`status=pending`, ID는 `db.next_card_id`) → DDB
- [ ] 중복 가드: 동일 `(type, target)`의 pending 카드가 있으면 기존 카드 반환 (05 문서 §8).
      LLM 호출 자체를 건너뛰는 것은 **가용 후보 전원이 이미 pending 카드를 가진 경우**뿐 —
      "최상위 후보에 pending이 있으면 즉시 반환"으로 넓히면 시드의 pending 카드(AC-002) 때문에
      데모의 실시간 생성 버튼이 옛 카드만 돌려준다 (11 문서 §1 파손)
- [ ] 가용 후보 0건(전 후보가 추진중/완료)이면 `NoAvailableCandidate` → 라우트가 **409**로 변환
      (05 문서 §8). A-1의 "추진중/완료 중복 제안 금지"를 어긴 카드를 저장하느니 제안을 내지 않는다.
      LLM 장애가 아니라 도메인 신호이므로 **fallback 대상이 아니다** — 가용성 판정은 LLM 호출 전에 한다
- [ ] `original_ranking`(정량 순위)을 카드에 항상 포함 — AI가 조정해도 병기 (감사 가능성)
- [ ] INCENTIVE 타입: 시나리오 3/5/7% 고정 골격 + LLM이 각 시나리오 비교문·리스크 생성, `assumption_note` 고정 문구 삽입.
      `selected_rate`는 생성 시 `null` — 승인 시점에 담당자가 고른 값이 decision API로 들어온다 (B2)
- [ ] **데모 사례 보장:** 시연용으로 "Score 1위 후보의 기존 카드가 추진중" 상태를 미리 만들어
      AI가 2위를 1위로 조정하는 사례가 재현되도록 시드 스크립트(`backend/seed_demo.py`) 작성.
      `--reset` 플래그로 테이블을 데모 초기 상태로 되돌릴 수 있게 (리허설 반복용 — 11 문서 §4)
- [ ] **검증:** generate 2회 호출 → 카드 2장 생성, 조정 사유에 "추진중" 언급 포함 확인

## Task B5: 정책 시뮬레이션 (`services/simulate.py`)

- [ ] 반사실 재계산(순수 함수): `usage_monthly.json`의 지역 분포에 해당 후보 (읍×업종) 예상 건수
      (유사 가맹점 월평균 건수 = 해당 업종 지역 건수 / 가맹점 수, 가정치)를 더해 집중도 재계산
- [ ] LLM으로 `narrative` 생성 — "확정 사실이 아닌 전망" 톤 + 불확실성 문구, `assumption_note` 고정
- [ ] 타깃 `eup`이 집계 6개 지역(`REGIONS`) 밖이면 `ValueError` → 라우트가 **400**으로 변환 (05 문서 §8) —
      지수 분포에 더할 자리가 없어 조용히 `delta 0`을 내면 "효과 없음"과 구분되지 않는다
- [ ] **검증:** delta_pp가 [0.5, 10] 안의 상식 범위, narrative에 "예상"·"가정" 포함

## Task B6: KPI + 위젯

- [ ] `GET /api/kpi`: DDB scan → 05 §3 공식 그대로 계산 (카드 0건이어도 division-by-zero 없이 응답)
- [ ] `GET /api/widget/recommend`: `merchants.json`에서 (region, category) 필터 →
      `progress=완료`인 EXPANSION 카드 타깃과 매칭되는 가맹점 `badge:"신규"` + 우선 정렬 →
      상위 3곳 + LLM blurb (실패 시 규칙 기반 문구) → INCENTIVE 완료 카드 있으면 `payback` 부여
      (`rate` = 그 카드의 `selected_rate`)
- [ ] **정렬 근거 2단계**(05 §4): ① `신규` 배지 먼저 ② 그다음 거점(`ANCHOR`) 직선거리 오름차순.
      좌표 없는 가맹점은 맨 뒤. **거리 값은 응답에도 blurb 프롬프트에도 싣지 않는다** —
      05 §1 캐비엇("거점에서 가장 가깝다고 단정하지 않는다")을 지키려고 정렬 근거로만 쓴다.
      `ANCHOR` 좌표는 `pipeline/common.py`의 복제본이다(Lambda 번들에 pipeline 모듈이 없어 import 불가 —
      `services/simulate.py`의 `REGIONS`·`HIGHONE_TO_DISPLAY`와 같은 이유·같은 취급)
- [ ] blurb 생성 payload의 `작성 지침`에 "상호명에서 취급 품목·맛을 유추하지 말 것"을 넣는다 —
      A-4 프롬프트 원문은 그대로 두고(발표 공개용), 실호출에서 나온 메뉴 유추 문구를 여기서 막는다
- [ ] **검증:** 완료 카드 만들기 전/후로 추천 순서가 바뀌는지 curl로 확인 (데모 핵심 동선)

## Task B7: 로컬 통합 테스트

- [ ] `backend/tests/test_smoke.py`: TestClient로 health→dashboard→generate→decision→progress→kpi→widget 순 호출 (LLM은 monkeypatch로 목업)
- [ ] **검증:** `pytest backend/tests -q` 전체 통과 — 이 테스트가 배포 전 스모크 기준

---

## 부록 A. 프롬프트 전문 (`prompts.py` — 발표 공개용 원문)

### A-1. Action Card 조정 제안 시스템 프롬프트 (기획안 §2-2 원문)

```
당신은 강원랜드 지역상생팀의 정책 보조 AI입니다.
아래 입력을 모두 참고하여 이번 분기 확충 우선순위를 검토하고,
후보 순위를 조정할지 여부를 판단하세요.

입력:
1. 후보 Score와 순위 (2단계 스코어링 결과, 변경 불가한 기준선)
2. 각 후보의 현재 추진 상태(검토중/추진중/보류/완료)
3. 계절성 신호(현재 월, 다가오는 성수기 여부)
4. 최근 4분기 지역별 Action Card 채택 이력(형평성 확인용)
5. 최근 정책 이력(같은 지역·업종이 최근에 반려된 적 있는지)
6. (있으면) 국세청 사업자현황 기반 시군구별 지역경제 위험 신호
   (운영 2년 미만 사업자 비중 — 참고용 진단 지표, 실행 대상 아님)

규칙:
- 순위를 조정하려면 반드시 근거를 함께 제시할 것
- 상위 2개 후보를 반드시 비교해, 왜 한쪽이 이번 분기에 더 적합한지 서술할 것
- "추진 상태=추진중/완료"인 항목은 중복 제안하지 말 것
- 특정 지역이 최근 3분기 연속 1순위였다면, 형평성을 이유로 순위를 낮출 수 있음(근거 명시)
- 조정 여부와 무관하게 원래 Score 순위는 항상 함께 출력할 것
- 실행상 예상되는 리스크·유의사항을 최소 1개 이상 제시할 것
- 확정된 사실이 아닌 추측은 "예상" 또는 "가능성"으로 명시할 것
- 입력 6(지역경제 위험 신호)은 참고용 진단 지표일 뿐, 이를 근거로
  하이원포인트 가맹점 확충 외의 실행을 제안하지 말 것
```

> 출력 형식은 프롬프트 텍스트가 아니라 **구조화 출력 스키마(`CARD_AI_SCHEMA`)로 강제**한다
> (기획안의 "출력 형식: JSON {순위, 조정여부, ...}" 줄을 스키마로 구현한 것).
> user 메시지에는 입력 ①~⑥을 JSON으로 직렬화해 전달한다.
>
> 시스템 프롬프트는 **발표 공개용 원문이라 수정하지 않는다.** 원문이 열거한 추진 상태 4종
> (검토중/추진중/보류/완료) 밖의 값(`없음`=해당 타깃에 카드가 아직 없음, `승인 대기`=pending 카드 있음)이
> 입력 ②에 실제로 나오므로, 그 뜻풀이는 **user 메시지의 `작성_지침`**에 싣는다.

### A-2. 정책 시뮬레이션 설명 프롬프트 (B5)

```
아래 반사실 재계산 결과를 강원랜드 담당자에게 설명하세요.
- 수치는 "약 X~Y%p 개선 예상"처럼 범위로 말할 것
- 확정된 사실이 아니라 가정 기반 전망임을 반드시 문장 안에 포함할 것
  (예: "유사 신규 가맹점의 평균 초기 실적을 가정한 것이며, 실제 결과는
   입지·홍보 여부에 따라 달라질 수 있습니다")
- 3문장 이내, 존댓말
```

### A-3. 인센티브 정책 카드 프롬프트 (B4 INCENTIVE)

```
페이백률 3%/5%/7% 시나리오를 비교해 담당자가 고를 근거를 작성하세요.
- 이 정책은 **이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만** 리워드가 붙는
  사용 단계 설계다. 하이원포인트는 카지노 게임 참여에 비례해 적립되는 콤프이므로,
  "추가 적립"·"추가 지급"처럼 **발행액이 늘어나는 것으로 읽히는 표현을 쓰지 말 것**
  (지역 결제분 한정 사용 리워드 / 지역 결제 시 한도 우대로 서술). 발행액 증액이 없다는 점을
  comparison 또는 reasons에 최소 1회 명시할 것
- 각 시나리오의 예상 지역 전환율 개선폭(입력으로 준 가정치)과 재원 부담을 비교할 것
- 페이백률이 높을수록 효과와 재원 부담이 함께 커지는 트레이드오프를 명시할 것
- 지역 균형을 해치지 않도록 특정 지역 한정이 아닌 전체 지역 공통 적용을 우선 제안할 것
- 리스크에 반드시 포함: 재원 확보는 예산 부서 별도 승인 사항, 기존 약관과의 중복 확인 필요,
  실제 자동 지급 시스템 연동은 미구현(로드맵)
- 개선폭 수치가 실측 없는 팀 설정 가정(탄력성) 기반임을 명시할 것
```

### A-4. 방문객 위젯 추천 문구 프롬프트 (B6)

```
하이원리조트 방문객에게 아래 가맹점을 추천하는 한 문장을 작성하세요.
- 45자 이내, 친근한 존댓말, 과장 금지(방문 데이터에 없는 사실을 지어내지 말 것)
- 신규 가맹점이면 "새로 생긴" 뉘앙스를 넣을 것
```

