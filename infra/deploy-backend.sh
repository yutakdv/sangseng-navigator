#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ../.env   # LLM 키 로드

# processed 데이터를 Lambda 번들에 포함
rm -rf ../backend/app/data && cp -r ../data/processed ../backend/app/data

# 빈 값 파라미터는 제외 — SAM이 "Key=" 형식을 거부함 (template에 Default: '' 있음)
PARAMS=("LlmProvider=${LLM_PROVIDER:-openai}")
[ -n "${OPENAI_API_KEY:-}" ] && PARAMS+=("OpenAiApiKey=${OPENAI_API_KEY}")
[ -n "${ANTHROPIC_API_KEY:-}" ] && PARAMS+=("AnthropicApiKey=${ANTHROPIC_API_KEY}")
# 비우면 template의 Default가 먹는다 (AllowedOrigins='*', ReservedConcurrency=5)
[ -n "${ALLOWED_ORIGINS:-}" ] && PARAMS+=("AllowedOrigins=${ALLOWED_ORIGINS}")
[ -n "${RESERVED_CONCURRENCY:-}" ] && PARAMS+=("ReservedConcurrency=${RESERVED_CONCURRENCY}")

sam build -t template.yaml
sam deploy \
  --stack-name sangseng-backend \
  --resolve-s3 --capabilities CAPABILITY_IAM \
  --region ap-northeast-2 \
  --parameter-overrides "${PARAMS[@]}" \
  --no-confirm-changeset

aws cloudformation describe-stacks --stack-name sangseng-backend \
  --query 'Stacks[0].Outputs' --output table
