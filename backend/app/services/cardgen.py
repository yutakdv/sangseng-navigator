"""B4: Action Card 생성 — AI 입력 ①~⑥ 조립 → LLM 조정 제안 → Card 생성 (docs/plan/07 B4).

절대 규칙 반영:
- AI는 제안만 — 카드는 항상 `status=pending`으로 생성, 확정은 담당자 decision API
- `original_ranking`(정량 Score 순위)은 조정 여부와 무관하게 항상 병기 (감사 가능성)
- 시뮬레이션류 문구(expected_effect)에 가정 기반 고정 문구 보장
LLM 최종 실패 시 규칙 기반 fallback (07 B3 — 데모 루프가 LLM 장애에도 완주되게).
"""
import json
import logging
from datetime import datetime, timedelta

from app import dataload, db, llm, prompts
from app.clock import KST
from app.services import season, workflow

log = logging.getLogger(__name__)

ASSUMPTION_NOTE = "가정 기반 전망이며 실제와 다를 수 있음"          # 절대 규칙 3 — 고정 문구
INCENTIVE_ASSUMPTION_NOTE = "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망"
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]
INCENTIVE_SOURCES = ["하이원포인트 사용현황"]
# 설명 문구의 출처를 화면이 구분할 수 있게 하는 근거 문장 (05 §2 grounding.narrative_status).
# LLM 응답을 받지 못했는데도 "AI는 …사용했습니다"를 그대로 싣는 것이 감사 지적 M1의 원인이라,
# 출처별로 문장을 가른다 — 데이터(grounding)와 화면 문장이 같은 사실을 말해야 한다.
# 시드 카드는 사람이 사전 검증한 문구라 또 달라서 seed_demo.SEED_NARRATIVE_NOTE 를 따로 쓴다.
NARRATIVE_NOTE = {
    "llm": "대상은 서버의 정량 규칙이 선택했고 AI는 비정량 리스크 문구 생성에만 사용했습니다",
    "rule_fallback": ("대상은 서버의 정량 규칙이 선택했고, AI 응답을 받지 못해 리스크 문구까지 "
                      "서버 규칙으로 작성했습니다"),
}
# INCENTIVE는 EXPANSION과 달리 비교문·근거 문장을 구조화 데이터로 재생성하지 않는다 —
# 3/5/7% 수치만 서버 상수(SCENARIOS)로 고정되므로 grounding을 절반만 주장한다 (05 §2).
INCENTIVE_GROUNDING_CHECKS = ["scenarios", "mandatory_risks", "assumption_note"]
# 05 §2 페이백 설계 표현 규칙 — 하이원포인트는 게임 참여에 비례해 적립되는 콤프라
# "추가 적립·추가 지급"으로 쓰면 발행액 증가(도박 유인) 논란을 자초한다. 적립이 아니라
# **사용 단계**의 리워드임이 제목에서부터 드러나게 한다 (수치·시나리오 구조는 그대로).
INCENTIVE_TITLE = "하이원포인트 지역 결제 페이백 (전 지역 공통 — 발행액 증액 없음)"
# 같은 지역×업종에 아직 끝나지 않은 업무가 있으면 새 카드를 만들지 않는다.
# 프롬프트의 최소 금지 상태(추진중/완료)보다 운영 규칙을 넓혀, 승인 대기·검토중·보류가
# 별도 카드로 복제되는 문제를 막는다. 반려된 카드는 _target_state에서 "없음"으로 돌아온다.
ACTIVE_TARGET_STATES = (
    "승인 대기",
    "검토중",
    "후보 접촉·검토 시작",
    "적격성 확인",
    "가맹 심사",
    "추진중",
    "보류",
    "완료",
)
LLM_TIMEOUT = 12                       # 1회 재시도 포함 최악 24s < Lambda 30s (07 의존성·09 타임아웃)
RECENT_WINDOW_DAYS = 365               # A-1 프롬프트의 "최근 4분기" — AI 입력 ④·⑤ 집계 창
GENERATION_DEDUPE_SECONDS = 60          # 버튼 재전송·네트워크 재시도 중복 생성 방지 창

# 3/5/7% 고정 골격 — delta_pp는 실측 없는 팀 설정 가정(탄력성) (05 문서 §2)
SCENARIOS = [
    {"rate": 3, "delta_pp": [0.5, 1.0], "budget_note": "재원 부담 낮음"},
    {"rate": 5, "delta_pp": [1.0, 2.0], "budget_note": "재원 부담 중간"},
    {"rate": 7, "delta_pp": [2.0, 3.0], "budget_note": "재원 부담 높음"},
]

# A-3 프롬프트의 필수 리스크 3종 — (키워드, 문구). LLM 출력에 키워드가 없으면 보충한다
INCENTIVE_MANDATORY_RISKS = [
    ("예산", "재원 확보는 예산 부서의 별도 승인 사항"),
    ("약관", "기존 포인트 적립·할인 약관과의 중복 적용 여부 확인 필요"),
    ("미구현", "실제 자동 지급 시스템 연동은 미구현(로드맵)"),
]

# 출력 JSON 스키마 = 05 문서 Card.ai 필드 (07 문서 B4 부록 원문)
CARD_AI_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "adjusted": {"type": "boolean"},
        "ai_rank_target": {"type": "string"},
        "comparison": {"type": "string"},
        "reasons": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "expected_effect": {"type": "string"},
        "confidence": {"type": "string", "enum": ["상", "중", "하"]},
    },
    "required": ["adjusted", "ai_rank_target", "comparison", "reasons", "risks",
                 "expected_effect", "confidence"],
}


class NoAvailableCandidate(Exception):
    """전 후보에 진행 중인 업무가 있어 새로 제안할 대상이 없음 — 중복 제안 금지의 결론.

    LLM 장애가 아니라 정상적인 도메인 신호라서 fallback 대상이 아니다 (라우트가 409로 변환).
    """


def _ranked_candidates() -> list:
    """candidates.json → Score 내림차순 순위 부여 (변경 불가 기준선 — AI 입력 ①)."""
    cands = sorted(dataload.load("candidates"), key=lambda c: c["score"], reverse=True)
    return [{**c, "rank": i + 1} for i, c in enumerate(cands)]


def _target_state(cand: dict, cards: list) -> str:
    """AI 입력 ② — 같은 (읍×업종) 타깃 기존 EXPANSION 카드의 추진 상태."""
    matches = [c for c in cards if c.get("type") == "EXPANSION"
               and (c.get("target") or {}).get("eup") == cand["eup"]
               and (c.get("target") or {}).get("category") == cand["category"]]
    approved = [c for c in matches if c.get("status") == "approved"]
    if approved:        # 여러 장이면 가장 최근 결정 카드의 progress
        latest = max(approved, key=lambda c: c.get("decided_at") or "")
        return latest.get("progress") or "검토중"
    if any(c.get("status") == "pending" for c in matches):
        return "승인 대기"
    return "없음"


def _is_recent(card: dict, cutoff: datetime) -> bool:
    """결정 시각이 최근 창(RECENT_WINDOW_DAYS) 안인가 — AI 입력 ④·⑤ 공통 필터.

    `decided_at`이 없거나 파싱 불가(naive 값이라 aware cutoff와 비교가 깨지는 경우 포함)면
    **창 밖**으로 본다. 결정 시각을 모르는 카드를 "최근 4분기"로 세면 형평성 판단이
    과대 집계되기 때문이다 (생성 경로는 모두 db.now_iso의 KST aware 값을 쓴다).
    """
    try:
        return datetime.fromisoformat(card.get("decided_at") or "") >= cutoff
    except (ValueError, TypeError):
        return False


def _weekday_signal(target: dict) -> dict | None:
    """AI 입력 ⑧ — 타깃 (읍×표시업종) 요일 패턴 요약 (참고용, 05 §6·설계 2026-08-08).

    확충 후보는 공백 업종이라 타깃 자체 실적이 0인 경우가 기본이다(예: 영월군 숙박업) —
    그때는 읍 전 업종 패턴으로 폴백하고 그 사실을 집계_대상 라벨에 명시한다.
    usage_daily.json이 없으면 None — ⑦ risk_signal과 같은 실패 내성으로 생성을 막지 않는다.
    """
    try:
        daily = dataload.load("usage_daily")
    except FileNotFoundError:
        return None
    labels = daily.get("weekday_labels") or []
    days = daily.get("weekday_days") or []
    by_cat = (daily.get("weekday_category") or {}).get(target["eup"]) or {}
    if len(labels) != 7 or len(days) != 7 or min(days, default=0) <= 0:
        return None
    counts = by_cat.get(target["category"]) or []
    scope = f"{target['eup']} {target['category']}"
    if len(counts) != 7 or sum(counts) == 0:
        counts = [sum(c[i] for c in by_cat.values() if len(c) == 7) for i in range(7)]
        scope = (f"{target['eup']} 전 업종 — 타깃 업종은 하이원포인트 사용 실적이 없어"
                 " (공백 업종 = 확충 후보인 이유) 읍 전체 방문 리듬으로 대신함")
        if sum(counts) == 0:
            return None
    avg = [round(c / d, 1) for c, d in zip(counts, days)]
    weekday_avg = sum(counts[:5]) / sum(days[:5])          # 인덱스 0~4 = 월~금 (dayofweek 계약)
    weekend_avg = sum(counts[5:]) / sum(days[5:])
    return {
        "집계_대상": scope,
        "요일별_하루평균_건수": dict(zip(labels, avg)),
        "최대_요일": labels[max(range(7), key=lambda i: avg[i])],
        "주중_대비_주말_배율": round(weekend_avg / weekday_avg, 2) if weekday_avg else None,
        "출처": "하이원포인트 사용현황 일 단위 집계 (2025년 365일)",
    }


def _build_inputs(cands: list, cards: list, selected_target: dict) -> dict:
    """AI 입력 ①~⑧ 조립 — user 메시지로 JSON 직렬화된다 (07 문서 B4 표 + ⑧ 요일 패턴)."""
    cutoff = datetime.now(KST) - timedelta(days=RECENT_WINDOW_DAYS)   # ④·⑤는 "최근 4분기"만 (A-1)
    adopted: dict[str, int] = {}
    for c in cards:                                     # ④ 최근 창 안 approved 카드의 target.eup 분포
        eup = (c.get("target") or {}).get("eup")
        if (c.get("status") == "approved" and c.get("type") == "EXPANSION" and eup
                and _is_recent(c, cutoff)):
            adopted[eup] = adopted.get(eup, 0) + 1
    rejected = [                                        # ⑤ 같은 타깃의 rejected 이력 (최근 창 안)
        {"타깃": f"{(c.get('target') or {}).get('eup')} {(c.get('target') or {}).get('category')}",
         "결정": "반려", "결정 시각": c.get("decided_at")}
        for c in cards if c.get("status") == "rejected" and c.get("target") and _is_recent(c, cutoff)]
    try:
        risk = dataload.load("risk_signal")             # ⑥ 참고용 — 없으면 컷 (07 문서 B4)
    except FileNotFoundError:
        risk = []
    return {
        "1_후보_Score와_순위(변경_불가_기준선)": [
            {"순위": c["rank"], "지역": c["eup"], "업종": c["category"], "상호명": c["name"],
             "Score": c["score"], "업종공백도": c["gap"], "관광동선근접도": c["proximity"],
             "기존가맹포화도": c["saturation"],
             "반경500m_동일업종_하이원_가맹점": c["nearby_merchants"],
             "반경500m_동일업종_상가": c.get("nearby_same_category_stores"),
             "반경500m_전체_상가(참고)": c["nearby_stores"],
             # 근접도는 직선거리 기반이라 산악 지형에서 실제 접근성과 역전된다 — AI가 그 역전을
             # 근거로 지적할 수 있게 병기한다(05 §1). 순위 재정렬 용도가 아니다.
             "거점에서_도로_소요시간_분": c.get("road_minutes"),
             "거점에서_도로_거리_km": c.get("road_distance_km")} for c in cands],
        "2_서버가_확정한_제안_대상": {
            "타깃": f"{selected_target['eup']} {selected_target['category']}",
            "선택_규칙": "진행 중인 업무가 없는 후보 중 후보 스코어 최상위",
            "Score": selected_target["score"],
            "정량_순위": selected_target["rank"],
        },
        "3_후보별_현재_추진_상태": [
            {"후보": f"{c['eup']} {c['category']}", "추진 상태": _target_state(c, cards)}
            for c in cands],
        "4_계절성_신호": season.season_signal(),
        "5_최근_지역별_채택_이력": adopted,
        "6_최근_정책_이력(반려)": rejected,
        "7_지역경제_위험_신호(참고용_진단_지표)": risk,
        **({"8_타깃_요일_패턴(참고용)": weekday} if (weekday := _weekday_signal(selected_target)) else {}),
        "작성_지침": (f"ai_rank_target에는 서버 확정 타깃 '{selected_target['eup']} "
                   f"{selected_target['category']}'을 그대로 적을 것. 후보를 바꾸지 말 것. "
                   "입력 3의 '추진 상태' 값은 없음/승인 대기/검토중/추진중/보류/완료 중 하나이며, "
                   "'없음'은 해당 타깃에 아직 카드가 없다는 뜻, '승인 대기'는 아직 결정되지 않은 "
                   "pending 카드가 있다는 뜻이다. "
                   "서버가 활성 상태 후보를 이미 제외했으므로 이를 다시 선택하지 말 것. "
                   "입력 1의 수치에 없는 사실은 지어내지 말 것. "
                   "관광동선근접도는 직선거리 기반이고 도로 소요시간은 공개 라우팅 API 추정치이므로, "
                   "둘이 어긋나면 거리 수치를 단정하지 말고 '직선으로는 가깝지만 차로는 더 걸린다' "
                   "처럼 소요시간 비교로 서술할 것. Score 순위 자체는 변경 불가 기준선이다"),
    }


def _available(cands: list, cards: list) -> list:
    """동일 타깃의 진행 중인 업무가 없는 후보 목록 (Score 순위 유지)."""
    return [c for c in cands if _target_state(c, cards) not in ACTIVE_TARGET_STATES]


def _first_available(cands: list, cards: list) -> dict:
    """진행 중인 업무가 없는 정량 최상위 후보.

    전 후보가 진행 중인 업무 상태면 `cands[0]`으로 물러서지 않고 예외를 낸다. 후보가 5개뿐이라
    실제로 도달 가능하고, 물러서면 동일 대상의 중복 업무 카드가 저장된다.
    """
    available = _available(cands, cards)
    if not available:
        raise NoAvailableCandidate("모든 후보에 승인 대기 또는 진행 중인 업무가 있어 새로 제안할 후보가 없습니다")
    return available[0]


def _fallback_ai(cands: list, cards: list) -> dict:
    """LLM 최종 실패 시 규칙 기반 fallback — 진행 중인 업무가 없는 최상위 후보 제안.

    반환값 중 실제로 카드에 남는 것은 `risks`뿐이다 — comparison·reasons·expected_effect는
    `_grounded_ai`가 정본 데이터로 다시 만든다. 아래 "AI 설명 생성에 실패해…" 문장도 화면에
    도달하지 않으므로, 폴백 사실을 화면에 알리는 몫은 `NARRATIVE_NOTE["rule_fallback"]`이 진다.
    """
    top = _first_available(cands, cards)
    skipped = [c for c in cands if c["rank"] < top["rank"]]
    reasons = [f"Score {c['rank']}위 {c['eup']} {c['category']}은(는) 추진 상태={_target_state(c, cards)}로 중복 제안 대상에서 제외"
               for c in skipped]
    reasons.append(f"{top['eup']} {top['category']} — 업종공백도 {top['gap']}, 반경 500m 내 동일 업종 하이원 가맹점 {top['nearby_merchants']}곳")
    reasons.append("AI 설명 생성에 실패해 규칙 기반으로 제안된 카드입니다")
    second = next((c for c in cands if c["rank"] != top["rank"]), top)
    return {
        "adjusted": top["rank"] != 1,
        "ai_rank_target": f"{top['eup']} {top['category']}",
        "comparison": (f"1순위 {top['eup']} {top['category']}(Score {top['score']}, {top['rank']}위)와 "
                       f"차순위 {second['eup']} {second['category']}(Score {second['score']}, {second['rank']}위) 중 "
                       "추진 상태와 Score를 함께 고려한 규칙 기반 제안입니다."),
        "reasons": reasons,
        "risks": ["신규 가맹점 초기 실적 저조 가능성", "가맹 협상이 분기 내 완료되지 않을 가능성"],
        "expected_effect": f"{top['eup']} {top['category']} 공백 해소로 지역 소비 접점 확대 예상",
        "confidence": "중",
    }


def _road_text(cand: dict) -> str:
    """후보 비교에 쓰는 도로 소요시간 — 원본 값이 없으면 단정하지 않는다."""
    minutes = cand.get("road_minutes")
    return "도로 소요시간 미산출" if minutes is None else f"도로 소요시간 약 {minutes:.1f}분"


def _grounded_ai(cands: list, target: dict, out: dict, cards: list,
                 explanation_source: str) -> dict:
    """LLM 자유서술을 구조화된 사실로 다시 접지한다.

    LLM은 비정량 리스크 문구 생성에만 관여한다. 화면에 표시하는 후보명·Score·순위·
    추진 상태·도로 시간은 모두 candidates/cards의 정본 값으로 재생성해, "0.57이 0.67보다 높다"
    같은 문장-표 자기모순이 저장되지 않게 한다.
    """
    baseline = cands[0]
    alternative = baseline if target["rank"] != baseline["rank"] else next(
        (c for c in cands if c["rank"] != target["rank"]), target
    )
    if target["rank"] == baseline["rank"]:
        comparison = (
            f"정량 1위 {target['eup']} {target['category']}(Score {target['score']})를 서버 제안 대상으로 "
            f"유지했습니다. 차순위 {alternative['eup']} {alternative['category']}(Score "
            f"{alternative['score']})와 비교했으며, {target['eup']} {target['category']}의 "
            f"{_road_text(target)}을 함께 확인해야 합니다."
        )
    else:
        gap = round(baseline["score"] - target["score"], 2)
        skipped = [
            f"{c['eup']} {c['category']}({_target_state(c, cards)})"
            for c in cands if c["rank"] < target["rank"]
        ]
        comparison = (
            f"정량 상위 후보 {', '.join(skipped)}는 진행 중인 업무가 있어 중복 제안에서 제외했습니다. "
            f"따라서 선택 가능한 후보 중 최고점인 정량 {target['rank']}위 {target['eup']} "
            f"{target['category']}(Score {target['score']})를 서버가 선택했습니다. 정량 1위 "
            f"{baseline['eup']} {baseline['category']}(Score {baseline['score']})보다 Score가 {gap} "
            "낮으므로 기존 업무 종료 여부와 함께 검토해야 합니다."
        )

    reasons = [
        f"정량 기준: Score {target['score']} · {target['rank']}위",
        (f"상권 기준: 업종공백도 {target['gap']} · 반경 500m 내 동일 업종 하이원포인트 "
         f"가맹점 {target['nearby_merchants']}곳 / 동일 업종 상가 "
         f"{target.get('nearby_same_category_stores', '미산출')}곳"),
        f"이동 기준: 동선근접도 {target['proximity']}는 직선거리 기반 · {_road_text(target)}",
        # 이 문장만이 화면에서 "AI가 무엇을 했는가"를 말한다 — 실제 출처와 어긋나면 안 된다.
        # 계약 밖 값이 들어오면 AI를 주장하지 않는 쪽(rule_fallback)으로 떨어뜨린다.
        NARRATIVE_NOTE.get(explanation_source, NARRATIVE_NOTE["rule_fallback"]),
    ]
    risks = [r.strip() for r in out.get("risks", []) if isinstance(r, str) and r.strip()]
    required_risks = [
        "가맹 신청은 사업자 의사에 달려 있어 후보 접촉 후에도 계약이 성사되지 않을 가능성",
        "영업 상태·가맹 자격·관광객 이용 적합성은 승인 전 별도 확인 필요",
    ]
    for risk in required_risks:
        if risk not in risks:
            risks.append(risk)

    return {
        "adjusted": target["rank"] != 1,
        "comparison": comparison,
        "reasons": reasons,
        "risks": risks,
        "expected_effect": _ensure_assumption(
            f"{target['eup']} {target['category']} 후보의 가맹 전환 효과는 카드 상세의 반사실 "
            "시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다"
        ),
        "grounding": {
            "status": "verified",
            "numeric_status": "verified",
            "narrative_status": ("ai_generated_unverified" if explanation_source == "llm"
                                 else "rule_based"),
            "selection_method": "deterministic_highest_available_score",
            "explanation_source": explanation_source,
            "source": "structured",
            "checks": ["target", "score", "rank", "progress", "road_time"],
        },
    }


def _ensure_assumption(text: str) -> str:
    """expected_effect에 가정 기반 **고정 문구** 보장 (절대 규칙 3).

    '가정' 키워드 포함만으로는 고정 문구 없는 카드가 통과할 수 있어 문구 전체로 판정한다.
    """
    return text if ASSUMPTION_NOTE in text else f"{text} ({ASSUMPTION_NOTE})"


def _find_pending(cards: list, card_type: str, eup: str | None = None,
                  category: str | None = None) -> dict | None:
    """중복 가드 — 동일 (type, target)의 pending 카드 (05 문서 §8, INCENTIVE는 target 무관)."""
    for c in cards:
        if c.get("type") != card_type or c.get("status") != "pending":
            continue
        target = c.get("target") or {}
        if card_type == "INCENTIVE" or (target.get("eup") == eup and target.get("category") == category):
            return c
    return None


def _recent_generated(cards: list, card_type: str) -> dict | None:
    """직전 60초 안에 알고리즘이 만든 pending 카드가 있으면 재전송 결과로 재사용한다."""
    now = datetime.now(KST)
    matches = []
    for card in cards:
        generation = card.get("generation") or {}
        if (card.get("type") != card_type or card.get("status") != "pending"
                or generation.get("source") != "algorithm"):
            continue
        try:
            created = datetime.fromisoformat(card.get("created_at") or "")
            age = (now - created).total_seconds()
        except (ValueError, TypeError):
            continue
        if 0 <= age <= GENERATION_DEDUPE_SECONDS:
            matches.append(card)
    return max(matches, key=lambda card: card.get("created_at") or "") if matches else None


def generate_card(card_type: str) -> tuple[dict, bool]:
    """POST /api/cards/generate 본체 — (card, created) 반환. created=False면 기존 pending 카드.

    선택 가능한 후보가 하나도 없으면 `NoAvailableCandidate` (라우트가 409로 변환).
    """
    cards = db.list_cards()
    if card_type == "INCENTIVE":
        return _generate_incentive(cards)
    return _generate_expansion(cards)


def _generate_expansion(cards: list) -> tuple[dict, bool]:
    recent = _recent_generated(cards, "EXPANSION")
    if recent is not None:
        return recent, False
    cands = _ranked_candidates()
    # LLM 호출 **전**에 후보 가용성부터 본다 — NoAvailableCandidate가 아래 except에 잡혀
    # fallback으로 흘러가면 안 되기 때문(그러면 금지 타깃 카드가 만들어진다).
    available = _available(cands, cards)
    if not available:
        raise NoAvailableCandidate("모든 후보에 승인 대기 또는 진행 중인 업무가 있어 새로 제안할 후보가 없습니다")
    # 대상 선택은 LLM에 맡기지 않는다. 동일 입력·상태에서는 항상 같은 후보가 선택된다.
    target = available[0]
    explanation_source = "llm"
    try:
        out = llm.generate_json(prompts.CARD_SYSTEM_PROMPT,
                                json.dumps(_build_inputs(cands, cards, target), ensure_ascii=False),
                                CARD_AI_SCHEMA, schema_name="action_card", timeout=LLM_TIMEOUT)
    except Exception:
        # 심사 기간에 키 만료·쿼터 초과를 알아챌 유일한 흔적 (감사 ⑤ — 이전엔 조용히 삼켰다)
        log.warning("EXPANSION 카드 AI 설명 생성 실패 — 규칙 기반 fallback으로 진행합니다", exc_info=True)
        out = _fallback_ai(cands, cards)
        explanation_source = "rule_fallback"

    existing = _find_pending(cards, "EXPANSION", target["eup"], target["category"])
    if existing:                                        # 05 §8 — 기존 카드 200 반환 (버튼 연타 대비)
        return existing, False

    grounded = _grounded_ai(cands, target, out, cards, explanation_source)
    now = db.now_iso()
    card = {
        "id": db.next_card_id("AC-"),
        "type": "EXPANSION", "status": "pending", "progress": None,
        "generation": {"source": "algorithm", "dedupe_window_seconds": GENERATION_DEDUPE_SECONDS},
        "title": f"{target['eup']} {target['category']} 업종 가맹점 확충",
        "target": {"eup": target["eup"], "category": target["category"]},
        "score_rank": target["rank"],
        "ai_rank": 1,                                   # 이전 API 호환: 최종 제안 목록 내 순위
        "selection_rank": 1,
        # 표본 신뢰도가 낮거나 도로 접근성이 미산출이면 보수적으로 낮춘다. LLM 자기평가는 쓰지 않는다.
        "confidence": ("중" if target.get("gap_confidence", 0) >= 0.8
                       and target.get("road_minutes") is not None else "하"),
        "ai": {
            # 표시 일관성: 조정 여부 = (원 Score 순위 ≠ 1) — LLM 출력과 어긋나면 순위 쪽이 정본
            "adjusted": target["rank"] != 1,
            "comparison": grounded["comparison"],
            "reasons": grounded["reasons"],
            "risks": grounded["risks"],
            "expected_effect": grounded["expected_effect"],
            "grounding": grounded["grounding"],
            "original_ranking": [                        # 정량 순위 상시 병기 (절대 규칙 5)
                {"rank": c["rank"], "candidate": f"{c['eup']} {c['category']}", "score": c["score"]}
                for c in cands],
        },
        "scenarios": None,
        "candidate_verification": {
            "status": "unverified",
            "checks": [
                {"key": label, "label": label, "status": "unverified"}
                for label in workflow.REQUIRED_ELIGIBILITY_CHECKS
            ],
            "note": "후보 접촉·검토 시작은 가맹 확정이 아닙니다. 필수 적격성 확인 후 별도 가맹 심사를 거칩니다",
        },
        "operations": {
            "owner": None,
            "target_date": None,
            "expected_cost": None,
            "contact_result": None,
            "ineligible_reason": None,
            "actual_outcome": None,
        },
        "sources": EXPANSION_SOURCES,
        "created_at": now, "decided_at": None,
        "events": [{"at": now, "action": "generated"}],
    }
    db.create_card(card)
    return card, True


def _incentive_fallback_ai() -> dict:
    """INCENTIVE LLM 최종 실패 시 — 05 문서 §2 INC-001 예시의 ai 원문 (실데이터와 정합 확인됨)."""
    return {
        "adjusted": False, "ai_rank_target": "전 지역 공통",
        "comparison": ("세 시나리오 모두 이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 "
                       "리워드가 붙는 사용 단계 설계로, 콤프 발행액 증액은 수반하지 않습니다. "
                       "3%는 재원 부담이 가장 낮지만 개선폭이 0.5~1.0%p로 제한적이고, 7%는 "
                       "2.0~3.0%p로 가장 크지만 재원 부담도 함께 커집니다. 5%는 개선폭 1.0~2.0%p·"
                       "재원 부담 중간으로, 분기 내 효과 확인과 재원 방어를 동시에 노리는 절충안입니다."),
        "reasons": [
            "적립이 아닌 사용 단계 정책 — 지역 가맹점 결제분에 한정해 리워드가 붙으므로 콤프 발행액(적립)은 늘지 않고 게임 참여 유인과도 무관",
            "지역 전환율이 월별 17~23%대에서 오르내려 저점 월을 방어할 수요 측 유인이 필요",
            "사용 건수가 사북읍·태백시에 절반 이상 몰려 있어도 전 지역 공통 적용은 분포를 바꾸지 않아 지역 균형을 왜곡하지 않음",
            "페이백률이 높을수록 효과와 재원 부담이 함께 커지는 트레이드오프가 뚜렷",
        ],
        "risks": [text for _, text in INCENTIVE_MANDATORY_RISKS],
        "expected_effect": "5% 적용 시 지역 전환율 약 1.0~2.0%p 개선 예상 (가정 기반 전망이며 실제와 다를 수 있음)",
        "confidence": "중",
    }


def _generate_incentive(cards: list) -> tuple[dict, bool]:
    existing = _find_pending(cards, "INCENTIVE")        # pending INCENTIVE는 동시에 1장만 (05 §8)
    if existing:
        return existing, False

    explanation_source = "llm"      # EXPANSION 경로와 같은 추적 방식 (아래 except에서 뒤집힌다)
    try:
        dash = dataload.load("dashboard")
        rates = [m["rate"] for m in dash["conversion"]["monthly"]]
        payload = {
            "페이백_시나리오(팀_설정_가정)": SCENARIOS,
            "지역_전환율_근사지표(%)": {"최근": dash["conversion"]["headline_rate"],
                                 "월별_범위": [min(rates), max(rates)]},
            "지역별_사용_비중": dash["region_share"],
        }
        out = llm.generate_json(prompts.INCENTIVE_PROMPT, json.dumps(payload, ensure_ascii=False),
                                CARD_AI_SCHEMA, schema_name="incentive_card", timeout=LLM_TIMEOUT)
    except Exception:
        # 감사 ⑤ — 로그 없이 삼키면 LLM 장애를 심사 중에 알 방법이 없다
        log.warning("INCENTIVE 카드 AI 설명 생성 실패 — 규칙 기반 fallback으로 진행합니다", exc_info=True)
        out = _incentive_fallback_ai()
        explanation_source = "rule_fallback"

    risks = [r for r in out.get("risks", []) if isinstance(r, str) and r.strip()]
    for keyword, text in INCENTIVE_MANDATORY_RISKS:     # A-3 필수 리스크 3종 보장
        if not any(keyword in r for r in risks):
            risks.append(text)
    now = db.now_iso()
    card = {
        "id": db.next_card_id("INC-"),
        "type": "INCENTIVE", "status": "pending", "progress": None,
        "title": INCENTIVE_TITLE,
        "target": None, "score_rank": None, "ai_rank": None,
        "confidence": out.get("confidence") if out.get("confidence") in ("상", "중", "하") else "중",
        "ai": {
            "adjusted": False,                          # 순위 개념 없음 — 항상 false
            "comparison": out.get("comparison", ""),
            "reasons": [r for r in out.get("reasons", []) if isinstance(r, str) and r.strip()],
            "risks": risks,
            "expected_effect": _ensure_assumption(out.get("expected_effect", "")),
            "grounding": {
                # EXPANSION과 달리 status는 partial — 수치는 서버 고정이지만 비교문·근거는
                # LLM(또는 폴백) 원문을 그대로 쓰므로 문장까지 재검증했다고 주장할 수 없다.
                "status": "partial",
                "numeric_status": "fixed_by_server",
                "narrative_status": ("ai_generated_unverified" if explanation_source == "llm"
                                     else "rule_based"),
                "selection_method": "fixed_scenarios_3_5_7",
                "explanation_source": explanation_source,
                "source": "structured",
                "checks": INCENTIVE_GROUNDING_CHECKS,
            },
            "original_ranking": None,                   # INCENTIVE만 null (05 문서 §2)
        },
        "scenarios": SCENARIOS,
        "selected_rate": None,                          # 승인 시점에 담당자가 고른 값만 (B2)
        "assumption_note": INCENTIVE_ASSUMPTION_NOTE,
        "sources": INCENTIVE_SOURCES,
        "created_at": now, "decided_at": None,
        "events": [{"at": now, "action": "generated"}],
    }
    db.create_card(card)
    return card, True
