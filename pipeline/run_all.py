"""전체 파이프라인 실행 진입점 — 각 단계 성공/실패 로그, 실패 시 즉시 중단 (docs/plan/06 P9).

data.go.kr 키가 필요한 단계(P2~P4)는 스크립트가 생기는 대로 STEPS에 추가한다.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PROCESSED = HERE.parents[0] / "data" / "processed"

STEPS = [
    ("P1 사용현황 집계", "p1_usage.py"),
    ("P2 카지노 입장객", "p2_visitors.py"),      # 미구현 — data.go.kr 승인 후
    ("P3 가맹점 지오코딩", "p3_merchants.py"),   # 미구현 — data.go.kr 승인 후
    ("P4 소진공 상가정보", "p4_stores.py"),      # 미구현 — data.go.kr 승인 후
    ("P5 진단 지표", "p5_metrics.py"),           # 미구현 — P2 산출물 필요
    ("P6 2단계 스코어링", "p6_scoring.py"),      # 미구현 — P3·P4 산출물 필요
    ("P7 국세청 파생지표", "p7_risk.py"),
    ("P8 가중치 민감도", "p8_sensitivity.py"),   # 미구현 — P6 이후
]


def main():
    ran, skipped = [], []
    for name, script in STEPS:
        path = HERE / script
        if not path.exists():
            skipped.append(name)
            print(f"[skip] {name} — {script} 미구현")
            continue
        print(f"[run ] {name} ({script})")
        result = subprocess.run([sys.executable, str(path)], cwd=HERE)
        if result.returncode != 0:
            print(f"[FAIL] {name} — 중단 (exit {result.returncode})")
            sys.exit(result.returncode)
        ran.append(name)

    print(f"\n완료 {len(ran)}단계 / 미구현 {len(skipped)}단계")
    if PROCESSED.exists():
        print("data/processed/:")
        for p in sorted(PROCESSED.glob("*.json")):
            print(f"  {p.name}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
