"""데모 시드 — 데모 초기 상태 카드 3장 (T11, docs/plan/11 §1 '사전 상태'의 원천).

사용법 (레포 루트 또는 backend/ 어디서든, DynamoDB Local 기준):
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --init    # 테이블 생성만 (T7 local_init 겸용)
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --reset   # 테이블 전체 비우고 데모 3장 시드

--reset은 테이블이 없으면 만들고, 있으면 전부 비운 뒤 시드한다 (리허설·심사 리셋 — 11 문서 §4).
전체 비우는 이유: 비순차 목업 ID(AC-9xx 등)가 남아 있으면 next_card_id가 충돌한다 (T9 보고서 인계).

시드 카드 (2026-08-05 개선 산식으로 재산출한 candidates.json 기준):
  A) AC-001 EXPANSION 영월군×음식점 — approved+후보 접촉·검토 시작. 정량 1위가 이미
     진행 중이라는 운영 상태를 만든다. created 2일 전·decided 1.5일 전이라 의사결정 12시간이다.
  B) AC-002 EXPANSION 영월군×소매점 — pending. 정량 1위가 활성 업무여서 서버가 가용 후보 중
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
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]
GROUNDING = {
    "status": "verified",
    "numeric_status": "verified",
    "narrative_status": "rule_based",
    "selection_method": "deterministic_highest_available_score",
    "explanation_source": "rule_seed",
    "source": "structured",
    "checks": ["target", "score", "rank", "progress", "road_time"],
}
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
            "comparison": (
                "정량 1위 영월군 음식점(Score 0.5)을 서버 제안 대상으로 유지했습니다. 차순위 "
                "영월군 소매점(Score 0.49)과 비교했으며, 영월군 음식점의 도로 소요시간 약 "
                "35.2분을 함께 확인해야 합니다."),
            "reasons": [
                "정량 기준: Score 0.5 · 1위",
                "상권 기준: 업종공백도 0.83 · 반경 500m 내 동일 업종 하이원포인트 가맹점 0곳 / 동일 업종 상가 4곳",
                "이동 기준: 동선근접도 0.68은 직선거리 기반 · 도로 소요시간 약 35.2분",
                "대상은 서버의 정량 규칙이 선택했고 AI는 비정량 리스크 문구 생성에만 사용했습니다",
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어 후보 접촉 후에도 계약이 성사되지 않을 가능성",
                "영업 상태·가맹 자격·관광객 이용 적합성은 승인 전 별도 확인 필요",
            ],
            "expected_effect": "영월군 음식점 후보의 가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
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
    # 카드 B: 정량 1위가 이미 진행 중이라 서버가 가용 후보 1위(원 순위 2위)를 고른 고정 예시.
    card_b = {
        "id": "AC-002", "type": "EXPANSION", "status": "pending", "progress": None,
        "title": "영월군 소매점 업종 가맹점 확충",
        "target": {"eup": "영월군", "category": "소매점"},
        "score_rank": 2, "ai_rank": 1, "selection_rank": 1, "confidence": "하",
        "ai": {
            "adjusted": True,
            "comparison": (
                "정량 상위 후보 영월군 음식점(후보 접촉·검토 시작)은 활성 업무가 있어 중복 제안에서 "
                "제외했습니다. 따라서 가용 후보 중 최고점인 정량 2위 영월군 소매점(Score 0.49)을 "
                "서버가 선택했습니다. 동일 업종 상가 표본이 2곳으로 작아 담당자 확인이 필요합니다."),
            "reasons": [
                "정량 기준: Score 0.49 · 2위",
                "상권 기준: 업종공백도 0.75 · 반경 500m 내 동일 업종 하이원포인트 가맹점 0곳 / 동일 업종 상가 2곳",
                "이동 기준: 동선근접도 0.71은 직선거리 기반 · 도로 소요시간 약 35.9분",
                "대상은 서버의 정량 규칙이 선택했고 AI는 비정량 리스크 문구 생성에만 사용했습니다",
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어(상시모집·개인사업자 대상) 접촉해도 분기 내 계약이 성사되지 않을 가능성",
                "동일 업종 상가 표본이 2곳뿐이라 업종공백도 불확실성이 큼",
                "영업 상태·가맹 자격·관광객 이용 적합성은 승인 전 별도 확인 필요",
            ],
            "expected_effect": "영월군 소매점 후보의 가맹 전환 효과는 카드 상세의 반사실 시뮬레이션과 사업자 적격성 확인 후 판단해야 합니다 (가정 기반 전망이며 실제와 다를 수 있음)",
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


if __name__ == "__main__":
    main()
