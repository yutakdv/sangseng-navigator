"""데모 시드 — 데모 초기 상태 카드 3장 (T11, docs/plan/11 §1 '사전 상태'의 원천).

사용법 (레포 루트 또는 backend/ 어디서든, DynamoDB Local 기준):
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --init    # 테이블 생성만 (T7 local_init 겸용)
  DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --reset   # 테이블 전체 비우고 데모 3장 시드

--reset은 테이블이 없으면 만들고, 있으면 전부 비운 뒤 시드한다 (리허설·심사 리셋 — 11 문서 §4).
전체 비우는 이유: 비순차 목업 ID(AC-9xx 등)가 남아 있으면 next_card_id가 충돌한다 (T9 보고서 인계).

시드 카드 (사용자 확정 결정 2026-08-03 — 영월군 서사, 실측 candidates.json 기준.
2026-08-04 제도 부합성 수정으로 파이프라인을 재산출해 카드 B의 타깃·수치를 갱신했다):
  A) AC-001 EXPANSION 영월군×카페 문갤러리   — approved+추진중 (created 2일 전·decided 1.5일 전
     → avg_approval_hours 12.0h, 0.0h 방지 — 15 §5). 데모에서 '완료'로 바꾸면 위젯이
     영월군×카페 가맹점 2곳(느리게·별빛마루)에 신규 배지 — 일치 1~3곳 조건 충족 (T13 인계)
  B) AC-002 EXPANSION 영월군×음식점 동원각 — pending, Score 2위→AI 1위 조정 사례.
     LLM 호출 없는 고정 JSON (리허설·심사 리셋 재현성 — 15 §5). 조정 사유에 추진중인 카드 A와의
     관계(중복 회피)와 도로 접근성(05 §1 road_minutes) 역전을 명시.
     ※ 직전 시드는 소매점 강원선바위협동조합이었는데, 상시모집 자격이 개인사업자(법인 제외)라
       협동조합이 후보에서 빠졌다(p6_scoring.CORPORATE_MARKERS) — 새 산출 기준으로 교체
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
from app import db  # noqa: E402  (환경변수 세팅 뒤에 import해야 boto3 리소스가 올바로 붙는다)

TABLE_NAME = os.environ.get("CARDS_TABLE") or "sangseng-cards"   # 빈 문자열 방어 — db.py 와 동일


def _iso(hours_ago: float) -> str:
    return (datetime.now(db.KST) - timedelta(hours=hours_ago)).isoformat(timespec="seconds")


# ── 실측 정량 순위 (data/processed/candidates.json, 2026-08-04 재산출분) — 전 카드 공통 병기 ──
# 05 §2 계약 형태(rank/candidate/score)라 상호명은 넣지 않는다. 상호명은 아래 별도 상수로 대조한다.
ORIGINAL_RANKING = [
    {"rank": 1, "candidate": "영월군 숙박업", "score": 0.67},
    {"rank": 2, "candidate": "영월군 음식점", "score": 0.57},
    {"rank": 3, "candidate": "영월군 편의점", "score": 0.56},
    {"rank": 4, "candidate": "영월군 소매점", "score": 0.56},
    {"rank": 5, "candidate": "영월군 카페", "score": 0.47},
]
# 카드 문구(비교문·근거)에 상호명이 직접 박혀 있다 — 순위·점수가 같아도 대표 상가는 바뀔 수 있어 함께 대조
ORIGINAL_CANDIDATE_NAMES = ["동빈네민박&캠핑장", "동원각", "메이플", "한결퇴비", "문갤러리"]
EXPANSION_SOURCES = ["하이원포인트 사용현황", "가맹점 상세정보", "소진공 상가정보"]


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
    if actual != ORIGINAL_RANKING or names != ORIGINAL_CANDIDATE_NAMES:
        raise SystemExit(
            "seed_demo 중단: 하드코딩 정량 순위가 data/processed/candidates.json 과 다릅니다 "
            "(파이프라인 재산출 후 데모 카드 문구를 갱신해야 합니다).\n"
            f"  하드코딩: {ORIGINAL_RANKING} / {ORIGINAL_CANDIDATE_NAMES}\n"
            f"  실산출  : {actual} / {names}"
        )


def demo_cards() -> list:
    """데모 3장 — 문구의 수치는 전부 실데이터 검증본 (task-11-report.md 근거 기재)."""
    assert_ranking_matches_pipeline()
    # 카드 A: approved+추진중 — 위젯 배지 조건(영월군×카페 가맹점 2곳)으로 타깃 선정 (T13 인계)
    card_a = {
        "id": "AC-001", "type": "EXPANSION", "status": "approved", "progress": "추진중",
        "title": "영월군 카페 업종 가맹점 확충",
        "target": {"eup": "영월군", "category": "카페"},
        "score_rank": 5, "ai_rank": 1, "confidence": "중",
        "ai": {
            "adjusted": True,
            "comparison": (
                "1순위(조정) 영월군 카페 문갤러리: Score 5위(0.47)지만 영월군 내 카페 하이원포인트 "
                "가맹점이 2곳뿐이고 최근 3개월 카페 업종 사용 실적이 0건 — 가맹 공백이 실적 공백으로 "
                "이어진 상태라 확충 시 방문객 체감 개선이 가장 빠를 것으로 예상. "
                "2순위(Score 1위) 영월군 숙박업 동빈네민박&캠핑장(0.67): 업종공백도는 같으나 "
                "숙박업 특성상 가맹 협상·시설 확인에 시간이 걸릴 가능성."),
            "reasons": [
                "영월군 내 카페 하이원포인트 가맹점 2곳 — 방문객 체감 공백이 큰 업종",
                "최근 3개월 영월군 카페 업종 하이원포인트 사용 실적 0건 — 가맹 공백이 실적 공백으로 이어진 상태",
                "문갤러리 반경 500m 내 동일 업종 하이원 가맹점 0곳(업종공백도 1.0), 여름 성수기(휴가철·워터월드) 유동인구 흡수 가능성",
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "Score 상위 후보(숙박·소매) 대비 정량 점수가 낮아 효과가 제한적일 가능성",
            ],
            "expected_effect": "영월군 카페 공백 해소로 방문객 소비 접점 확대 예상 (가정 기반 전망이며 실제와 다를 수 있음)",
            "original_ranking": ORIGINAL_RANKING,
        },
        "scenarios": None,
        "sources": EXPANSION_SOURCES,
        "created_at": _iso(48), "decided_at": _iso(36),     # 승인 소요 12.0h — 0.0h 방지 (15 §5)
        "events": [
            {"at": _iso(48), "action": "generated"},
            {"at": _iso(36), "action": "approved"},
            {"at": _iso(24), "action": "progress:추진중"},
        ],
    }
    # 카드 B: pending, AI 조정 사례 (Score 2위→AI 1위) — 데모 핵심, 고정 JSON
    # 조정 근거의 핵심 수치는 candidates.json 실측: 동빈네민박 직선 5.55km/도로 11.0km·50.8분,
    # 동원각 직선 7.56km/도로 25.8km·33.9분 (직선 근접도와 실제 접근성이 역전된 구간 — 05 §1)
    card_b = {
        "id": "AC-002", "type": "EXPANSION", "status": "pending", "progress": None,
        "title": "영월군 음식점 업종 가맹점 확충",
        "target": {"eup": "영월군", "category": "음식점"},
        "score_rank": 2, "ai_rank": 1, "confidence": "상",
        "ai": {
            "adjusted": True,
            "comparison": (
                "1순위(조정) 영월군 음식점 동원각(상동읍 구래리): Score 2위(0.57). "
                "Score 1위 숙박업 후보는 거점에서 직선 5.6km로 가장 가깝지만 도로로는 11.0km·50.8분이고, "
                "동원각은 직선 7.6km로 더 멀어도 도로 25.8km·33.9분이라 실제 접근성이 앞선다 — "
                "직선거리 기반 근접도가 산악 지형에서 역전되는 구간. 여름 성수기(휴가철·워터월드)가 "
                "진행 중이라 분기 내 착수 확실성이 관건인 점도 음식점 쪽에 유리할 것으로 예상. "
                "2순위(Score 1위) 영월군 숙박업 동빈네민박&캠핑장(0.67): 업종공백도는 같으나 숙박업 "
                "특성상 가맹 협상·시설 확인 소요가 길 가능성이 있어 성수기 내 효과 확인이 어려울 수 있음."),
            "reasons": [
                "실제 접근성 역전 — Score 1위 숙박업 후보는 직선 5.6km(근접도 1.00)지만 도로로 11.0km·50.8분인 반면, 동원각은 직선 7.6km(근접도 0.71)로 밀렸는데 도로로는 25.8km·33.9분이다. 정량 Score는 직선거리 기준이라 이 역전을 반영하지 못한다",
                "여름 성수기(계절성 신호) 내 착수 확실성 — 음식점은 성수기 수요에 즉시 대응 가능할 것으로 예상되는 반면 숙박업은 가맹 협상·시설 확인 소요가 길 가능성",
                "이미 추진중인 영월군 카페 확충 카드(문갤러리·산솔면 녹전리)와 업종·지점이 겹치지 않아 중복 착수 위험이 없고, 카페(녹전리)·음식점(상동읍 구래리)으로 영월군 내 소비 접점을 서로 다른 생활권에 넓히는 조합",
                "동원각 반경 500m 내 동일 업종 하이원 가맹점 0곳(업종공백도 1.0) — 영월군 소비 전환의 공백 지점",
            ],
            "risks": [
                "신규 가맹점 초기 실적 저조 가능성",
                "가맹 신청은 사업자 의사에 달려 있어(상시모집·개인사업자 대상) 접촉해도 분기 내 계약이 성사되지 않을 가능성",
                "도로 소요시간은 공개 라우팅 API 추정치로 계절·기상에 따라 달라질 수 있음",
            ],
            "expected_effect": "지역 소비 집중도 약 0.1%p 내외 개선 예상 — 규모는 작지만 영월군 방향 소비 전환의 시작점 (가정 기반 전망이며 실제와 다를 수 있음)",
            "original_ranking": ORIGINAL_RANKING,
        },
        "scenarios": None,
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
                "사용 건수가 사북읍·태백시에 절반 이상 몰려 있어 특정 지역 한정이 아닌 전 지역 공통 적용이 지역 균형에 유리",
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
    """테이블이 없으면 생성하고 True 반환 (local_init.py와 동일 스키마 — 05 문서 §7).

    db.py가 이미 연 접속(엔드포인트·리전·자격증명)을 그대로 재사용한다.
    """
    client = db._table.meta.client  # noqa: SLF001
    try:
        client.describe_table(TableName=TABLE_NAME)
        return False
    except client.exceptions.ResourceNotFoundException:
        client.create_table(TableName=TABLE_NAME,
                            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                            AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                            BillingMode="PAY_PER_REQUEST")
        client.get_waiter("table_exists").wait(TableName=TABLE_NAME)
        return True


def clear_table():
    """테이블 전체 비우기 — 비순차 목업 ID 잔존 시 next_card_id 충돌 방지 (T9 인계)."""
    ids = [c["id"] for c in db.list_cards()]
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
