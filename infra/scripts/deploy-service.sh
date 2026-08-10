#!/usr/bin/env bash
# service 스택 배포 + 롤아웃 진위 검증.
# 사용: deploy-service.sh <이미지태그>
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

TAG="${1:-}"
[ -n "$TAG" ] || die "사용법: deploy-service.sh <이미지태그>"

ECR_URI="$(stack_output "$FOUNDATION_STACK" EcrRepositoryUri)"
log_step "이미지 존재 확인 ($TAG)"
aws_ ecr describe-images --repository-name "$ECR_REPO" --image-ids "imageTag=$TAG" >/dev/null 2>&1 \
  || die "ECR 에 $ECR_REPO:$TAG 가 없습니다. build-and-push.sh 를 먼저 실행하세요.
  (이미지 없이 서비스를 만들면 CannotPullContainerError 로 스택 전체가 롤백됩니다)"
log_ok "존재"

load_env      # 환경변수 우선, .env 폴백 — CI 는 GitHub 저장소 변수로 값을 넘긴다

log_step "service 스택 배포 (첫 생성은 VPC Link 때문에 12~18분 걸립니다)"
if ! cfn_deploy "$SERVICE_STACK" "$REPO_ROOT/infra/cloudformation/service.yaml" \
      "FoundationStack=$FOUNDATION_STACK" \
      "ImageTag=$TAG" \
      "DesiredCount=${DESIRED_COUNT:-2}" \
      "OnDemandBaseCount=${ON_DEMAND_BASE_COUNT:-0}" \
      "DemoReadOnly=${DEMO_READ_ONLY}" \
      "AllowedOrigins=${ALLOWED_ORIGINS:-}" \
      "OpenAiModel=${OPENAI_MODEL:-gpt-4o-mini}"; then
  dump_task_diagnostics
  die "CloudFormation 배포 실패"
fi

log_step "롤아웃 진위 검증"
# 서킷 브레이커가 롤백해도 CFN 은 UPDATE_COMPLETE 로 끝난다 — 실제로 새 리비전이
# 떴는지 rolloutState 와 태스크 정의를 둘 다 본다.
EXPECTED_TD="$(stack_output "$SERVICE_STACK" TaskDefinitionArn)"
read -r STATE ACTUAL_TD <<<"$(aws_ ecs describe-services \
  --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
  --query 'services[0].deployments[0].[rolloutState,taskDefinition]' --output text)"

log_ok "rolloutState=$STATE"
if [ "$STATE" != "COMPLETED" ]; then
  dump_task_diagnostics
  die "롤아웃이 완료되지 않았습니다 (rolloutState=$STATE)"
fi
if [ "$ACTUAL_TD" != "$EXPECTED_TD" ]; then
  dump_task_diagnostics
  die "서킷 브레이커가 롤백했습니다.
  기대: $EXPECTED_TD
  실제: $ACTUAL_TD
  구버전이 돌고 있습니다 — 위 진단을 확인하세요."
fi
log_ok "$ACTUAL_TD"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
printf '\n%sApiUrl: %s%s\n' "$_C_GREEN" "$API_URL" "$_C_RESET"
printf '  Vercel 환경변수 NEXT_PUBLIC_API_BASE 에 이 값을 **끝 슬래시 없이** 넣고 Redeploy 하세요.\n'
printf '  (값만 바꾸고 재배포하지 않으면 빌드 시 인라인된 옛 URL 이 계속 쓰입니다)\n'
