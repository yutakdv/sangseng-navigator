# 09. 배포 — FE: Vercel / BE: AWS (Lambda + API Gateway + DynamoDB)

> 구성: 프론트는 **Vercel**(git push 자동 배포 + PR 프리뷰), 백엔드는 **AWS SAM**으로
> Lambda + HTTP API + DynamoDB. FE는 `NEXT_PUBLIC_API_BASE`로 API Gateway URL을 호출한다.
> 리전은 `ap-northeast-2` 고정.

```
사용자 ─▶ Vercel (Next.js, xxx.vercel.app)
              │ fetch (NEXT_PUBLIC_API_BASE)
              ▼
        API Gateway(HTTP API) ─▶ Lambda(FastAPI+Mangum) ─▶ DynamoDB / LLM API
```

## 1. 백엔드 — SAM

### `infra/template.yaml`

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: sangseng-navigator backend

Parameters:
  LlmProvider:      { Type: String, Default: openai }
  OpenAiApiKey:     { Type: String, Default: '', NoEcho: true }
  AnthropicApiKey:  { Type: String, Default: '', NoEcho: true }

Globals:
  Function:
    Runtime: python3.12
    Timeout: 30          # LLM 호출 여유
    MemorySize: 512

Resources:
  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      CorsConfiguration:
        AllowOrigins: ['*']   # 1차 배포용. Vercel 도메인 확정 후 §5에서 좁힌다
        AllowMethods: [GET, POST, OPTIONS]
        AllowHeaders: ['*']

  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ../backend
      Handler: app.main.handler
      Environment:
        Variables:
          CARDS_TABLE: !Ref CardsTable
          LLM_PROVIDER: !Ref LlmProvider
          OPENAI_API_KEY: !Ref OpenAiApiKey
          ANTHROPIC_API_KEY: !Ref AnthropicApiKey
      Policies:
        - DynamoDBCrudPolicy: { TableName: !Ref CardsTable }
      Events:
        Proxy:
          Type: HttpApi
          Properties: { ApiId: !Ref HttpApi, Path: '/{proxy+}', Method: ANY }

  CardsTable:
    Type: AWS::Serverless::SimpleTable        # PAY_PER_REQUEST(온디맨드) 기본
    Properties:
      PrimaryKey: { Name: id, Type: String }

  ApiLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub /aws/lambda/${ApiFunction}
      RetentionInDays: 7                      # 로그 비용 방지

Outputs:
  ApiUrl:     { Value: !Sub 'https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com' }
  CardsTable: { Value: !Ref CardsTable }
```

### `infra/deploy-backend.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source ../.env   # LLM 키 로드

# processed 데이터를 Lambda 번들에 포함
rm -rf ../backend/app/data && cp -r ../data/processed ../backend/app/data

# 빈 값 파라미터는 제외 — SAM이 "Key=" 형식을 거부함 (2026-08-03 실측, template Default: '' 활용)
PARAMS=("LlmProvider=${LLM_PROVIDER:-openai}")
[ -n "${OPENAI_API_KEY:-}" ] && PARAMS+=("OpenAiApiKey=${OPENAI_API_KEY}")
[ -n "${ANTHROPIC_API_KEY:-}" ] && PARAMS+=("AnthropicApiKey=${ANTHROPIC_API_KEY}")

sam build -t template.yaml
sam deploy -t template.yaml \
  --stack-name sangseng-backend \
  --resolve-s3 --capabilities CAPABILITY_IAM \
  --region ap-northeast-2 \
  --parameter-overrides "${PARAMS[@]}" \
  --no-confirm-changeset

aws cloudformation describe-stacks --stack-name sangseng-backend \
  --query 'Stacks[0].Outputs' --output table
```

- [ ] 최초 배포 후 Outputs의 `CardsTable` 값을 `.env`의 `CARDS_TABLE`에 반영 (로컬 BE도 같은 테이블 사용)
- [ ] `python backend/seed_demo.py` 실행 — 데모 사례(추진중 카드 등) 시드
- [ ] **검증:** `curl $ApiUrl/api/health` → `{"ok":true,"data_loaded":true}`,
      `curl $ApiUrl/api/dashboard | jq .conversion.headline_rate`

## 2. 프론트엔드 — Vercel

### 최초 1회 설정 (~10분)

- [ ] vercel.com 가입 → GitHub 레포 연결 → **Root Directory를 `frontend/`로 지정** (모노레포 대응)
- [ ] Framework Preset: Next.js (자동 감지). `output: 'export'` 불필요 — Vercel이 네이티브 지원하므로
      동적 라우트·이미지 최적화 전부 그대로 사용 가능
- [ ] 환경변수 등록 (Vercel 대시보드 → Settings → Environment Variables):
      - `NEXT_PUBLIC_API_BASE` = SAM Outputs의 `ApiUrl` (Production + Preview 모두)
- [ ] 배포 도메인(`<project>.vercel.app`) 기록 → 최종 데모 URL

### 이후 배포 흐름

- `main`에 push → Production 자동 배포 / PR 생성 → Preview URL 자동 생성 (FE 팀원과 리뷰에 활용)
- 수동 배포가 필요하면: `cd frontend && npx vercel --prod`
- [ ] **검증:** Vercel URL 접속 → 허브 렌더 + 카드 승인까지 실 API로 동작, 모바일(Safari 포함)에서 위젯 확인

## 3. 비용 체크 (월 기준)

### AWS (서울 리전, 데모+테스트 트래픽 — 월 수만 요청 가정)

| 서비스 | 과금 기준 | 프리티어 | 예상 비용 |
|---|---|---|---|
| Lambda | 요청 수 + GB-초 | **상시 무료**: 월 100만 요청 + 40만 GB-초 | **$0** (512MB·0.5초 기준 월 수만 콜은 프리티어의 1% 미만) |
| API Gateway (HTTP API) | 요청 100만 건당 약 $1.2 (서울) | 가입 12개월간 월 100만 건 | **$0** (프리티어 종료 후에도 월 3만 요청 ≈ $0.04) |
| DynamoDB (온디맨드) | 쓰기 100만 건당 ~$1.6, 읽기 100만 건당 ~$0.3 | 스토리지 25GB 상시 무료 | **$0** (카드 수십 건, 요청 수천 건 수준) |
| CloudWatch Logs | 수집 5GB 상시 무료 | 보존 7일 설정 | **$0** |
| 데이터 전송 (아웃바운드) | 월 100GB 상시 무료 | JSON 응답 수 KB | **$0** |
| **AWS 합계** | | | **사실상 $0 — 최악 가정으로도 월 $1 미만** |

- S3·CloudFront가 구성에서 빠졌으므로(FE=Vercel) AWS 쪽은 순수 API 비용만 남는다
- 비용이 발생할 수 있는 유일한 지점은 **Lambda 안에서의 LLM 호출 시간**(Timeout 30초 × 호출 수)이지만,
  데모 수준 수백 콜 × 5초라도 GB-초 프리티어(40만) 대비 무시 가능
- 안전장치: Billing 알림 $1 설정, 캠프 후 `sam delete`로 완전 철거 가능

### Vercel

| 항목 | 내용 |
|---|---|
| 플랜 | **Hobby(무료)** — 개인·비상업 용도. 대회 데모 사용은 문제 없음 |
| 한도 | 대역폭 100GB/월, 빌드 6,000분/월 — 데모 트래픽 대비 여유 큼 |
| 비용 | **$0** |

### LLM (참고)

gpt-4o-mini $0.15/$0.60 per 1M tokens 기준 데모 수백 호출 ≈ **수백 원**.
claude-sonnet-5 전환 시 $3/$15(인트로 $2/$10)로 수천 원 수준.

**총계: AWS ≈ $0/월 + Vercel $0 + LLM 사용량(수백 원~) → 실질 비용은 LLM뿐.**

## 4. 배포 시점 — 개발 완료 후 최종 1회 (2026-08-03 결정 변경)

**개발 기간에는 AWS에 배포하지 않는다.** 테스트는 Docker(BE+DynamoDB Local, 14 문서 T7)로 완결하고,
전체 개발이 끝난 뒤 이 문서 §1~§2 절차로 1회 배포한다 (상세 시퀀스: 14 문서 T17).

사전 검증 완료분 (2026-08-03) — 최종 배포 리스크를 줄이는 근거:
- [x] `sam validate --lint` 통과, `sam build` 성공 (번들·requirements 문제 없음)
- [x] deploy 스크립트의 빈 파라미터 형식 오류 수정 완료 (§1 스크립트에 반영)
- [ ] **미해결 선행조건: IAM 권한** — `Yutak_trading` 사용자에 CloudFormation·API Gateway·DynamoDB
      권한 없음(AccessDenied 실측). 최종 배포 **전날까지** 인라인 정책 부착 (14 문서 T17 Step 1)

## 5. 마무리 조이기 (여유 있을 때)

- [ ] CORS `AllowOrigins`를 `['https://<project>.vercel.app', 'http://localhost:3000']`으로 좁혀 재배포
      (Vercel Preview URL도 쓸 거면 `https://*.vercel.app` 패턴은 HTTP API에서 안 되므로
      Preview 도메인을 명시 추가하거나 데모 기간엔 `*` 유지 판단)
- [ ] Billing 콘솔 $0 스크린샷 (발표 Q&A "운영 비용?" 대비)

## 5.5 심사 기간 운영 (제출 ~ 심사 종료, 상세: 12 문서 §5)

배포 URL은 전시 플랫폼에 등록되어 심사위원이 임의 시점에 접속한다. 발표가 끝나도 내리지 않는다.

- [ ] 제출 직전 `python backend/seed_demo.py --reset` — 데모 초기 상태 복원
- [ ] (여유 시) 콜드스타트 완화 — SAM에 워밍 룰 추가 후 재배포 (프리티어 내 $0):

```yaml
  WarmerRule:
    Type: AWS::Events::Rule
    Properties:
      ScheduleExpression: rate(5 minutes)
      Targets: [{ Arn: !GetAtt ApiFunction.Arn, Id: warmer,
                  Input: '{"requestContext":{"http":{"method":"GET","path":"/api/health"}},"rawPath":"/api/health","routeKey":"GET /api/health","version":"2.0","headers":{}}' }]
  WarmerPermission:
    Type: AWS::Lambda::Permission
    Properties: { FunctionName: !Ref ApiFunction, Action: lambda:InvokeFunction,
                  Principal: events.amazonaws.com, SourceArn: !GetAtt WarmerRule.Arn }
```

- [ ] (여유 시) 심사위원 조작으로 인한 데모 상태 오염 대비 — 시드 리셋을 EventBridge 스케줄(매시)로
      자동화하거나, 최소한 심사 기간 중 하루 1회 수동 리셋
- [ ] (선택) `ApiFunction`에 `ReservedConcurrentExecutions: 5` — 공개 URL의 LLM 호출 남용 상한
- [ ] Vercel Password Protection **OFF** 확인 (제출 요건 — 로그인 없이 접속)

## 6. 철거 (종료 후)

> ⚠ **심사·전시가 끝나기 전에는 절대 철거하지 않는다** (12 문서 §6 — 심사 기간 배포 유지 요건).

```bash
sam delete --stack-name sangseng-backend --region ap-northeast-2
# Vercel: 대시보드에서 프로젝트 Delete (또는 그냥 둬도 $0)
```

## 트러블슈팅 메모

| 증상 | 원인/조치 |
|---|---|
| `sam build` 실패 (로컬 Python 버전 불일치) | 로컬에 Python 3.12가 없으면 `sam build --use-container` (Docker 필요) 또는 pyenv로 3.12 설치 |
| Lambda 500 + "Unable to import module" | `sam build`가 requirements 미설치 — `backend/requirements.txt` 위치 확인. pandas 등 무거운 패키지가 섞였는지도 확인 (07 문서 의존성 원칙) |
| Lambda 500 + Decimal 직렬화 오류 | DDB 응답의 Decimal 미변환 — `db.py`의 `_clean` 경유 확인 (07 문서 B2) |
| BE만 고쳤는데 Vercel이 재빌드 | (선택) Vercel Settings → Git → Ignored Build Step에 `git diff --quiet HEAD^ HEAD -- .` 설정 — Root Directory(frontend) 변경 없으면 빌드 스킵 |
| `data_loaded: false` | `deploy-backend.sh`의 data 복사 단계 누락 — 스크립트로만 배포 |
| FE에서 CORS 에러 | HTTP API CorsConfiguration 확인, API URL 끝 `/` 중복 확인 |
| Vercel 빌드 실패 | Root Directory가 `frontend/`인지, 환경변수 등록 후 **재배포**했는지 확인 (env는 빌드 시점 주입) |
| Vercel에서 mock만 나옴 | `NEXT_PUBLIC_API_BASE` 미설정 상태로 빌드됨 — env 넣고 Redeploy |
| LLM 타임아웃 | Lambda Timeout 30s 확인, gpt-4o-mini/claude-sonnet-5 유지 (대형 모델 금지) |
