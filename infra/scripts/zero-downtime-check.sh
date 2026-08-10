#!/usr/bin/env bash
# 배포와 **동시에** 별도 터미널에서 실행한다. Ctrl-C 로 멈추면 집계를 출력한다.
#   터미널1: ./infra/scripts/zero-downtime-check.sh
#   터미널2: ./infra/scripts/deploy.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
TOTAL=0; FAIL=0; MAXMS=0

report() {
  printf '\n─── 무중단 측정 결과 ───\n'
  printf '  총 요청 : %d\n  실패    : %d\n  최대지연: %d ms\n' "$TOTAL" "$FAIL" "$MAXMS"
  if [ "$FAIL" -eq 0 ]; then
    printf '%s  무중단 확인 — 배포 전 구간에서 실패 0건%s\n' "$_C_GREEN" "$_C_RESET"
  else
    printf '%s  실패 %d건 발생 — 무중단이 성립하지 않았습니다%s\n' "$_C_RED" "$FAIL" "$_C_RESET"
  fi
  exit 0
}
trap report INT TERM

printf '%s0.5초 간격 폴링 시작 (%s). 배포가 끝나면 Ctrl-C%s\n' "$_C_BLUE" "$API_URL" "$_C_RESET"
while true; do
  MS="$(curl -fsS -o /dev/null -w '%{time_total}' --max-time 10 "$API_URL/api/health" 2>/dev/null \
        | awk '{printf "%d", $1*1000}')" || MS=""
  TOTAL=$((TOTAL + 1))
  if [ -z "$MS" ]; then
    FAIL=$((FAIL + 1)); printf '%s✗%s' "$_C_RED" "$_C_RESET"
  else
    [ "$MS" -gt "$MAXMS" ] && MAXMS="$MS"
    printf '.'
  fi
  sleep 0.5
done
