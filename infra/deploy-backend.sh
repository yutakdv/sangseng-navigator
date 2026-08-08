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
[ -n "${MUTATION_API_TOKEN:-}" ] && PARAMS+=("MutationApiToken=${MUTATION_API_TOKEN}")
# 비우면 template의 fail-safe Default가 먹는다
# (AllowedOrigins='https://configure-me.invalid', DemoReadOnly='true', ReservedConcurrency=5)
[ -n "${ALLOWED_ORIGINS:-}" ] && PARAMS+=("AllowedOrigins=${ALLOWED_ORIGINS}")
[ -n "${DEMO_READ_ONLY:-}" ] && PARAMS+=("DemoReadOnly=${DEMO_READ_ONLY}")
[ -n "${RESERVED_CONCURRENCY:-}" ] && PARAMS+=("ReservedConcurrency=${RESERVED_CONCURRENCY}")

# 배포 후 "버튼은 보이는데 눌리지 않는" 조합을 배포 전에 잡는다.
# 위 두 줄은 값이 비면 파라미터를 아예 넘기지 않으므로 template Default
# (DemoReadOnly='true', MutationApiToken='')가 조용히 적용된다 — 그 결과가 각각 403·503이다.
if [ -z "${DEMO_READ_ONLY:-}" ]; then
  echo "⚠ DEMO_READ_ONLY 미설정 → template Default 'true' 적용."
  echo "  배포 후 카드 생성·승인·적격성·추진 상태 변경이 전부 403(읽기 전용)이 됩니다."
  echo "  심사위원이 직접 승인해 보게 하려면 .env 에 DEMO_READ_ONLY=false 를 넣으세요."
elif [ "${DEMO_READ_ONLY}" != "true" ] && [ -z "${MUTATION_API_TOKEN:-}" ]; then
  echo "✗ DEMO_READ_ONLY=${DEMO_READ_ONLY} 인데 MUTATION_API_TOKEN 이 비어 있습니다." >&2
  echo "  읽기 전용을 풀어도 변경 API가 전부 503(인증 미구성)으로 실패하므로 배포를 중단합니다." >&2
  echo "  1) 토큰 생성:  openssl rand -hex 32" >&2
  echo "  2) .env 의 MUTATION_API_TOKEN 에 기입" >&2
  echo "  3) 같은 값을 Vercel 환경변수 API_MUTATION_TOKEN 에 등록 (NEXT_PUBLIC_ 접두사 금지)" >&2
  exit 1
fi

sam build -t template.yaml
sam deploy \
  --stack-name sangseng-backend \
  --resolve-s3 --capabilities CAPABILITY_IAM \
  --region ap-northeast-2 \
  --parameter-overrides "${PARAMS[@]}" \
  --no-confirm-changeset

aws cloudformation describe-stacks --stack-name sangseng-backend \
  --query 'Stacks[0].Outputs' --output table
