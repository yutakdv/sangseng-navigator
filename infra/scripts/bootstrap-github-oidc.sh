#!/usr/bin/env bash
# 1회용 — GitHub Actions 가 AWS 역할을 맡을 수 있게 OIDC 공급자와 배포 역할을 만든다.
# 장기 액세스 키를 저장소에 두지 않기 위한 구성이다.
#
# ⚠ IAM 자원을 만든다. 내용을 확인한 뒤 직접 실행할 것.
# 되돌리기:
#   aws iam delete-role-policy --role-name sangseng-github-deploy --policy-name PassTaskRoles
#   aws iam detach-role-policy --role-name sangseng-github-deploy --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
#   aws iam delete-role --role-name sangseng-github-deploy
#   aws iam delete-open-id-connect-provider --open-id-connect-provider-arn <위 출력의 ARN>
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

GH_REPO="yutakdv/sangseng-navigator"
ROLE_NAME="sangseng-github-deploy"
ACCOUNT="$(aws_ sts get-caller-identity --query Account --output text)"
PROVIDER_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

log_step "1. OIDC 공급자"
if aws_ iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  log_ok "이미 존재"
else
  # thumbprint 는 AWS 가 신뢰된 루트 CA 로 검증하므로 값 자체는 형식만 맞으면 된다.
  aws_ iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  log_ok "생성됨"
fi

log_step "2. 배포 역할 ($ROLE_NAME)"
TRUST="$(mktemp)"
cat > "$TRUST" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${PROVIDER_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GH_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON
if aws_ iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_ iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "file://$TRUST"
  log_ok "신뢰 정책 갱신"
else
  aws_ iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "file://$TRUST" \
    --description "GitHub Actions deploy for ${GH_REPO} (main only)" >/dev/null
  log_ok "생성됨"
fi
rm -f "$TRUST"

log_step "3. 권한 부착"
aws_ iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
PASS="$(mktemp)"
cat > "$PASS" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PassTaskRolesToEcs",
    "Effect": "Allow",
    "Action": ["iam:PassRole", "iam:GetRole"],
    "Resource": "arn:aws:iam::${ACCOUNT}:role/sangseng-*",
    "Condition": { "StringEqualsIfExists": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }
  }]
}
JSON
aws_ iam put-role-policy --role-name "$ROLE_NAME" --policy-name PassTaskRoles \
  --policy-document "file://$PASS"
rm -f "$PASS"
log_ok "PowerUserAccess + PassTaskRoles"

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"
printf '\n%s역할 ARN: %s%s\n' "$_C_GREEN" "$ROLE_ARN" "$_C_RESET"
printf '\n다음 명령으로 GitHub 저장소 변수를 등록하세요 (시크릿 아님 — 전부 비민감 값):\n\n'
printf '  gh variable set AWS_DEPLOY_ROLE_ARN --body "%s"\n' "$ROLE_ARN"
printf '  gh variable set DEMO_READ_ONLY       --body "<true|false>"\n'
printf '  gh variable set ALLOWED_ORIGINS      --body "https://<vercel-도메인>"\n'
printf '  gh variable set OPENAI_MODEL         --body "gpt-4o-mini"\n'
printf '  gh variable set DESIRED_COUNT        --body "2"\n'
printf '  gh variable set ON_DEMAND_BASE_COUNT --body "1"\n'
