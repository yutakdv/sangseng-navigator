"""KST 시각 유틸 — 05 문서 §8 '모든 타임스탬프 KST ISO8601'.

db.py 에서 분리한 이유: season.py 같은 순수 계산 모듈이 KST 상수 하나 때문에 app.db 를
import 하면 boto3 리소스 생성까지 끌려온다 (감사 2절 #5).
"""
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def now_iso() -> str:
    return datetime.now(KST).isoformat(timespec="seconds")
