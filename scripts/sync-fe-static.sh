#!/usr/bin/env bash
#
# FE 정적 산출물 동기화 — data/processed/ 의 파이프라인 실산출을 frontend/src/data/ 로 복사한다.
#
# 여기 있는 4종은 **mock 이 아니다.** BE 엔드포인트가 없어 배포본이 실제로 서빙하는 데이터다
# (지역 드릴다운·셀 탐색 시뮬레이터·출처 칩 버전 표시). 나머지 화면 데이터는 전부 실 API 로 간다 —
# mock 폴백은 2026-08-11 실배포에서 제거됐다(설정 누락을 조용히 감춰 가짜 데이터가 노출됐다).
#
# 사용법: 레포 루트에서  ./scripts/sync-fe-static.sh
# 선행:   cd pipeline && python run_all.py   (data/processed/ 갱신)
#
# 생성 결과(frontend/src/data/*)는 커밋한다 — 정적 import 대상이라 레포에 없으면 Vercel 빌드가 실패한다.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/data/processed"
DST="$ROOT/frontend/src/data"

COPY=(usage_monthly.json usage_daily.json cell_load.json manifest.json)

for f in "${COPY[@]}"; do
  [ -f "$SRC/$f" ] || { echo "sync-fe-static 실패: $SRC/$f 없음 — 먼저 pipeline/run_all.py 를 실행할 것" >&2; exit 1; }
done

mkdir -p "$DST"
for f in "${COPY[@]}"; do
  cp "$SRC/$f" "$DST/$f"
  echo "  copied  $f"
done

echo "sync-fe-static 완료 → $DST"
