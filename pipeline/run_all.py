"""전체 파이프라인 실행 진입점 — 각 단계 성공/실패 로그, 실패 시 즉시 중단 (docs/plan/06 P9).

P1~P8 전 단계가 STEPS에 등록돼 있다. data.go.kr 키가 필요한 단계(P2~P4)는 인자 없이 실행하므로
data/raw/api_cache/ 를 재사용한다 — 원본을 갱신하려면 해당 스크립트만 `--refresh` 로 직접 실행한다.
"""
import datetime
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
PROCESSED = HERE.parents[0] / "data" / "processed"

# 번호순이 아니라 의존순 — P5는 P8의 sensitivity.json(ranking_stability)을 읽으므로 P6→P8→P5 로 미뤘다
# (P5는 P1·P2·(선택)P8 산출만, P6는 P1~P4 산출만, P7은 raw CSV만 사용 — 클린 체크아웃 1회 실행 재현용)
STEPS = [
    ("P1 사용현황 집계", "p1_usage.py"),
    ("P2 카지노 입장객", "p2_visitors.py"),      # 인자 없이 실행 = api_cache 재사용 (갱신은 --refresh)
    ("P3 가맹점 지오코딩", "p3_merchants.py"),   # 인자 없이 실행 = api_cache 재사용 (갱신은 --refresh)
    ("P4 소진공 상가정보", "p4_stores.py"),      # 인자 없이 실행 = api_cache 재사용 (갱신은 --refresh)
    ("P6 2단계 스코어링", "p6_scoring.py"),
    ("P8 가중치 민감도", "p8_sensitivity.py"),
    ("P5 진단 지표", "p5_metrics.py"),           # ranking_stability = P8 top3_stable_ratio×100
    ("P7 국세청 파생지표", "p7_risk.py"),
    ("P9 셀 부하", "p9_cell_load.py"),
    ("P10 프라이버시", "p10_privacy.py"),
]


def write_manifest(processed_dir):
    """산출 JSON 전체(자기 자신 제외)의 sha256·바이트 수를 모아 manifest.json을 만든다 (05 §5/§6, A4).

    STEPS 루프가 전부 끝난 뒤에 호출해야 한다 — P10이 usage_monthly·dashboard를 마지막에
    제자리 수정하므로, 그 전에 해시를 뜨면 최종 산출과 어긋난다.
    """
    files = {}
    for p in sorted(processed_dir.glob("*.json")):
        if p.name == "manifest.json":
            continue
        files[p.name] = {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
                         "bytes": p.stat().st_size}
    base_month = json.loads((processed_dir / "usage_monthly.json").read_text(encoding="utf-8"))["base_month"]
    digest = hashlib.sha256("".join(f["sha256"] for f in files.values()).encode()).hexdigest()[:8]
    manifest = {
        "dataset_version": f"{base_month}.{digest}",
        "base_month": base_month,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "files": files,
    }
    (processed_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[manifest] {manifest['dataset_version']}")


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

    write_manifest(PROCESSED)

    print(f"\n완료 {len(ran)}단계 / 미구현 {len(skipped)}단계")
    if PROCESSED.exists():
        print("data/processed/:")
        for p in sorted(PROCESSED.glob("*.json")):
            print(f"  {p.name}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
