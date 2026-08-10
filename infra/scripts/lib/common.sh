#!/usr/bin/env bash
# 공통 로깅·AWS 래퍼·CFN 배포·진단 덤프.

set -euo pipefail

_C_RESET=$'\033[0m'; _C_BLUE=$'\033[34m'; _C_GREEN=$'\033[32m'; _C_RED=$'\033[31m'; _C_YEL=$'\033[33m'

# ⚠ 로그는 전부 stderr 로 보낸다. build-and-push.sh 가 이미지 태그를 stdout 으로 넘기는데,
#   로그가 섞이면 호출부가 태그를 읽으려 파이프를 걸어야 하고 그러면 진행 상황이 안 보인다.
log_step() { printf '%s▸ %s%s\n' "$_C_BLUE" "$*" "$_C_RESET" >&2; }
log_ok()   { printf '%s  ✓ %s%s\n' "$_C_GREEN" "$*" "$_C_RESET" >&2; }
log_warn() { printf '%s  ⚠ %s%s\n' "$_C_YEL" "$*" "$_C_RESET" >&2; }
die()      { printf '%s  ✗ %s%s\n' "$_C_RED" "$*" "$_C_RESET" >&2; exit 1; }

# 리전을 항상 명시해 셸 환경에 상관없이 같은 대상에 배포한다. 프로필은 config.sh 가
# AWS_PROFILE 로 내보내고 aws CLI 가 자동으로 읽는다 — CI 에는 그 변수가 없고 OIDC 자격증명이 쓰인다.
aws_() { aws --region "$AWS_REGION" "$@"; }

# 환경변수 우선, .env 는 폴백. 이미 설정된 값은 덮지 않는다.
# CI 러너에는 .env 가 없고 GitHub 저장소 변수로 값이 들어온다 —
# 프론트의 next.config.mjs 가 루트 .env 를 승계하는 규칙과 같다.
load_env() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -n "${!key:-}" ] || export "$key=$val"
  done < "$REPO_ROOT/.env"
}

stack_output() {   # $1=스택명 $2=OutputKey
  aws_ cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

stack_exists() { aws_ cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }

cfn_deploy() {     # $1=스택명 $2=템플릿 나머지=Key=Value 파라미터
  local stack="$1" template="$2"; shift 2
  # ⚠ macOS 기본 bash 는 3.2 라 `set -u` 아래에서 빈 배열 "${arr[@]}" 가 unbound variable 로 죽는다.
  #   파라미터 유무로 호출을 나눠 3.2 에서도 동작하게 한다.
  if [ $# -gt 0 ]; then
    aws_ cloudformation deploy \
      --stack-name "$stack" --template-file "$template" \
      --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
      --parameter-overrides "$@"
  else
    aws_ cloudformation deploy \
      --stack-name "$stack" --template-file "$template" \
      --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset
  fi
}

# 태스크가 죽는 이유는 CloudWatch 로그가 아니라 stoppedReason 에만 남는 경우가 많다
# (예: 태스크 실행 역할의 ssm:GetParameters 누락 → ResourceInitializationError).
dump_task_diagnostics() {
  log_warn "최근 중지된 태스크 진단:"
  local arns
  arns=$(aws_ ecs list-tasks --cluster "$CLUSTER_NAME" --desired-status STOPPED \
           --query 'taskArns[:5]' --output text 2>/dev/null || true)
  if [ -n "$arns" ] && [ "$arns" != "None" ]; then
    aws_ ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks $arns \
      --query 'tasks[].{stopped:stoppedReason,code:stopCode,containers:containers[].reason}' \
      --output json || true
  else
    log_warn "  중지된 태스크 없음"
  fi
  log_warn "서비스 이벤트 (최근 10건):"
  aws_ ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
    --query 'services[0].events[:10].message' --output json 2>/dev/null || true
}
