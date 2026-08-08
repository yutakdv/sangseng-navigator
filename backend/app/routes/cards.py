"""B2·B4·B5: Action Card CRUD·생성·상태 전이·시뮬레이션 (generate는 B4에서 추가)."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app import dataload, db, llm, prompts, security
from app.services import cardgen, progress_records, simulate, workflow

router = APIRouter()
log = logging.getLogger(__name__)

DECISIONS = ("approved", "rejected", "held")
RATES = (3, 5, 7)

ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음"   # 절대 규칙 3 — 고정 문구
NARRATIVE_SCHEMA = {
    "type": "object",
    "properties": {"narrative": {"type": "string"}},
    "required": ["narrative"],
    "additionalProperties": False,
}


class DecisionBody(BaseModel):
    decision: str
    selected_rate: int | None = None      # INCENTIVE 승인 시에만 필수 (05 문서 §2·§8)


class ProgressBody(BaseModel):
    progress: str
    idempotency_key: str | None = Field(None, min_length=1, max_length=128)


class EligibilityCheckBody(BaseModel):
    label: str
    status: str


class VerificationBody(BaseModel):
    checks: list[EligibilityCheckBody]


class GenerateBody(BaseModel):
    type: str


def _get_or_404(cid: str) -> dict:
    card = db.get_card(cid)
    if card is None:
        raise HTTPException(status_code=404, detail="card not found")
    return card


def _log(card: dict, action: str):
    """상태 변경 이력 append (05 문서 §7)."""
    card.setdefault("events", []).append({"at": db.now_iso(), "action": action})


@router.get("/cards")
def get_cards(card_type: str | None = Query(None, alias="type"), status: str | None = None):
    # 쿼리스트링 이름 `?type=`은 05 문서 §2 계약이라 alias로 유지하고, 파이썬 인자명만 바꾼다
    # (인자명 `type`은 내장 type을 가려서 이 함수 안에서 내장 함수를 못 쓰게 만든다).
    cards = db.list_cards()
    if card_type:
        cards = [c for c in cards if c.get("type") == card_type]
    if status:
        cards = [c for c in cards if c.get("status") == status]
    cards.sort(key=lambda c: c.get("created_at") or "", reverse=True)
    return {"cards": cards}


@router.post("/cards/generate", status_code=201)
def generate(
    body: GenerateBody,
    response: Response,
    _authorized: None = Depends(security.require_mutation_access),
):
    """스코어링+AI로 카드 생성 (B4) — 신규 201, 동일 타깃 pending 중복 시 기존 카드 200 (05 문서 §2·§8)."""
    if body.type not in ("EXPANSION", "INCENTIVE"):
        raise HTTPException(status_code=400, detail="type은 EXPANSION|INCENTIVE 중 하나여야 합니다")
    try:
        card, created = cardgen.generate_card(body.type)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"{exc}.json이 아직 생성되지 않았습니다") from exc
    except cardgen.NoAvailableCandidate as exc:     # 제안할 신규 후보가 하나도 없는 상태 = 409
        raise HTTPException(status_code=409,
                            detail="제안할 수 있는 신규 후보가 없습니다 (전 후보에 승인 대기 또는 진행 중인 업무가 있음)") from exc
    if not created:
        response.status_code = 200
    return {"card": card}


@router.get("/cards/{cid}")
def get_one(cid: str):
    return {"card": _get_or_404(cid)}


@router.post("/cards/{cid}/decision")
def decide(
    cid: str,
    body: DecisionBody,
    _authorized: None = Depends(security.require_mutation_access),
):
    """승인/반려/보류 — pending 카드에서만 가능 (05 문서 §8).

    검사 순서는 404(없는 ID) → 400(body 값) → 409(상태 전이). 없는 카드에 잘못된 body를 보내면
    05 §8대로 404가 나가야 하므로 카드 조회를 body 검증보다 먼저 한다.
    """
    card = _get_or_404(cid)
    if body.decision not in DECISIONS:
        raise HTTPException(status_code=400, detail="decision은 approved|rejected|held 중 하나여야 합니다")
    if card.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"pending 카드만 결정할 수 있습니다 (현재 status={card.get('status')})")
    if body.decision == "approved" and card.get("type") == "INCENTIVE":
        if body.selected_rate not in RATES:
            raise HTTPException(status_code=400, detail="selected_rate(3|5|7)가 필요합니다")
        card["selected_rate"] = body.selected_rate      # EXPANSION에 온 selected_rate는 무시
    # EXPANSION의 approved는 가맹 확정이 아니라 후보 접촉·검토 Work Item 시작이다.
    initial_progress = "후보 접촉·검토 시작" if card.get("type") == "EXPANSION" else "검토중"
    try:
        updated = db.decide_card(
            cid,
            body.decision,
            initial_progress=initial_progress,
            selected_rate=body.selected_rate if card.get("type") == "INCENTIVE" else None,
        )
    except db.ConcurrentUpdate:
        raise HTTPException(status_code=409, detail="다른 요청이 먼저 카드 결정을 변경했습니다. 새로고침 후 다시 시도하세요") from None
    return {"card": updated}


def _direction(delta_pp: list) -> str:
    """delta_pp 구간의 방향 판정 — "미미" | "개선" | "심화" | "혼재".

    delta_pp = current − projected라 양수가 집중도 하락(개선)이다. 구간이 0을 걸치면
    (lo<0<hi) 어느 쪽으로도 갈 수 있으므로 합(lo+hi) 부호로 뭉뚱그리지 않고 "혼재"로 따로 뺀다 —
    합 기준으로 판정하면 "약 -0.1~0.3%p 개선"처럼 방향을 단정하는 문장이 나간다.

    구간이 정확히 [0.0, 0.0]이면 "미미"로 먼저 뺀다. 실데이터에서 6지역×6업종 36조합 중 19개가
    여기 해당하고(시드 카드 AC-001의 타깃 영월군 카페 포함), 부호 판정에 맡기면 "약 0.0~0.0%p
    상승(집중 심화)"처럼 없는 변화를 방향까지 붙여 말하게 된다.
    """
    lo, hi = delta_pp
    if lo == 0 and hi == 0:     # -0.0 도 0 과 같다 (simulate._round_pp가 부호를 지운다)
        return "미미"
    if hi <= 0:
        return "심화"
    if lo >= 0:
        return "개선"
    return "혼재"


def _fallback_narrative(r: dict) -> str:
    """LLM 실패 시 규칙 기반 문구 — 수치 포함, '예상'·'가정' 포함, 3문장 이내 존댓말.

    동사는 `_direction`의 판정을 따른다(미미/개선/심화/혼재).
    반올림 동률(current==projected)이면 "X에서 Y로" 구절은 생략한다.
    """
    lo, hi = r["delta_pp"]
    move = ("" if r["current_index"] == r["projected_index"]
            else f"{r['current_index']}에서 {r['projected_index']}로, ")
    kind = _direction(r["delta_pp"])
    if kind == "미미":
        # 변화가 0인 이유가 둘로 갈린다 — 추정치 자체가 0인 경우(유사 가맹점 실적 없음)와
        # 추정치는 있으나 6지역 전체 규모에 견줘 작은 경우. 둘을 뭉뚱그리면 근거를 못 댄다.
        basis = ("유사 가맹점의 최근 3개월 실적이 없어 예상 월 이용 건수 추정치가 0건이라"
                 if not r["expected_monthly_count"]
                 else f"예상 월 이용 건수 약 {r['expected_monthly_count']}건이 6개 지역 전체 규모에 견주면 작아")
        return (f"{r['eup']} {r['category']} 업종에 신규 가맹점이 1곳 추가되어도 {basis}, "
                "지역 소비 집중도는 소수점 첫째 자리 기준으로 변화가 나타나지 않을 것으로 예상됩니다. "
                "이는 유사 가맹점의 평균 초기 실적을 가정한 전망이며, 실제 결과는 입지·홍보 여부에 따라 "
                "달라질 수 있습니다.")
    if kind == "개선":
        change = f"약 {lo}~{hi}%p 개선될"
    elif kind == "심화":
        change = f"약 {abs(hi)}~{abs(lo)}%p 상승(집중 심화)할"
    else:
        change = f"약 {lo}~+{hi}%p 사이로 개선·심화 양방향이 모두 가능할"
    return (f"{r['eup']} {r['category']} 업종에 신규 가맹점이 1곳 추가되면 지역 소비 집중도가 "
            f"{move}{change} 것으로 예상됩니다. "
            "이는 유사 가맹점의 평균 초기 실적을 가정한 전망이며, 실제 결과는 입지·홍보 여부에 따라 "
            "달라질 수 있습니다.")


@router.post("/cards/{cid}/simulate")
def simulate_card(
    cid: str,
    _authorized: None = Depends(security.require_internal_access),
):
    """가맹 전환 시 예상 효과 — EXPANSION 반사실 재계산 + LLM 설명 (05 문서 §2, 07 문서 B5).

    가드가 `require_internal_access`인 이유: 이 API는 카드 상태를 바꾸지 않는 **읽기 계산**이라
    05 §8의 DEMO_READ_ONLY 차단 대상이 아니다. 읽기 전용 모드에서 막으면 승인 판단에 필요한
    "가맹 전환 시 예상 효과"를 볼 수 없고, 화면에는 상태 변경도 아닌데 "읽기 전용입니다" 문구가
    뜬다. 다만 요청마다 LLM을 호출하므로 무인증 공개는 하지 않고 Bearer 토큰은 그대로 요구한다.

    표시 문구에 "확보"를 쓰지 않는다 — 가맹점은 강원랜드가 지정하는 게 아니라 사업자가 신청하고
    강원랜드가 서류접수→현장실사→계약으로 심사한다 (05 §2 표현 규칙). 필드명·경로는 그대로다.
    """
    card = _get_or_404(cid)
    if card.get("type") != "EXPANSION":     # EXPANSION 전용 — 400 규칙이 우선 (05 문서 §8)
        raise HTTPException(status_code=400, detail="INCENTIVE 카드는 scenarios를 사용합니다")
    try:
        usage = dataload.load("usage_monthly")
        merchants = dataload.load("merchants")      # §1 merchants 배열 — 요청 시점 로드
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"{exc}.json이 아직 생성되지 않았습니다") from exc
    if not merchants:       # 폴백 체인 3단계 분모(전체 가맹점 수) 0 방지 — 빈 산출물도 미준비로 본다
        raise HTTPException(status_code=503, detail="merchants.json에 가맹점이 없습니다")
    target = card.get("target") or {}
    try:
        result = simulate.simulate_expansion(usage, merchants, target.get("eup"), target.get("category"))
    except ValueError as exc:       # 집계 6지역 밖 타깃 — 계산 자체가 성립하지 않는 요청이라 400
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # narrative에 '예상'·'가정'이 항상 포함되도록 입력에 지침을 싣고, 누락 시 fallback으로 대체.
    # 음수 delta는 부호를 미리 말로 풀어 전달한다 — 원시 음수 범위를 주면 LLM이 "-0.7%p 개선"처럼
    # 방향을 잘못 서술하는 것을 실호출로 확인(픽스 라운드 1).
    kind = _direction(result["delta_pp"])
    narrative = None
    # 0을 걸치는 구간(혼재)과 변화 자체가 없는 구간(미미)은 LLM에 맡기지 않는다 —
    # 방향을 한쪽으로 단정하거나 없는 개선을 지어내는 것을 구조적으로 차단한다.
    if kind not in ("혼재", "미미"):
        lo, hi = result["delta_pp"]
        direction = (f"지역 소비 집중도가 약 {abs(hi)}~{abs(lo)}%p 상승(집중 심화)" if kind == "심화"
                     else f"지역 소비 집중도가 약 {lo}~{hi}%p 개선(집중 완화)")
        # 집중도 지수 두 값(현재·예상)은 일부러 싣지 않는다 — 변화폭이 0.05%p여도 지수 표기가
        # 한 눈금 움직이는 구간이 있어, 두 값을 주면 LLM이 "43에서 42로 1포인트 개선"처럼
        # delta_pp와 10배 어긋난 문장을 쓴다(실측). 판단에 필요한 건 방향과 폭뿐이다.
        user_payload = {
            "대상": f"{result['eup']} {result['category']} 업종 신규 가맹점 1곳",
            "예상 변화(부호 해석 완료)": direction,
            "신규 가맹점 예상 월 이용 건수(가정치)": result["expected_monthly_count"],
            "관측 기반 예상 월 이용 건수 범위": result["expected_monthly_range"],
            "범위 산출 방법": result["uncertainty_method"],
            "작성 지침": ("'예상 변화'의 방향(개선/상승)과 폭을 그대로 서술하고, 주어지지 않은 "
                      "집중도 지수 값을 지어내지 말 것. '예상'과 '가정' 두 단어를 반드시 포함할 것"),
        }
        try:
            out = llm.generate_json(prompts.SIMULATE_PROMPT, json.dumps(user_payload, ensure_ascii=False),
                                    NARRATIVE_SCHEMA, schema_name="narrative", timeout=8)
            narrative = out.get("narrative")
        except Exception:
            log.warning("simulate narrative LLM 실패 — 규칙 기반 문구로 대체 (card=%s)", cid, exc_info=True)
    # 방향 오서술 차단은 **양방향** 대칭이어야 한다 — 심화를 "개선"으로 쓰는 것만 막으면,
    # 개선 구간에서 LLM이 "상승(집중 심화)"라고 뒤집어 쓴 문장이 그대로 승인 화면에 실린다(실측).
    wrong_direction = bool(narrative) and ((kind == "심화" and "개선" in narrative)
                                           or (kind == "개선" and "심화" in narrative))
    # LLM 문구를 실제로 채택했는지 = 화면이 "AI가 쓴 문장"이라고 말해도 되는지 (05 §2 narrative_source).
    # 호출 실패·내용 가드 불통과는 물론, 혼재·미미라 애초에 호출하지 않은 구간도 여기서 False가 된다.
    used_llm = (bool(narrative) and not wrong_direction
                and "예상" in narrative and "가정" in narrative)
    if not used_llm:
        narrative = _fallback_narrative(result)
    estimate_basis = {
        1: "대상 지역·업종의 최근 3개월 가맹점당 평균",
        2: "전 지역 동일 업종의 최근 3개월 가맹점당 평균",
        3: "전 지역·전 업종의 최근 3개월 가맹점당 평균",
    }[result["fallback_step"]]
    max_change = max(abs(value) for value in result["delta_pp"])
    effect_assessment = (
        "미미" if kind in ("개선", "심화") and max_change <= 0.1 else kind
    )
    if kind == "미미" or max_change <= 0.1:
        decision_note = (
            "집중도 개선폭이 매우 작게 추정됩니다. 승인 전에 가맹 유치 비용·사업자 참여 의향·"
            "예상 월 사용건수를 비교하고, 보류도 정상적인 선택지로 검토하세요."
        )
    elif kind == "심화":
        decision_note = "집중 심화 가능성이 있어 현재 가정만으로는 승인을 권하지 않습니다."
    elif kind == "혼재":
        decision_note = "효과 방향이 불확실해 추가 데이터 없이 승인 근거로 사용하기 어렵습니다."
    else:
        decision_note = "예상 효과 범위와 가맹 유치 비용을 함께 비교한 뒤 승인 여부를 결정하세요."
    return {"simulation": {
        "current_index": result["current_index"],
        "projected_index": result["projected_index"],
        "delta_pp": result["delta_pp"],
        "expected_monthly_count": result["expected_monthly_count"],
        "expected_monthly_range": result["expected_monthly_range"],
        "uncertainty_method": result["uncertainty_method"],
        "estimate_basis": estimate_basis,
        "base_month": result["base_month"],
        "effect_assessment": effect_assessment,
        "decision_note": decision_note,
        "narrative": narrative,
        "narrative_source": "llm" if used_llm else "rule_based",
        "assumption_note": ASSUMPTION_NOTE,
    }}


@router.post("/cards/{cid}/progress")
def set_progress(
    cid: str,
    body: ProgressBody,
    _authorized: None = Depends(security.require_mutation_access),
):
    """추진 상태 변경 — approved 카드에서만 가능 (05 문서 §8).

    decision과 같은 순서: 404(없는 ID) → 400(body 값) → 409(상태 전이).
    """
    card = _get_or_404(cid)
    try:
        updated, record, created = progress_records.record_progress(
            card,
            {
                "progress": body.progress,
                "idempotency_key": body.idempotency_key,
                "note": None,
                "metrics": {},
            },
            default_source="quick_status",
        )
    except progress_records.UnsupportedProgress as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except progress_records.InvalidProgressRecord as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    except progress_records.TransitionNotAllowed as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except progress_records.IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None
    except db.ConcurrentUpdate:
        raise HTTPException(status_code=409, detail="다른 요청이 먼저 추진 상태를 변경했습니다. 새로고침 후 다시 시도하세요") from None
    return {"card": updated, "record": record, "created": created}


@router.post("/cards/{cid}/verification")
def set_verification(
    cid: str,
    body: VerificationBody,
    _authorized: None = Depends(security.require_mutation_access),
):
    """가맹점 후보의 필수 적격성 5개 항목을 기록한다.

    이 API는 가맹 확정을 만들지 않는다. 모든 항목이 충족되어야 이후 가맹 심사·추진·완료
    상태로 이동할 수 있고, 하나라도 미충족이면 후보를 부적격으로 표시한다.
    """
    card = _get_or_404(cid)
    if card.get("type") != "EXPANSION":
        raise HTTPException(status_code=400, detail="후보 적격성 확인은 EXPANSION 카드에만 적용됩니다")
    if card.get("status") != "approved":
        raise HTTPException(status_code=409, detail="후보 접촉·검토를 시작한 카드만 적격성을 기록할 수 있습니다")

    seen: set[str] = set()
    raw_checks = []
    for check in body.checks:
        if check.label not in workflow.REQUIRED_ELIGIBILITY_CHECKS:
            raise HTTPException(status_code=400, detail=f"지원하지 않는 적격성 항목입니다: {check.label}")
        if check.status not in workflow.CHECK_STATUSES:
            raise HTTPException(status_code=400, detail="check status는 unverified|verified|failed 중 하나여야 합니다")
        if check.label in seen:
            raise HTTPException(status_code=400, detail=f"중복 적격성 항목입니다: {check.label}")
        seen.add(check.label)
        raw_checks.append({"key": check.label, "label": check.label, "status": check.status})

    checks = workflow.normalize_checks(raw_checks)
    status = workflow.verification_status(checks)
    failed = [check["label"] for check in checks if check["status"] == "failed"]
    note = {
        "verified": "필수 적격성 5개 항목을 모두 확인했습니다. 다음 단계는 가맹 심사이며, 아직 가맹 확정은 아닙니다",
        "ineligible": f"미충족 항목: {', '.join(failed)}. 부적격 사유를 확인하고 보류 또는 반려를 결정하세요",
        "unverified": "미확인 항목이 남아 있습니다. 가맹 심사·추진·완료 상태로 이동할 수 없습니다",
    }[status]
    verification = {"status": status, "checks": checks, "note": note}
    try:
        updated = db.update_verification(cid, verification, expected_version=card.get("version"))
    except db.ConcurrentUpdate:
        raise HTTPException(status_code=409, detail="다른 요청이 먼저 적격성 정보를 변경했습니다. 새로고침 후 다시 시도하세요") from None
    return {"card": updated}
