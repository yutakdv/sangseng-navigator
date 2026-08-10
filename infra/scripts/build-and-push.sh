#!/usr/bin/env bash
# data/processed 를 이미지에 실어 ARM64 로 빌드해 ECR 로 민다.
# 태그는 git short SHA — 불변 태그여야 태스크 정의가 특정 버전을 가리키고 롤백이 성립한다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

TAG="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
  TAG="${TAG}-dirty"
  log_warn "커밋되지 않은 변경이 있어 태그에 -dirty 를 붙입니다: $TAG"
fi

ECR_URI="$(stack_output "$FOUNDATION_STACK" EcrRepositoryUri)"
[ -n "$ECR_URI" ] && [ "$ECR_URI" != "None" ] || die "foundation 스택의 EcrRepositoryUri 를 읽지 못했습니다. deploy-foundation.sh 를 먼저 실행하세요."

log_step "정적 산출물을 빌드 컨텍스트로 복사"
# ⚠ rm 없이 cp 만 하면 이전 배포의 잔여 파일이 그대로 이미지에 구워진다.
rm -rf "$REPO_ROOT/backend/app/data"
cp -r "$REPO_ROOT/data/processed" "$REPO_ROOT/backend/app/data"
log_ok "$(ls "$REPO_ROOT/backend/app/data" | wc -l | tr -d ' ') 개 파일"

log_step "ECR 로그인"
aws_ ecr get-login-password | docker login --username AWS --password-stdin "${ECR_URI%%/*}" >/dev/null
log_ok "${ECR_URI%%/*}"

log_step "빌드 ($DOCKER_PLATFORM)"
docker build --platform "$DOCKER_PLATFORM" \
  -t "$ECR_URI:$TAG" "$REPO_ROOT/backend"

log_step "아키텍처 검증"
BUILT_ARCH="$(docker image inspect "$ECR_URI:$TAG" --format '{{.Architecture}}')"
EXPECTED_ARCH="${DOCKER_PLATFORM##*/}"
[ "$BUILT_ARCH" = "$EXPECTED_ARCH" ] \
  || die "빌드된 이미지가 $BUILT_ARCH 입니다 ($EXPECTED_ARCH 기대). 태스크가 exec format error 로 죽습니다."
log_ok "$BUILT_ARCH"

log_step "푸시"
docker push "$ECR_URI:$TAG" >/dev/null
log_ok "$ECR_URI:$TAG"

echo "$TAG"
