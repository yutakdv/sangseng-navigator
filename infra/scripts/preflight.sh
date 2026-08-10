#!/usr/bin/env bash
# 배포 전 사전 점검 — 아무것도 만들지 않는다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

log_step "1. AWS 자격증명"
CALLER=$(aws_ sts get-caller-identity --query Arn --output text) \
  || die "프로필 '${AWS_PROFILE:-(CI: OIDC)}' 로 인증할 수 없습니다. infra/README.md 의 배포 사용자 준비를 보세요."
log_ok "$CALLER"

log_step "2. 구 SAM 스택 잔존 확인"
if stack_exists sangseng-backend; then
  die "구 SAM 스택 'sangseng-backend' 가 남아 있습니다. 먼저 정리하세요: aws cloudformation delete-stack --stack-name sangseng-backend"
fi
log_ok "없음 (신규 구축)"

log_step "3. Docker 데몬"
docker info >/dev/null 2>&1 || die "Docker 가 실행 중이 아닙니다."
log_ok "실행 중"

log_step "4. 빌드 아키텍처 대조"
TEMPLATE_ARCH=$(grep -oE 'CpuArchitecture:[[:space:]]*[A-Z0-9_]+' \
  "$REPO_ROOT/infra/cloudformation/service.yaml" | awk '{print $2}' | head -1)
case "$CPU_ARCHITECTURE:$DOCKER_PLATFORM" in
  ARM64:linux/arm64|X86_64:linux/amd64) ;;
  *) die "config.sh 의 CPU_ARCHITECTURE($CPU_ARCHITECTURE) 와 DOCKER_PLATFORM($DOCKER_PLATFORM) 이 짝이 아닙니다." ;;
esac
[ "$TEMPLATE_ARCH" = "$CPU_ARCHITECTURE" ] \
  || die "service.yaml 의 CpuArchitecture($TEMPLATE_ARCH) 와 config.sh($CPU_ARCHITECTURE) 가 다릅니다. exec format error 로 첫 배포가 실패합니다."
log_ok "$CPU_ARCHITECTURE / $DOCKER_PLATFORM (템플릿 일치)"

log_step "5. 정적 산출물"
# 백엔드가 dataload.load() 로 실제로 부르는 이름 전부 — /api/health 의 REQUIRED+OPTIONAL 보다 넓다.
# usage_daily·usage_monthly 는 health 가 보고하지 않지만 대시보드·위젯 라우트가 부른다 —
# 빠지면 health 는 초록인데 화면이 500 이 나는, 가장 늦게 발견되는 형태의 장애가 된다.
for name in dashboard eup_scores candidates merchants risk_signal manifest usage_daily usage_monthly; do
  f="$REPO_ROOT/data/processed/$name.json"
  [ -f "$f" ] || die "$f 없음 — 먼저 'cd pipeline && python run_all.py' 를 실행하세요."
  python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f" \
    || die "$f 파싱 실패 (잘린 파일)"
done
log_ok "8종 존재·파싱 OK"

log_step "6. 설정값과 읽기전용 짝 검사"
load_env      # 환경변수 우선, .env 폴백
if [ -f "$REPO_ROOT/.env" ]; then
  [ -n "${OPENAI_API_KEY:-}" ] || die "OPENAI_API_KEY 미설정"
else
  log_warn ".env 없음 (CI 환경) — 시크릿은 SSM 에 이미 올라가 있어야 한다"
fi
if [ -z "${DEMO_READ_ONLY:-}" ]; then
  die "DEMO_READ_ONLY 미설정. 태스크 정의에 항상 명시해야 합니다 — 빠뜨리면 앱 기본값 false 로 공개 데모가 쓰기 가능 상태로 뜹니다. .env 에 true 또는 false 를 넣으세요."
fi
if [ "$DEMO_READ_ONLY" != "true" ] && [ -z "${MUTATION_API_TOKEN:-}" ]; then
  # CI 에는 .env 가 없고 토큰은 저장소 변수로 넘기지 않는다(정본은 SSM). 이미 올라가 있으면
  # 통과시킨다 — 태스크는 SSM 에서 주입받고 smoke-test.sh 도 같은 경로에서 읽는다.
  if aws_ ssm get-parameter --name "$SSM_PREFIX/MUTATION_API_TOKEN" >/dev/null 2>&1; then
    log_warn "MUTATION_API_TOKEN 이 환경에 없지만 SSM($SSM_PREFIX/MUTATION_API_TOKEN) 에 있습니다 — 그 값을 씁니다"
  else
    die "DEMO_READ_ONLY=$DEMO_READ_ONLY 인데 MUTATION_API_TOKEN 이 비어 있고 SSM 에도 없습니다. 변경 API 가 전부 503 이 됩니다.
  1) openssl rand -hex 32
  2) .env 의 MUTATION_API_TOKEN 에 기입
  3) ./infra/scripts/put-secrets.sh 로 SSM 에 올림
  4) 같은 값을 Vercel 환경변수 API_MUTATION_TOKEN 에 등록 (NEXT_PUBLIC_ 접두사 금지)"
  fi
fi
case "${MUTATION_API_TOKEN:-}" in
  *[!\ -~]*) die "MUTATION_API_TOKEN 에 비 ASCII 문자가 있습니다 — secrets.compare_digest 가 실패합니다. openssl rand -hex 32 를 쓰세요." ;;
esac
[ -n "${ALLOWED_ORIGINS:-}" ] || log_warn "ALLOWED_ORIGINS 미설정 — 배포 후 Vercel 도메인으로 채우고 재배포하세요 (서버-대-서버 호출이라 당장은 영향 없음)"
log_ok "DEMO_READ_ONLY=$DEMO_READ_ONLY"

log_step "7. CloudFormation 템플릿 문법"
for t in foundation service; do
  aws_ cloudformation validate-template \
    --template-body "file://$REPO_ROOT/infra/cloudformation/$t.yaml" >/dev/null \
    || die "$t.yaml 검증 실패"
done
log_ok "foundation·service 통과"

printf '\n%s사전 점검 통과%s\n' "$_C_GREEN" "$_C_RESET"
