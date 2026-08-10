#!/usr/bin/env bash
#
# FE mock 동기화 — data/processed/ 의 파이프라인 실산출을 frontend/src/mocks/ 로 복사한다.
#
# mock 의 값 원천은 이 스크립트 하나뿐이다 (docs/plan/05-api-contract.md 머리말).
# 05 문서의 예시 JSON 은 스키마 설명용이라 지역·업종·수치가 실데이터와 다르다 —
# 예시를 보고 손으로 mock 을 만들면 mock(예시 서사)과 실서버(실산출)가 다른 이야기를 하게 된다.
#
# 사용법: 레포 루트에서  ./scripts/sync-mocks.sh
# 선행:   cd pipeline && python run_all.py   (data/processed/ 갱신)
#
# 생성 결과(frontend/src/mocks/*)는 커밋한다 — 정적 import 대상이라 레포에 없으면 Vercel
# 빌드가 실패하고, mock 모드(NEXT_PUBLIC_API_BASE 미설정) 비상 폴백도 성립하지 않는다.
#
# candidates.json 만 예외 — 파일 복사가 아니라 `GET /api/candidates` 의 병합 응답
# (eup_ranking + selected_eups + candidates + merchants) 형태로 만든다.
# 병합 정본은 backend/app/routes/dashboard.py 의 get_candidates() 이며, 형태가 바뀌면 둘 다 고친다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/data/processed"
DST="$ROOT/frontend/src/mocks"

# 그대로 복사하는 산출물 (candidates.json 은 아래에서 병합본으로 별도 생성)
COPY=(dashboard.json eup_scores.json merchants.json usage_monthly.json usage_daily.json risk_signal.json sensitivity.json cell_load.json manifest.json)

for f in "${COPY[@]}" candidates.json; do
  [ -f "$SRC/$f" ] || { echo "sync-mocks 실패: $SRC/$f 없음 — 먼저 pipeline/run_all.py 를 실행할 것" >&2; exit 1; }
done

mkdir -p "$DST"
for f in "${COPY[@]}"; do
  cp "$SRC/$f" "$DST/$f"
  echo "  copied  $f"
done

python3 - "$SRC" "$DST" <<'PY'
import json, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
load = lambda name: json.loads((src / f"{name}.json").read_text(encoding="utf-8"))

eup_scores = load("eup_scores")
merged = {                                  # backend/app/routes/dashboard.py get_candidates() 와 동일
    "eup_ranking": eup_scores["eup_ranking"],
    "selected_eups": eup_scores["selected_eups"],
    "candidates": load("candidates"),
    "merchants": load("merchants"),
}
out = dst / "candidates.json"
out.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"  merged  candidates.json ({len(merged['candidates'])} candidates / "
      f"{len(merged['merchants'])} merchants, /api/candidates 응답 형태)")
PY

echo "sync-mocks 완료 → $DST"
