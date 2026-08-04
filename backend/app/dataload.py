"""processed JSON 로더 — BE의 유일한 정적 데이터 접근 지점 (docs/plan/07 B1)."""
import functools
import json
from pathlib import Path

# processed 를 먼저 본다 — app/data 는 deploy-backend.sh 가 만든 번들 사본이라 로컬에 옛 산출이
# 남아 있으면 최신 data/processed 를 가린다 (감사 ①: usage_monthly 의 visitors_monthly 가 None 으로 읽혔다).
# 배포 환경에는 레포 루트가 없어 첫 경로가 빗나가고 번들 경로로 정상 폴백한다 —
# Lambda(/var/task/app/…)는 /var/data/processed, Docker(/app/app/…)는 /data/processed 로 풀리며
# 둘 다 존재하지 않는다. Docker 는 data/processed 를 app/data 에 마운트하므로(docker-compose.yml)
# 어느 쪽을 읽든 내용이 같다.
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
