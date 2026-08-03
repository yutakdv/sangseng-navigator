# 07. 백엔드 + AI 태스크 (유탁 · Phase 3~5)

> FastAPI 하나로 로컬(uvicorn)과 Lambda(Mangum)를 겸한다. 응답 형태와 엣지 케이스 규칙은
> 05 문서(특히 §8)가 정본. LLM 분기는 `llm.py` 한 곳, 프롬프트는 `prompts.py` 한 곳(부록 A 원문).
>
> **의존성 원칙:** `backend/requirements.txt`는 `fastapi, mangum, boto3, python-dotenv,
> openai, anthropic`만. **pandas·numpy 금지** — 백엔드는 JSON을 읽고 사칙연산만 하면 되고,
> 무거운 패키지는 Lambda 번들 크기·콜드스타트를 악화시킨다 (계산은 파이프라인 소관).

## Task B1: FastAPI 스캐폴딩 + 정적 데이터 서빙

**Files:** `backend/app/main.py`, `dataload.py`, `routes/dashboard.py`

```python
# app/main.py
import os
from pathlib import Path
if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):      # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
from app.routes import dashboard, cards, widget, kpi

app = FastAPI(title="상생 나침반 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (dashboard.router, cards.router, widget.router, kpi.router):
    app.include_router(r, prefix="/api")

@app.get("/api/health")
def health():
    from app.dataload import loaded_ok
    return {"ok": True, "data_loaded": loaded_ok()}

handler = Mangum(app)   # Lambda 진입점
```

```python
# app/dataload.py — processed JSON 로더 (유일한 데이터 접근 지점)
import json, functools
from pathlib import Path

CANDIDATE_DIRS = [
    Path(__file__).parent / "data",                      # Lambda 번들 (deploy 시 복사됨)
    Path(__file__).parents[2] / "data" / "processed",    # 로컬 개발
]

@functools.lru_cache(maxsize=None)
def load(name: str) -> dict:
    for d in CANDIDATE_DIRS:
        p = d / f"{name}.json"
        if p.exists():
            return json.loads(p.read_text())
    raise FileNotFoundError(name)

def loaded_ok() -> bool:
    try:
        load("dashboard"); return True
    except FileNotFoundError:
        return False
```

- [ ] `GET /api/dashboard` → `load("dashboard")` 그대로 반환
- [ ] `GET /api/candidates` → `eup_scores` + `candidates` + `merchants` 병합 반환 (05 §1)
- [ ] **검증:** `uvicorn app.main:app --port 8000` 후 `curl localhost:8000/api/dashboard | jq .conversion.headline_rate`

## Task B2: DynamoDB CRUD (`db.py`) + 카드 상태 API

```python
# app/db.py
import os, boto3
from decimal import Decimal
from datetime import datetime, timezone, timedelta
KST = timezone(timedelta(hours=9))
_table = boto3.resource("dynamodb").Table(os.environ.get("CARDS_TABLE") or "sangseng-cards")

def _clean(v):
    """boto3의 Decimal → int/float 변환 (FastAPI JSON 직렬화 깨짐 방지 — 05 문서 §8)."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
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

def now_iso(): return datetime.now(KST).isoformat(timespec="seconds")
def put_card(card: dict): _table.put_item(Item=_to_ddb(card))
def get_card(cid: str): return _clean(_table.get_item(Key={"id": cid}).get("Item"))
def list_cards(): return [_clean(i) for i in _table.scan().get("Items", [])]

def next_card_id(prefix: str) -> str:
    """AC-/INC- + 3자리 순번 (Scan 기반 — 데모 규모에서 경합 무시, 05 문서 §8)."""
    n = sum(1 for c in list_cards() if c["id"].startswith(prefix))
    return f"{prefix}{n + 1:03d}"
```

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
import os, json

def generate_json(system: str, user: str, schema: dict, schema_name: str = "result") -> dict:
    provider = os.environ.get("LLM_PROVIDER", "openai")
    if provider == "anthropic":
        import anthropic
        client = anthropic.Anthropic()
        resp = client.messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5"),
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": user}],
            thinking={"type": "disabled"},  # sonnet-5는 기본 adaptive thinking — 짧은 JSON 생성엔 지연만 늘어 끔 (Lambda 30s 내 응답 보장)
            output_config={"format": {"type": "json_schema", "schema": schema}},
        )
        text = next(b.text for b in resp.content if b.type == "text")
        return json.loads(text)
    # 기본: openai
    from openai import OpenAI
    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_schema",
                         "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
    )
    return json.loads(resp.choices[0].message.content)
```

- [ ] 위 구현 + 호출 실패 시 1회 재시도, 최종 실패 시 호출부에서 규칙 기반 fallback 사용
- [ ] **검증:** 로컬에서 두 provider 각각 1회 스모크 (`python -c ...`) — 스키마 준수 JSON 반환 확인

## Task B4: Action Card 생성 (`services/cardgen.py`) — AI 필수성의 핵심

AI 입력 스키마 (기획안 §2-2 그대로):

| 입력 | 출처 |
|---|---|
| ① 후보 Score·순위 | `candidates.json` (변경 불가 기준선) |
| ② 각 후보의 추진 상태 | DDB — 같은 (읍×업종) 타깃의 기존 카드 progress |
| ③ 계절성 신호 | 아래 캘린더 규칙 표 (`services/season.py`) |
| ④ 최근 지역별 채택 이력 | DDB — approved 카드의 target.eup 분포 |
| ⑤ 최근 정책 이력 | DDB — 같은 타깃의 rejected 이력 |
| ⑥ 지역경제 위험 신호 | `risk_signal.json` (참고용, 컷 가능) |

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
- [ ] 중복 가드: 동일 `(type, target)`의 pending 카드가 있으면 기존 카드 반환 (05 문서 §8)
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
- [ ] **검증:** delta_pp가 [0.5, 10] 안의 상식 범위, narrative에 "예상"·"가정" 포함

## Task B6: KPI + 위젯

- [ ] `GET /api/kpi`: DDB scan → 05 §3 공식 그대로 계산 (카드 0건이어도 division-by-zero 없이 응답)
- [ ] `GET /api/widget/recommend`: `merchants.json`에서 (region, category) 필터 →
      `progress=완료`인 EXPANSION 카드 타깃과 매칭되는 가맹점 `badge:"신규"` + 우선 정렬 →
      상위 3곳 + LLM blurb (실패 시 규칙 기반 문구) → INCENTIVE 완료 카드 있으면 `payback` 부여
      (`rate` = 그 카드의 `selected_rate`)
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

