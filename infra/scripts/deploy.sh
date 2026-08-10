#!/usr/bin/env bash
# 전체 배포 오케스트레이션.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

"$SCRIPT_DIR/preflight.sh"
"$SCRIPT_DIR/put-secrets.sh"
"$SCRIPT_DIR/deploy-foundation.sh"
TAG="$("$SCRIPT_DIR/build-and-push.sh" | tail -1)"
"$SCRIPT_DIR/deploy-service.sh" "$TAG"
"$SCRIPT_DIR/smoke-test.sh"

printf '\n%s배포 완료%s\n' "$_C_GREEN" "$_C_RESET"
