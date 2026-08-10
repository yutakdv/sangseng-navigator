#!/usr/bin/env bash
# .env 의 시크릿을 SSM Parameter Store(SecureString)로 올린다.
# 값이 CloudFormation 템플릿·스택 이벤트·태스크 정의 어디에도 남지 않게 하기 위함이다.
# 표준 파라미터는 무과금이다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

# 로컬 전용이다 — CI 는 SSM 에 이미 올라간 값을 쓰고 이 스크립트를 실행하지 않는다.
[ -f "$REPO_ROOT/.env" ] || die ".env 없음 (put-secrets 는 로컬에서만 실행한다)"
load_env

put() {  # $1=파라미터명 $2=값
  [ -n "$2" ] || die "$1 값이 비어 있습니다."
  aws_ ssm put-parameter --name "$SSM_PREFIX/$1" --type SecureString \
    --value "$2" --overwrite >/dev/null
  log_ok "$SSM_PREFIX/$1"
}

log_step "SSM SecureString 업로드"
put OPENAI_API_KEY "${OPENAI_API_KEY:-}"
put MUTATION_API_TOKEN "${MUTATION_API_TOKEN:-}"

log_step "선존재 검증"
# 태스크 정의가 없는 파라미터를 참조하면 ParameterNotFound 로 조용히 죽는다.
for name in OPENAI_API_KEY MUTATION_API_TOKEN; do
  aws_ ssm get-parameter --name "$SSM_PREFIX/$name" >/dev/null \
    || die "$SSM_PREFIX/$name 조회 실패"
done
log_ok "2종 확인"
