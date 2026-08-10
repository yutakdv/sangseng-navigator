#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

log_step "foundation 스택 배포 ($FOUNDATION_STACK)"
cfn_deploy "$FOUNDATION_STACK" "$REPO_ROOT/infra/cloudformation/foundation.yaml" \
  "AzA=$AZ_A" "AzC=$AZ_C"

log_ok "완료"
aws_ cloudformation describe-stacks --stack-name "$FOUNDATION_STACK" \
  --query 'Stacks[0].Outputs' --output table
