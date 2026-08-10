"""데모 시드 — 데모 초기 상태 카드 3장 (T11, docs/plan/11 §1 '사전 상태'의 원천).

사용법 (레포 루트 또는 backend/ 어디서든, DynamoDB Local 기준):
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --init    # 테이블 생성만 (T7 local_init 겸용)
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --reset   # 테이블 전체 비우고 데모 3장 시드

--reset은 테이블이 없으면 만들고, 있으면 전부 비운 뒤 시드한다 (리허설·심사 리셋 — 11 문서 §4).
전체 비우는 이유: 비순차 목업 ID(AC-9xx 등)가 남아 있으면 next_card_id가 충돌한다 (T9 보고서 인계).

시드 카드 (2026-08-05 개선 산식으로 재산출한 candidates.json 기준):
  A) AC-001 EXPANSION 영월군×음식점 — approved+후보 접촉·검토 시작. 정량 1위가 이미
     진행 중이라는 운영 상태를 만든다. created 2일 전·decided 1.5일 전이라 의사결정 12시간이다.
  B) AC-002 EXPANSION 영월군×소매점 — pending. 정량 1위가 진행 중인 업무여서 서버가 선택 가능한 후보 중
     최고점인 2위를 선택한 중복 회피 사례다. 대상 선택은 결정론적이며 LLM은 리스크 설명만 보조한다.
     ⚠ 두 카드는 리허설 재현성을 위한 고정 JSON이고, 방금 생성된 AI 결과라고 말하지 않는다.
  C) INC-001 INCENTIVE — pending, 05 §2 INC-001 예시 구조 재사용 (수치는 실데이터와 정합 확인됨)
"""
import argparse
import os
import sys
from datetime import datetime, timedelta

if os.environ.get("DYNAMO_ENDPOINT"):       # DynamoDB Local은 자격증명 "형식"만 요구 — 실AWS는 건드리지 않음
    os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # backend/ 밖에서 실행해도 app import
from app import db, progress_db  # noqa: E402  (환경변수 세팅 뒤에 import해야 boto3 리소스가 올바로 붙는다)
from app.services import cardgen  # noqa: E402  (B1 — 시드 카드의 dissent 고정 문구를 그대로 재사용)

TABLE_NAME = os.environ.get("CARDS_TABLE") or "sangseng-cards"   # 빈 문자열 방어 — db.py 와 동일


def _iso(hours_ago: float) -> str:
    return (datetime.now(db.KST) - timedelta(hours=hours_ago)).isoformat(timespec="seconds")


# ── 실측 정량 순위 (data/processed/candidates.json, 2026-08-04 재산출분) — 전 카드 공통 병기 ──
# 05 §2 계약 형태(rank/candidate/score)라 상호명은 넣지 않는다. 상호명은 아래 별도 상수로 대조한다.
ORIGINAL_RANKING = [
    {"rank": 1, "candidate": "영월군 음식점", "score": 0.5},
    {"rank": 2, "candidate": "영월군 소매점", "score": 0.49},
    {"rank": 3, "candidate": "영월군 숙박업", "score": 0.48},
    {"rank": 4, "candidate": "삼척시 편의점", "score": 0.45},
    {"rank": 5, "candidate": "삼척시 카페", "score": 0.42},
]
# 카드 문구(비교문·근거)에 상호명이 직접 박혀 있다 — 순위·점수가 같아도 대표 상가는 바뀔 수 있어 함께 대조
ORIGINAL_CANDIDATE_NAMES = ["황금식당", "백민농장", "솔고개민박", "빈이슈퍼", "삼척맛척커피이야기"]
# 카드 근거에 도로 소요시간을 표시하므로 rank·score·상호와 함께 대조한다.
ORIGINAL_CANDIDATE_ROAD_MINUTES = [35.2, 35.9, 44.1, 41.5, 34.2]
# 카드 '상권/이동 기준' 문장이 인용하는 값 — (업종공백도, 동선근접도, 동일 업종 상가 수).
# 이 셋은 /candidates 표에 그대로 보이므로 카드와 어긋나면 두 화면을 대조하는 즉시 드러난다.
ORIGINAL_CANDIDATE_EVIDENCE = [
    (0.83, 0.68, 4), (0.75, 0.71, 2), (0.83, 0.62, 4), (0.86, 0.51, 5), (0.75, 0.52, 2),
]
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]
GROUNDING = {
    "status": "verified",
    "numeric_status": "verified",
    "narrative_status": "rule_based",
    "selection_method": "deterministic_highest_available_score",
    "explanation_source": "rule_seed",
    "dissent_source": "rule_based",      # B1 — 시드 카드는 AI 호출이 없으므로 항상 rule_based
    "source": "structured",
    "checks": ["target", "score", "rank", "progress", "road_time"],
}
INCENTIVE_GROUNDING = {
    "status": "partial",                 # 시나리오 수치만 서버 고정 — 문장은 재검증 대상이 아니다
    "numeric_status": "fixed_by_server",
    "narrative_status": "rule_based",
    "selection_method": "fixed_scenarios_3_5_7",
    "explanation_source": "rule_seed",
    "dissent_source": "rule_based",      # B1
    "source": "structured",
    "checks": ["scenarios", "mandatory_risks", "assumption_note"],
}
# B1 — 반대 의견(dissent) 3항. 시드 카드는 AI 호출 없이 고정된 규칙 문구이므로 실제 카드 생성 경로
# (cardgen)의 폴백·인센티브 문구를 그대로 재사용해 화면·문서 문구가 갈리지 않게 한다.
EXPANSION_DISSENT = list(cardgen.DISSENT_FALLBACK)
INCENTIVE_DISSENT = list(cardgen.INCENTIVE_DISSENT)
# 시드 카드의 설명 문구는 사람이 실데이터로 검증해 고정한 값이다 — AI가 만든 문장이 아니므로
# "AI는 …사용했습니다" 문장을 쓰면 화면이 거짓을 말하게 된다 (05 §2 grounding).
SEED_NARRATIVE_NOTE = ("대상은 서버의 정량 규칙이 선택했고, 이 설명 문구는 실데이터로 사전 검증한 "
                       "규칙 기반 예시입니다(AI 호출 없음)")
CANDIDATE_VERIFICATION = {
    "status": "unverified",
    "checks": [
        {"key": label, "label": label, "status": "unverified"}
        for label in ("영업 상태", "가맹 자격", "사업자 참여 의향", "관광객 이용 적합성", "정산 연동 가능성")
    ],
    "note": "후보 접촉·검토 시작은 가맹 확정이 아닙니다. 필수 적격성 확인 후 별도 가맹 심사를 거칩니다",
}
EMPTY_OPERATIONS = {
    "owner": None, "target_date": None, "expected_cost": None,
    "contact_result": None, "ineligible_reason": None, "actual_outcome": None,
}


def assert_ranking_matches_pipeline() -> None:
    """하드코딩 순위·점수·상호명이 현재 candidates.json 과 어긋나면 즉시 중단한다.

    데모 카드 문구는 사람이 실데이터로 검증한 값이라 동적으로 조립하지 않는다. 대신 파이프라인을
    다시 돌려 점수가 바뀌면 여기서 크게 실패시킨다 — 조용히 어긋나면 '정량 순위 병기'(절대 규칙 5)가
    거짓이 되고, 감사 가능성 주장 자체가 무너진다. 실패하면 문구를 새 산출에 맞춰 갱신할 것.
    """
    from app import dataload

    rows = dataload.load("candidates")
    actual = [{"rank": i, "candidate": f"{c['eup']} {c['category']}", "score": c["score"]}
              for i, c in enumerate(rows, 1)]
    names = [c["name"] for c in rows]
    roads = [c.get("road_minutes") for c in rows]
    if actual != ORIGINAL_RANKING or names != ORIGINAL_CANDIDATE_NAMES:
        raise SystemExit(
            "seed_demo 중단: 하드코딩 정량 순위가 data/processed/candidates.json 과 다릅니다 "
            "(파이프라인 재산출 후 데모 카드 문구를 갱신해야 합니다).\n"
            f"  하드코딩: {ORIGINAL_RANKING} / {ORIGINAL_CANDIDATE_NAMES}\n"
            f"  실산출  : {actual} / {names}"
        )
    if roads != ORIGINAL_CANDIDATE_ROAD_MINUTES:
        # null 이면 OSRM 조회 실패분이 그대로 산출된 것 — 카드 B의 "차로 50분대/30분대" 근거가
        # 사라지므로 조용히 넘기지 않는다. p6_scoring.annotate_road_access 로그를 먼저 확인할 것.
        raise SystemExit(
            "seed_demo 중단: 카드 근거인 도로 소요시간이 candidates.json 과 다릅니다 "
            "(null이면 OSRM 조회 실패 — 재조회 후 다시 시도).\n"
            f"  하드코딩: {ORIGINAL_CANDIDATE_ROAD_MINUTES}\n"
            f"  실산출  : {roads}"
        )
    evidence = [(c["gap"], c["proximity"], c.get("nearby_same_category_stores")) for c in rows]
    if evidence != ORIGINAL_CANDIDATE_EVIDENCE:
        raise SystemExit(
            "seed_demo 중단: 카드 '상권/이동 기준' 문장이 인용하는 값(업종공백도·동선근접도·"
            "동일 업종 상가 수)이 candidates.json 과 다릅니다.\n"
            f"  하드코딩: {ORIGINAL_CANDIDATE_EVIDENCE}\n"
            f"  실산출  : {evidence}"
        )


def demo_cards() -> list:
    """데모 3장 — 문구의 수치는 전부 실데이터 검증본 (task-11-report.md 근거 기재)."""
    assert_ranking_matches_pipeline()
    # 카드 A: 후보 접촉·검토 시작 — 적격성 확인 전 가맹 확정처럼 보이지 않게 한다.
    card_a = {
        "id": "AC-001", "type": "EXPANSION", "status": "approved", "progress": "후보 접촉·검토 시작",
        "title": "영월군 음식점 업종 가맹점 확충",
        "target": {"eup": "영월군", "category": "음식점"},
        "score_rank": 1, "ai_rank": 1, "selection_rank": 1, "confidence": "중",
        "ai": {
            "adjusted": False,
            "selection_reason": "top_score",
            "comparison": (
                "정량 1위 영월군 음식점(Score 0.5)을 서버 제안 대상으로 유지했습니다. 차순위 "
                "영월군 소매점(Score 0.49)과 비교했으며, 영월군 음식점의 도로 소요시간 약 "
                "35.2분을 함께 확인해야 합니다."),
            "reasons": [
                "정량 기준: Score 0.5 · 1위",
                "상권 기준: 업종공백도 0.83 · 반경 500m 내 동일 업종 하이원포인트 가맹점 0곳 / 동일 업종 상가 4곳",
                "이동 기준: 동선근접도 0.68은 직선거리 기반 · 도로 소요시간 약 35.2분",
                SEED_NARRATIVE_NOTE,
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어 후보 접촉 후에도 계약이 성사되지 않을 가능성",
                "영업 상태·가맹 자격·관광객 이용 적합성은 승인 전 별도 확인 필요",
            ],
            "expected_effect": "영월군 음식점 후보의 가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
            "dissent": EXPANSION_DISSENT,
            "grounding": GROUNDING,
            "original_ranking": ORIGINAL_RANKING,
        },
        "scenarios": None,
        "candidate_verification": CANDIDATE_VERIFICATION,
        "operations": EMPTY_OPERATIONS,
        "sources": EXPANSION_SOURCES,
        "created_at": _iso(48), "decided_at": _iso(36),     # 승인 소요 12.0h — 0.0h 방지 (15 §5)
        "events": [
            {"at": _iso(48), "action": "generated"},
            {"at": _iso(36), "action": "approved"},
            {"at": _iso(24), "action": "progress:후보 접촉·검토 시작"},
        ],
    }
    # 카드 B: 정량 1위가 이미 진행 중이라 서버가 선택 가능한 후보 1위(원 순위 2위)를 고른 고정 예시.
    card_b = {
        "id": "AC-002", "type": "EXPANSION", "status": "pending", "progress": None,
        "title": "영월군 소매점 업종 가맹점 확충",
        "target": {"eup": "영월군", "category": "소매점"},
        "score_rank": 2, "ai_rank": 1, "selection_rank": 1, "confidence": "하",
        "ai": {
            "adjusted": True,
            "selection_reason": "exclude_in_progress",
            "comparison": (
                "정량 상위 후보 영월군 음식점(후보 접촉·검토 시작)은 진행 중인 업무가 있어 중복 제안에서 "
                "제외했습니다. 따라서 선택 가능한 후보 중 최고점인 정량 2위 영월군 소매점(Score 0.49)을 "
                "서버가 선택했습니다. 동일 업종 상가 표본이 2곳으로 작아 담당자 확인이 필요합니다."),
            "reasons": [
                "정량 기준: Score 0.49 · 2위",
                "상권 기준: 업종공백도 0.75 · 반경 500m 내 동일 업종 하이원포인트 가맹점 0곳 / 동일 업종 상가 2곳",
                "이동 기준: 동선근접도 0.71은 직선거리 기반 · 도로 소요시간 약 35.9분",
                SEED_NARRATIVE_NOTE,
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어(상시모집·개인사업자 대상) 접촉해도 분기 내 계약이 성사되지 않을 가능성",
                "동일 업종 상가 표본이 2곳뿐이라 업종공백도 불확실성이 큼",
                "영업 상태·가맹 자격·관광객 이용 적합성은 승인 전 별도 확인 필요",
            ],
            "expected_effect": "영월군 소매점 후보의 가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
            "dissent": EXPANSION_DISSENT,
            "grounding": GROUNDING,
            "original_ranking": ORIGINAL_RANKING,
        },
        "scenarios": None,
        "candidate_verification": CANDIDATE_VERIFICATION,
        "operations": EMPTY_OPERATIONS,
        "sources": EXPANSION_SOURCES,
        "created_at": _iso(3), "decided_at": None,
        "events": [{"at": _iso(3), "action": "generated"}],
    }
    # 카드 C: pending INCENTIVE — 05 §2 INC-001 예시 구조 재사용
    card_c = {
        "id": "INC-001", "type": "INCENTIVE", "status": "pending", "progress": None,
        "title": "하이원포인트 지역 결제 페이백 (전 지역 공통 — 발행액 증액 없음)",   # = cardgen.INCENTIVE_TITLE
        "target": None, "score_rank": None, "ai_rank": None, "confidence": "중",
        "ai": {
            "adjusted": False,
            "comparison": (
                "세 시나리오 모두 이미 적립된 하이원포인트를 지역 가맹점에서 결제할 때만 리워드가 "
                "붙는 사용 단계 설계로, 콤프 발행액 증액은 수반하지 않습니다. "
                "3%는 재원 부담이 가장 낮지만 개선폭이 0.5~1.0%p로 제한적이고, 7%는 2.0~3.0%p로 "
                "가장 크지만 재원 부담도 함께 커집니다. 5%는 개선폭 1.0~2.0%p·재원 부담 중간으로, "
                "분기 내 효과 확인과 재원 방어를 동시에 노리는 절충안입니다."),
            "reasons": [
                "적립이 아닌 사용 단계 정책 — 지역 가맹점 결제분에 한정해 리워드가 붙으므로 콤프 발행액(적립)은 늘지 않고 게임 참여 유인과도 무관",
                "지역 전환율이 월별 17~23%대에서 오르내려 저점 월을 방어할 수요 측 유인이 필요",
                "사용 건수가 사북읍·태백시에 절반 이상 몰려 있어도 전 지역 공통 적용은 분포를 바꾸지 않아 지역 균형을 왜곡하지 않음",
                "페이백률이 높을수록 효과와 재원 부담이 함께 커지는 트레이드오프가 뚜렷",
            ],
            "risks": [
                "재원 확보는 예산 부서의 별도 승인 사항",
                "기존 포인트 적립·할인 약관과의 중복 적용 여부 확인 필요",
                "실제 자동 지급 시스템 연동은 미구현(로드맵)",
            ],
            "expected_effect": "5% 적용 시 지역 전환율 약 1.0~2.0%p 개선 예상 (가정 기반 전망이며 실제와 다를 수 있음)",
            "dissent": INCENTIVE_DISSENT,
            "grounding": INCENTIVE_GROUNDING,
            "original_ranking": None,
        },
        "scenarios": [
            {"rate": 3, "delta_pp": [0.5, 1.0], "budget_note": "재원 부담 낮음"},
            {"rate": 5, "delta_pp": [1.0, 2.0], "budget_note": "재원 부담 중간"},
            {"rate": 7, "delta_pp": [2.0, 3.0], "budget_note": "재원 부담 높음"},
        ],
        "selected_rate": None,
        "assumption_note": "페이백률-전환율 관계는 실측 데이터가 없어 팀 설정 가정(탄력성)에 기반한 전망",
        "sources": ["하이원포인트 사용현황"],
        "created_at": _iso(5), "decided_at": None,
        "events": [{"at": _iso(5), "action": "generated"}],
    }
    return [card_a, card_b, card_c]


# ── 이번 분기 이력 카드 (추진 경과 리포트를 실제 데이터로 채우는 몫) ─────────────────
#
# 리포트(/tracking)의 완료율·단계별 소요·목표일·관측 성과·정체 점검은 전부 **추진 기록**에서
# 나온다. 위 3장만 시드하면 승인 카드에 기록이 하나도 없어 리포트 전체가 빈 지표 벽이 되고,
# 방문객 위젯의 '이번 분기 확충 업종' 배지도 완료 카드가 없어 안 뜬다 — 데모 동선을 밟지 않고
# 화면만 열어 보는 심사 방식에서는 두 기능 모두 없는 것처럼 보인다.
#
# 그래서 **이번 분기 선정 지역(P6 selected_eups = 영월군·삼척시) 중 삼척시 몫 2건**을
# 진행 이력과 함께 싣는다. 정량 4·5위라 선택 가능한 후보 1위(원 순위 3위 영월군 숙박업)를 가리지 않아
# 실시간 생성 데모(11 §1 2-b) 결과가 달라지지 않는다.
#   AC-003 삼척시 편의점 — 완료 (기록 5건: 4단계 전이 + 관측 지표 + 목표일 준수)
#   AC-004 삼척시 카페   — 추진중에서 22일째 기록 없음 (정체 점검 표본)
# AC-001은 기록을 일부러 남기지 않는다 — '경과 기록이 없는 승인 카드' 목록의 표본이고,
# 데모 6단계에서 담당자가 첫 기록을 남기는 대상이기 때문이다.
VERIFIED_VERIFICATION = {
    "status": "verified",
    "checks": [
        {"key": label, "label": label, "status": "verified"}
        for label in ("영업 상태", "가맹 자격", "사업자 참여 의향", "관광객 이용 적합성", "정산 연동 가능성")
    ],
    "note": "필수 적격성 5개 항목 확인 완료 — 가맹 심사 진행 가능",
}


def _history_card(cid: str, category: str, rank: int, score: float, gap: float,
                  proximity: float, road_min: float, stores: int,
                  created_h: float, comparison: str) -> dict:
    """이력 카드 공통 골격 — 문구 수치는 candidates.json 실산출값(위 ORIGINAL_* 상수와 대조된다).

    `ai_rank`/`selection_rank`는 **최종 제안 목록 내 순위**라 항상 1이다(05 §2 · cardgen과 동일).
    여기에 정량 순위(4·5)를 넣으면 RankTrace가 "후보 스코어 4위 → 선택 가능한 후보 4위"를 그려
    화살표 좌우가 같아지고, 4위 카드에 "정량 1순위 선택" 배지까지 붙는다.
    선택 사유는 정량 최고점도, 진행 중 제외도 아닌 **이번 분기 지역 배분 몫**이므로 그대로 적는다.
    """
    return {
        "id": cid, "type": "EXPANSION", "status": "approved", "progress": None,
        "title": f"삼척시 {category} 업종 가맹점 확충",
        "target": {"eup": "삼척시", "category": category},
        "score_rank": rank, "ai_rank": 1, "selection_rank": 1, "confidence": "중",
        "ai": {
            "adjusted": rank != 1,
            "selection_reason": "region_quota",
            "comparison": comparison,
            "reasons": [
                f"정량 기준: Score {score} · {rank}위",
                f"상권 기준: 업종공백도 {gap} · 반경 500m 내 동일 업종 하이원포인트 가맹점 0곳 / 동일 업종 상가 {stores}곳",
                f"이동 기준: 동선근접도 {proximity}은 직선거리 기반 · 도로 소요시간 약 {road_min}분",
                SEED_NARRATIVE_NOTE,
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어 후보 접촉 후에도 계약이 성사되지 않을 가능성",
                "삼척시는 도계읍(하이원포인트 지역가맹 대상지역)만 대상이라 후보 표본이 작음",
            ],
            "expected_effect": f"삼척시 {category} 후보의 가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
            "dissent": EXPANSION_DISSENT,
            "grounding": GROUNDING,
            "original_ranking": ORIGINAL_RANKING,
        },
        "scenarios": None,
        "candidate_verification": VERIFIED_VERIFICATION,
        "operations": EMPTY_OPERATIONS,
        "sources": EXPANSION_SOURCES,
        "created_at": _iso(created_h), "decided_at": _iso(created_h - 24),
        "events": [
            {"at": _iso(created_h), "action": "generated"},
            {"at": _iso(created_h - 24), "action": "approved"},
        ],
    }


def history_cards() -> list:
    """이력 카드 2장 — `--reset`에만 실린다 (테스트 기준선은 demo_cards 3장 그대로).

    근거 수치(gap·proximity·상가 수)는 candidates.json 실산출값이어야 한다. 어긋나면 심사위원이
    /candidates 표와 카드 상세를 나란히 놓는 순간 바로 드러나므로, 아래 검증을 함께 돌린다.
    """
    assert_ranking_matches_pipeline()
    return [
        # 정량 4위 — 삼척시 후보 중 최고점. 완료까지 끝난 카드
        _history_card(
            "AC-003", "편의점", 4, 0.45, 0.86, 0.51, 41.5, 5, created_h=24 * 55,
            comparison=("이번 분기 선정 지역 2곳(영월군·삼척시) 가운데 삼척시 몫으로, 삼척시 후보 중 "
                        "최고점인 정량 4위 삼척시 편의점(Score 0.45)을 서버가 선택했습니다. "
                        "도로 소요시간 약 41.5분을 함께 확인했습니다."),
        ),
        # 정량 5위 — 삼척시 최고점(4위 편의점)이 이미 진행 중이라 차순위. 추진중에서 멈춘 정체 표본
        _history_card(
            "AC-004", "카페", 5, 0.42, 0.75, 0.52, 34.2, 2, created_h=24 * 60,
            comparison=("이번 분기 선정 지역 2곳(영월군·삼척시) 가운데 삼척시 몫으로, 삼척시 최고점인 "
                        "정량 4위 삼척시 편의점은 이미 추진 중이라 제외하고 선택 가능한 차순위인 "
                        "정량 5위 삼척시 카페(Score 0.42)를 서버가 선택했습니다. "
                        "도로 소요시간 약 34.2분을 함께 확인했습니다."),
        ),
    ]


def history_records() -> list[tuple[str, dict]]:
    """이력 카드의 추진 기록 — `progress_records.record_progress`로 그대로 재생한다.

    카드에 progress를 직접 박지 않고 실제 서비스 경로로 재생하는 이유: 단계 전이 규칙·적격성
    조건·completed_at·events·version projection이 운영과 동일하게 만들어져야 리포트 수치
    (단계별 소요·완료율·목표일)가 실제 동작의 산물이 되기 때문이다. 손으로 만든 항목은
    검증할 수 없는 장식이 된다.
    """
    def day(days: float) -> str:
        return _iso(24 * days)

    def due(days: float) -> str:
        return (datetime.now(db.KST) - timedelta(days=days)).date().isoformat()

    return [
        # AC-003 — 4단계를 모두 밟아 완료. 관측 지표가 개선 방향으로 쌓인다
        # 관측 지표는 기초·최신 두 시점이 있어야 리포트가 변화량을 만든다(한 시점만 있으면 표본 0).
        # `spend_krw`(지역 사용액)는 일부러 비워 둔다 — 원천 데이터에 금액 필드가 없다는 원칙
        # (13 §2-13)을 시드가 먼저 어기지 않기 위해서이고, 기초값이 없을 때의 표기도 함께 보인다.
        ("AC-003", {"progress": "후보 접촉·검토 시작", "recorded_at": day(50),
                    "note": "도계읍 편의점 후보 3곳 방문 접촉. 2곳이 가맹 설명 요청",
                    "next_action": "가맹 자격·정산 연동 확인",
                    "owner": "지역상생팀", "metrics": {"usage_count": 1180, "active_merchant_count": 31,
                                                  "conversion_rate_pct": 20.1, "concentration_index": 43.0}}),
        ("AC-003", {"progress": "적격성 확인", "recorded_at": day(42),
                    "note": "필수 5개 항목 확인 완료 — 영업 상태·가맹 자격 이상 없음",
                    "next_action": "가맹 심사 접수", "owner": "지역상생팀",
                    "metrics": {"usage_count": 1215}}),
        ("AC-003", {"progress": "가맹 심사", "recorded_at": day(33),
                    "note": "가맹 심사 접수. 정산 연동 테스트 진행 중",
                    "next_action": "심사 결과 확인", "owner": "지역상생팀"}),
        ("AC-003", {"progress": "추진중", "recorded_at": day(25),
                    "note": "가맹 계약 체결. 포스 연동·안내물 배치 진행",
                    "next_action": "오픈 후 첫 달 사용 건수 관측", "owner": "지역상생팀",
                    "due_at": due(15), "progress_pct": 80,
                    "metrics": {"active_merchant_count": 32}}),
        ("AC-003", {"progress": "완료", "recorded_at": day(18), "progress_pct": 100,
                    "note": "가맹점 오픈 확인. 방문객 위젯 추천 목록에 반영됨",
                    "owner": "지역상생팀", "due_at": due(15),
                    "metrics": {"usage_count": 1362, "conversion_rate_pct": 21.4,
                                "active_merchant_count": 33, "concentration_index": 42.1}}),
        # AC-004 — 추진중에서 멈춤. 마지막 기록이 22일 전이라 정체 점검(14일 기준)에 잡힌다
        ("AC-004", {"progress": "후보 접촉·검토 시작", "recorded_at": day(55),
                    "note": "도계읍 카페 후보 접촉. 사업자 참여 의향 확인",
                    "next_action": "적격성 5개 항목 확인", "owner": "지역상생팀",
                    "metrics": {"usage_count": 402, "active_merchant_count": 8,
                                "conversion_rate_pct": 19.8, "concentration_index": 43.4}}),
        ("AC-004", {"progress": "적격성 확인", "recorded_at": day(45),
                    "note": "필수 5개 항목 확인 완료", "next_action": "가맹 심사 접수",
                    "owner": "지역상생팀"}),
        ("AC-004", {"progress": "가맹 심사", "recorded_at": day(35),
                    "note": "가맹 심사 접수", "next_action": "정산 연동 일정 협의",
                    "owner": "지역상생팀"}),
        ("AC-004", {"progress": "추진중", "recorded_at": day(22), "progress_pct": 60,
                    "note": "정산 연동 일정이 사업자 사정으로 미정. 재협의 필요",
                    "blocker": "사업자 측 포스 교체 일정 미정",
                    "next_action": "포스 교체 일정 재협의", "owner": "지역상생팀",
                    "due_at": due(-7),
                    "metrics": {"usage_count": 428, "active_merchant_count": 8,
                                "conversion_rate_pct": 20.2, "concentration_index": 43.1}}),
    ]


def seed_history() -> int:
    """이력 카드를 저장하고 추진 기록을 순서대로 재생한다. 저장된 기록 수를 반환."""
    from app.services import progress_records

    for card in history_cards():
        db.put_card(card)
    written = 0
    for card_id, payload in history_records():
        card = db.get_card(card_id)
        if card is None:                     # 이력 카드가 없으면 조용히 건너뛴다
            continue
        _, _, created = progress_records.record_progress(
            card, payload, default_source="담당자 입력")
        written += 1 if created else 0
    return written


def ensure_table() -> bool:
    """카드·추진 기록 테이블이 없으면 생성하고 하나라도 만들었으면 True 반환.

    db.py가 이미 연 접속(엔드포인트·리전·자격증명)을 그대로 재사용한다.
    """
    client = db._table.meta.client  # noqa: SLF001
    cards_created = False
    try:
        client.describe_table(TableName=TABLE_NAME)
    except client.exceptions.ResourceNotFoundException:
        client.create_table(TableName=TABLE_NAME,
                            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                            BillingMode="PAY_PER_REQUEST")
        client.get_waiter("table_exists").wait(TableName=TABLE_NAME)
        cards_created = True
    return progress_db.ensure_table() or cards_created


def clear_table():
    """카드와 추진 기록 전체 비우기 — 로컬 데모·테스트 리셋 전용."""
    progress_db.clear_table()
    ids = [c["id"] for c in db._scan_all()]  # 내부 counter 레코드까지 함께 초기화한다
    for cid in ids:
        db._table.delete_item(Key={"id": cid})  # noqa: SLF001
    return ids


def main():
    parser = argparse.ArgumentParser(description="데모 시드/리셋 (docs/plan/11 §1·§4)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--init", action="store_true", help="테이블 생성만 (T7 local_init 겸용)")
    mode.add_argument("--reset", action="store_true", help="테이블 비우고 데모 카드 3장 시드")
    args = parser.parse_args()

    created = ensure_table()
    print(("created: " if created else "exists: ") + TABLE_NAME)
    if args.init:
        return

    removed = clear_table()
    print(f"cleared: {len(removed)} cards" + (f" {removed}" if removed else ""))
    for card in demo_cards():
        db.put_card(card)
        print(f"seeded: {card['id']} [{card['type']}] {card['title']}"
              f" — {card['status']}" + (f"/{card['progress']}" if card.get("progress") else ""))
    written = seed_history()
    for card in history_cards():
        current = db.get_card(card["id"]) or card
        print(f"seeded: {current['id']} [{current['type']}] {current['title']}"
              f" — {current['status']}/{current.get('progress')} (이력 카드)")
    print(f"seeded: 추진 기록 {written}건 (추진 경과 리포트·정체 점검 표본)")


if __name__ == "__main__":
    main()
