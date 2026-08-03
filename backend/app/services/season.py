"""B4 입력 ③: 계절성 캘린더 규칙 — 고정 dict (docs/plan/07 B4 표 원문)."""
from datetime import datetime

from app.db import KST

# (월 집합, 신호, 근거) — 07 문서 B4 계절성 캘린더 규칙 표 그대로
SEASON_RULES = [
    ({12, 1, 2}, "겨울 성수기 — 스키 시즌 유동인구 집중", "하이원 스키장"),
    ({7, 8}, "여름 성수기 — 휴가철·워터월드", "리조트 하계 수요"),
    ({4, 5, 10, 11}, "간절기 — 트레킹·행사 수요", "하늘길 등"),
]
DEFAULT_SIGNAL = "평시"


def season_signal(month: int | None = None) -> dict:
    """현재 월(KST)의 계절성 신호 — LLM 입력 ③ (07 문서 B4 '현재 월, 다가오는 성수기 여부')."""
    m = month if month is not None else datetime.now(KST).month
    for months, signal, basis in SEASON_RULES:
        if m in months:
            return {"현재 월": m, "신호": signal, "근거": basis}
    return {"현재 월": m, "신호": DEFAULT_SIGNAL, "근거": None}
