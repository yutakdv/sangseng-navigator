#!/usr/bin/env bash
# 배포 설정 단일 정의 — 모든 스크립트가 이 파일만 본다.
# ⚠ CPU_ARCHITECTURE / DOCKER_PLATFORM 은 반드시 짝이 맞아야 한다.
#   불일치는 태스크가 exec format error 로 즉시 죽으며, 첫 배포에는 자동 롤백이 없다.

# CI(GitHub Actions)에는 프로필이 없다 — OIDC 로 주입된 환경변수 자격증명을 그대로 쓴다.
# 로컬에서만 프로필을 강제하고, aws CLI 가 AWS_PROFILE 을 자동으로 읽으므로
# 개별 호출에 --profile 을 붙이지 않는다.
[ -n "${CI:-}" ] || export AWS_PROFILE="${AWS_PROFILE:-sangseng}"
export AWS_REGION="${AWS_REGION:-ap-northeast-2}"

export FOUNDATION_STACK="sangseng-foundation"
export SERVICE_STACK="sangseng-service"

# ⚠ 스택 이름은 반드시 'sangseng-' 으로 시작해야 한다 —
#   배포 사용자 인라인 정책이 역할 생성을 role/sangseng-* 로 제한한다.

export ECR_REPO="sangseng-api"
export CLUSTER_NAME="sangseng-cluster"
export SERVICE_NAME="sangseng-api"

export CPU_ARCHITECTURE="ARM64"      # service.yaml 의 RuntimePlatform.CpuArchitecture
export DOCKER_PLATFORM="linux/arm64" # docker build --platform

export SSM_PREFIX="/sangseng/prod"

# VPC Link V2 미지원 AZ(ap-northeast-2d = apne2-az4)를 피해 명시 고정한다.
export AZ_A="ap-northeast-2a"
export AZ_C="ap-northeast-2c"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REPO_ROOT
