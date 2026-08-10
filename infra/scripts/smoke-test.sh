#!/usr/bin/env bash
# 배포 후 검증. 상태를 바꾸지 않는 호출만 쓴다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
[ -n "$API_URL" ] && [ "$API_URL" != "None" ] || die "ApiUrl 을 읽지 못했습니다."
load_env
# CI 에는 .env 가 없다 — 토큰 정본인 SSM 에서 직접 읽어 로컬과 똑같은 검증을 한다.
if [ -z "${MUTATION_API_TOKEN:-}" ]; then
  MUTATION_API_TOKEN="$(aws_ ssm get-parameter --name "$SSM_PREFIX/MUTATION_API_TOKEN" \
    --with-decryption --query 'Parameter.Value' --output text)" \
    || die "SSM 에서 MUTATION_API_TOKEN 을 읽지 못했습니다."
fi

log_step "1. /api/health — 정적 산출물 적재"
BODY="$(curl -fsS --max-time 20 "$API_URL/api/health")" || die "health 호출 실패"
echo "$BODY" | python3 -c '
import json,sys
b=json.load(sys.stdin)
assert b["data_loaded"] is True, "data_loaded=false — 이미지에 data/processed 가 안 실렸습니다"
missing=[k for k,v in b["datasets"].items() if not v]
assert not missing, f"결손 산출물: {missing}"
print("  datasets:", ", ".join(b["datasets"]))
print("  demo_read_only:", b["demo_read_only"])
' || die "health 본문 검증 실패"
log_ok "health 보고 산출물 전부 적재"

log_step "1-1. /api/dashboard — health 가 보고하지 않는 산출물까지 확인"
# usage_daily·usage_monthly 는 health 의 datasets 에 안 들어 있다. 실제 라우트를 한 번 때려야
# "health 는 초록인데 화면은 500" 인 상태를 잡을 수 있다.
curl -fsS --max-time 20 "$API_URL/api/dashboard" >/dev/null || die "dashboard 호출 실패 — 산출물 결손 가능"
log_ok "200"

log_step "2. /api/health/ready — ALB 대상그룹이 보는 경로"
CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL/api/health/ready")"
[ "$CODE" = "200" ] || die "ready 가 $CODE"
log_ok "200"

log_step "3. 스테이지 접두사 확인 (P0)"
# \$default 스테이지가 아니면 백엔드 경로에 /<stage> 가 붙어 전 API 가 404 가 된다.
# health 가 200 이라는 것 자체가 접두사가 안 붙었다는 증거다.
log_ok "/api/health 가 200 — 스테이지 접두사 없음"

log_step "4. Authorization 헤더 전달 (P0)"
# 담당자 전용 GET — 토큰이 필요하면서 상태를 바꾸지 않는 유일한 계열이다.
# 변경 API 로 확인하면 데모 시드가 오염된다.
NO_TOKEN="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL/api/progress-report" || true)"
WITH_TOKEN="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer ${MUTATION_API_TOKEN}" "$API_URL/api/progress-report" || true)"
[ "$NO_TOKEN" = "401" ] || log_warn "토큰 없이 $NO_TOKEN (401 기대) — 경계 확인 필요"
[ "$WITH_TOKEN" = "200" ] \
  || die "토큰을 넣었는데 $WITH_TOKEN — API Gateway 가 Authorization 헤더를 백엔드로 전달하지 않고 있습니다."
log_ok "무토큰 $NO_TOKEN / 유토큰 $WITH_TOKEN"

log_step "5. DynamoDB Gateway Endpoint 실사용 확인 (P0)"
# 태스크에 퍼블릭 IP 가 있어서 엔드포인트가 잘못 연결돼도 DynamoDB 호출은 IGW 경유로
# 그냥 성공한다 — 장애가 안 나서 더 위험하다. 라우트 주입을 직접 본다.
# ⚠ JMESPath 로 거르지 않는다 — prefix list 가 없는 일반 라우트는 이 필드가 null 이라
#   starts_with(null, 'pl-') 에서 CLI 가 InvalidType 으로 죽는다(라우트 유무와 무관하게 실패).
PL="$(aws_ ec2 describe-route-tables --filters "Name=tag:Name,Values=sangseng-public" \
  --query "RouteTables[0].Routes[].[DestinationPrefixListId,GatewayId]" --output text \
  | awk '$1 ~ /^pl-/ { print $2 }')"
[ -n "$PL" ] && [ "$PL" != "None" ] \
  || die "public 라우트 테이블에 DynamoDB prefix list 경로가 없습니다 — '프라이빗 경로' 주장이 성립하지 않습니다."
log_ok "$PL"

printf '\n%s스모크 테스트 통과 — %s%s\n' "$_C_GREEN" "$API_URL" "$_C_RESET"
