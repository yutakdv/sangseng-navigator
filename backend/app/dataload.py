"""processed JSON 로더 — BE의 유일한 정적 데이터 접근 지점 (docs/plan/07 B1)."""
import functools
import json
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
            return json.loads(p.read_text(encoding="utf-8"))
    raise FileNotFoundError(name)


def loaded_ok() -> bool:
    try:
        load("dashboard")
        return True
    except FileNotFoundError:
        return False
