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
  # 무인증 공개 URL의 generate 엔드포인트가 호출마다 LLM을 부르므로 동시성 상한을 기본값으로 건다 (§5.5)
  ReservedConcurrency: { Type: Number, Default: 5 }   # -1이면 설정 자체를 생략(계정 동시성 한도가 낮아 배포 실패할 때)
  AllowedOrigins:      { Type: String, Default: 'https://configure-me.invalid' }
  DemoReadOnly:        { Type: String, Default: 'true', AllowedValues: ['true', 'false'] }

Conditions:
  HasReservedConcurrency: !Not [!Equals [!Ref ReservedConcurrency, '-1']]

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
        # 게이트웨이와 앱이 같은 명시적 오리진 목록을 사용한다.
        AllowOrigins: !Split [',', !Ref AllowedOrigins]
        AllowMethods: [GET, POST, OPTIONS]
        AllowHeaders: [Authorization, Content-Type, X-Request-ID]

  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      CodeUri: ../backend
      Handler: app.main.handler
      ReservedConcurrentExecutions: !If [HasReservedConcurrency, !Ref ReservedConcurrency, !Ref 'AWS::NoValue']
      Environment:
        Variables:
          CARDS_TABLE: !Ref CardsTable
          LLM_PROVIDER: !Ref LlmProvider
          OPENAI_API_KEY: !Ref OpenAiApiKey
          ANTHROPIC_API_KEY: !Ref AnthropicApiKey
          ALLOWED_ORIGINS: !Ref AllowedOrigins
          DEMO_READ_ONLY: !Ref DemoReadOnly
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
# 비우면 fail-safe Default가 적용된다
# (AllowedOrigins='https://configure-me.invalid', DemoReadOnly='true', ReservedConcurrency=5)
[ -n "${ALLOWED_ORIGINS:-}" ] && PARAMS+=("AllowedOrigins=${ALLOWED_ORIGINS}")
[ -n "${DEMO_READ_ONLY:-}" ] && PARAMS+=("DemoReadOnly=${DEMO_READ_ONLY}")
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
```

- 스크립트가 `.env`에서 읽는 파라미터: `LLM_PROVIDER`·`OPENAI_API_KEY`·`ANTHROPIC_API_KEY`에 더해
  **`ALLOWED_ORIGINS`·`DEMO_READ_ONLY`·`RESERVED_CONCURRENCY`**. 오리진과 read-only를 비워 두면
  각각 차단용 오리진과 `true`가 적용되어 공개 mutation이 열리지 않는다 (§5·§5.5)
- `sam deploy`에는 `-t`를 주지 않는다 — `sam build` 산출물(`.aws-sam/build/template.yaml`)이 배포 대상이다
- [ ] 최초 배포 후 Outputs의 `CardsTable` 값을 `.env`의 `CARDS_TABLE`에 반영 (로컬 BE도 같은 테이블 사용)
- [ ] `python backend/seed_demo.py` 실행 — 데모 사례(추진중 카드 등) 시드
- [ ] **검증:** `curl $ApiUrl/api/health` → `{"ok":true,"data_loaded":true,"datasets":{...}}`
      (`datasets` 5종 전부 `true` — 번들 복사 누락 조기 발견, 05 §5),
      `curl $ApiUrl/api/dashboard | jq .conversion.headline_rate`

## 2. 프론트엔드 — Vercel

### 최초 1회 설정 (~10분)

- [ ] vercel.com 가입 → GitHub 레포 연결 → **Root Directory를 `frontend/`로 지정** (모노레포 대응)
- [ ] Framework Preset: Next.js (자동 감지). `output: 'export'` 불필요 — Vercel이 네이티브 지원하므로
      동적 라우트·이미지 최적화 전부 그대로 사용 가능
- [ ] 환경변수 등록 (Vercel 대시보드 → Settings → Environment Variables):
      - `NEXT_PUBLIC_API_BASE` = SAM Outputs의 `ApiUrl` (Production + Preview 모두)
      - `API_MUTATION_TOKEN` = 백엔드 `MUTATION_API_TOKEN`과 **같은 값** (서버 전용 — 승인·기록 등
        상태 변경 요청과 **담당자 화면 전용 GET 2종**(`/api/progress-report`,
        `/api/cards/{id}/progress-records`)에 모두 필요하다. 빠뜨리면 승인 버튼이 401로 실패하고
        `/tracking`의 추진 경과 리포트가 통째로 접힌다 — 업무 목록만 남고 안내 배너가 뜬다)
      - `NEXT_PUBLIC_DEMO_READ_ONLY` = `false` (심사위원이 직접 승인해 보게 하려면 잠그지 않는다)
      - `DATA_GO_KR_API_KEY` = 루트 `.env`와 같은 **Decoding** 키 (Production + Preview).
        **`NEXT_PUBLIC_` 접두사 금지** — 붙이면 브라우저 번들에 키가 실린다. 빠뜨려도 에러는 없고
        방문객 위젯 "오늘의 추천"에서 **날씨 줄만 조용히 사라진다**(요일 추천은 계속 뜬다)
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

## 5. 마무리 조이기 (배포 URL 확정 후)

**CORS는 2층이지만 배포에서 효력을 갖는 건 게이트웨이다.** ① API Gateway
`CorsConfiguration.AllowOrigins` ② FastAPI `CORSMiddleware.allow_origins`(앱).
⚠ **HTTP API에 `CorsConfiguration`이 설정돼 있으면 API Gateway는 통합(Lambda)이 돌려준 CORS 헤더를
무시하고 자기 설정으로 덮는다**
([AWS 문서](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html)).
따라서 앱 쪽만 좁히면 배포 환경에서는 **아무 효과가 없다** — 좁혔다고 착각하기 쉬운 함정이다.

그래서 template이 두 층을 **같은 파라미터 하나**로 묶는다: 게이트웨이는
`AllowOrigins: !Split [',', !Ref AllowedOrigins]`, Lambda 환경변수는 `ALLOWED_ORIGINS: !Ref AllowedOrigins`.
`AllowedOrigins`(기본 `https://configure-me.invalid`) 하나만 바꾸면 두 층이 함께 움직인다. 앱 레벨 설정은 로컬 uvicorn·Docker처럼
게이트웨이를 거치지 않는 경로에서 의미가 있다.

- [ ] `.env`에 실제 확정된 프론트 오리지만 `ALLOWED_ORIGINS=https://<확정-도메인>`으로 기입 →
      `./deploy-backend.sh` 재실행 (스크립트가 `AllowedOrigins` 파라미터로 넘겨 두 층을 함께 좁힌다)
      - Preview도 써야 하면 해당 Preview 오리진을 콤마로 명시한다. `*`는 사용하지 않는다
- [ ] **검증:** 브라우저에서 Vercel 배포 URL로 정상 호출되는지 + 임의 오리진(로컬 파일 등)에서
      차단되는지 확인. 차단이 안 되면 게이트웨이 실제 설정부터 확인한다
      (`aws apigatewayv2 get-api --api-id <id> --query CorsConfiguration`)
- [ ] 인증·RBAC가 구현되기 전까지 `.env`의 `DEMO_READ_ONLY=true`를 유지하고, health 응답의
      `demo_read_only:true`를 확인한다. 실운영 mutation을 열 때는 공통 mutation dependency에 조직 사용자
      인증과 역할 검사를 먼저 연결한 뒤에만 `false`로 전환한다
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
- [x] **동시성 상한은 기본 적용** — `ApiFunction`의 `ReservedConcurrentExecutions`를 SAM 파라미터
      `ReservedConcurrency`(**기본 5**)로 건다. 무인증 공개 URL의 `POST /api/cards/generate`가
      호출마다 LLM을 부르므로 남용 시 비용·rate limit이 곧바로 튄다 — "여유 있으면"에 둘 항목이 아니다
      - 해제가 필요하면 `RESERVED_CONCURRENCY=-1` (template의 `Conditions`가 속성 자체를 생략)
      - **배포가 `ReservedConcurrentExecutions` 관련 오류로 실패하면**(계정의 미예약 동시성 여유가
        부족한 경우 — 신규 계정은 총 한도가 낮다) `RESERVED_CONCURRENCY=-1`로 다시 배포하고,
        상한은 API Gateway 쪽 throttling 또는 수동 모니터링으로 대체한다
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
| `data_loaded: false` | `deploy-backend.sh`의 data 복사 단계 누락 — 스크립트로만 배포. 응답의 `datasets`에서 어느 산출물이 `false`인지 바로 확인 (05 §5) |
| FE에서 CORS 에러 | 배포 경로에서 효력을 갖는 건 **게이트웨이 `CorsConfiguration`** 하나다(§5 — API Gateway가 Lambda의 CORS 헤더를 덮는다). `aws apigatewayv2 get-api --api-id <id> --query CorsConfiguration`으로 실제 값부터 확인하고, API URL 끝 `/` 중복도 확인 |
| 배포 실패 — `ReservedConcurrentExecutions` 오류 | 계정의 미예약 동시성 여유 부족 → `.env`에 `RESERVED_CONCURRENCY=-1` 후 재배포 (속성 자체가 생략된다 — §5.5) |
| Vercel 빌드 실패 | Root Directory가 `frontend/`인지, 환경변수 등록 후 **재배포**했는지 확인 (env는 빌드 시점 주입) |
| Vercel에서 mock만 나옴 | `NEXT_PUBLIC_API_BASE` 미설정 상태로 빌드됨 — env 넣고 Redeploy |
| LLM 타임아웃 | Lambda Timeout 30s 확인, gpt-4o-mini/claude-sonnet-5 유지 (대형 모델 금지) |
