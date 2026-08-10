#!/usr/bin/env bash
# 역순 철거. VPC Link 삭제와 ENI 정리가 느려 서브넷·SG 삭제가 실패할 수 있으므로 재시도한다.
# ⚠ 심사·전시가 끝나기 전에는 실행하지 않는다 (docs/plan/12 §6).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

printf '%s이 작업은 되돌릴 수 없습니다.%s\n' "$_C_RED" "$_C_RESET"
printf '  삭제: %s, %s\n' "$SERVICE_STACK" "$FOUNDATION_STACK"
printf '  보존: DynamoDB 테이블 2개 (DeletionPolicy: Retain — 카드 데이터가 남습니다)\n'
read -r -p "  스택 이름을 입력해 확인하세요 [$SERVICE_STACK]: " ans
[ "$ans" = "$SERVICE_STACK" ] || die "취소"

log_step "1. service 스택 삭제 (VPC Link 때문에 10분 이상 걸릴 수 있습니다)"
aws_ cloudformation delete-stack --stack-name "$SERVICE_STACK"
aws_ cloudformation wait stack-delete-complete --stack-name "$SERVICE_STACK" || true
log_ok "완료"

log_step "2. foundation 스택 삭제 (ENI 정리 지연 시 최대 3회 재시도)"
for i in 1 2 3; do
  aws_ cloudformation delete-stack --stack-name "$FOUNDATION_STACK"
  if aws_ cloudformation wait stack-delete-complete --stack-name "$FOUNDATION_STACK" 2>/dev/null; then
    log_ok "완료"; break
  fi
  log_warn "시도 $i 실패 — 60초 후 재시도 (ENI 정리 대기)"
  sleep 60
done

log_warn "DynamoDB 테이블 2개는 남아 있습니다. 정말 지우려면:"
printf '  aws --profile %s --region %s dynamodb delete-table --table-name sangseng-cards\n' "${AWS_PROFILE:-sangseng}" "$AWS_REGION"
printf '  aws --profile %s --region %s dynamodb delete-table --table-name sangseng-progress-records\n' "${AWS_PROFILE:-sangseng}" "$AWS_REGION"
