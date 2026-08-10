#!/usr/bin/env bash
# CloudFormation 을 기다리지 않고 직전 태스크 정의 리비전으로 되돌린다 (수십 초).
# 되돌린 뒤 CFN 과 상태가 어긋나므로, 원인을 고친 다음 정상 배포로 정리한다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

CURRENT="$(aws_ ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
  --query 'services[0].taskDefinition' --output text)"
REVISION="${CURRENT##*:}"
FAMILY="${CURRENT%:*}"; FAMILY="${FAMILY##*/}"
[ "$REVISION" -gt 1 ] || die "리비전이 1뿐이라 되돌릴 대상이 없습니다."

PREVIOUS="${FAMILY}:$((REVISION - 1))"
log_step "$CURRENT → $PREVIOUS 로 되돌립니다"
read -r -p "  계속할까요? [y/N] " ans
[ "$ans" = "y" ] || die "취소"

aws_ ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" \
  --task-definition "$PREVIOUS" >/dev/null
log_step "안정화 대기"
aws_ ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME"
log_ok "$PREVIOUS 로 복귀 완료"
log_warn "CloudFormation 과 상태가 어긋나 있습니다 — 원인을 고친 뒤 deploy.sh 로 정리하세요."
