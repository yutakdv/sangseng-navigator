# 09. 배포 — FE: Vercel / BE: AWS ECS Fargate (내부 ALB + API Gateway + DynamoDB)

> **2026-08-11 — SAM(Lambda + Mangum) 구성에서 ECS Fargate 로 전면 이전했다.**
> 이전 구성에 대한 서술은 `docs/audit/`·`docs/review/` 에 작성 시점의 기록으로 남아 있으며
> 그 문서들은 사실 기록이므로 수정하지 않는다. **현재 배포 정본은 이 문서다.**
> 결정 근거·기각안·비용 산출은 [설계 스펙](../superpowers/specs/2026-08-10-ecs-infra-design.md)에 있다.

이전한 이유는 하나다 — **배포 중 무중단**. Lambda 구성은 배포가 원자적이지 않아 시연 중 갱신이 위험했고,
콜드스타트 1~3초가 첫인상을 깎았다. 대가는 상시 가동 비용(월 $30 수준)이다.

```
브라우저(한국) ──https──▶ Vercel Function (icn1 = 서울)
                              │  서버사이드 fetch, Authorization: Bearer
                              ▼  https (AWS 관리 인증서, 무료)
                   API Gateway HTTP API  ($default 스테이지)
                              │  VPC Link (무과금, VPC 내부)
    ┌─────────────────────────┼──────────────────────────────── VPC 10.0.0.0/16
    │  private-a / private-c  ▼   (라우트: local 만 — NAT 없음, 비용 $0)
    │        VPC Link ENI ──▶ 내부 ALB (scheme: internal)
    │                              │  대상그룹 target-type: ip
    │  public-a / public-c        ▼   (라우트: local + 0.0.0.0/0 → IGW)
    │        ECS Fargate ARM64 Spot ×2  (assignPublicIp: ENABLED)
    │              │  SG 인바운드: ALB SG 출처 8000 only
    │              ├── DynamoDB ◀── Gateway Endpoint (무과금, 인터넷 미경유)
    │              └── OpenAI / ECR ──▶ IGW 직행 (NAT 불필요)
    └────────────────────────────────────────────────────────────
```

---

## 1. 백엔드 — ECS Fargate

### 스택 2개

| 스택 | 담는 것 | 갱신 주기 |
|---|---|---|
| `sangseng-foundation` | VPC·IGW·서브넷 4개·라우트 테이블 2개·DynamoDB Gateway Endpoint·ECR·DynamoDB 테이블 2개·IAM 역할 2개·로그 그룹 | 거의 안 바뀜 (수동 배포) |
| `sangseng-service` | 보안그룹 3개·내부 ALB·대상그룹·리스너·ECS 클러스터·태스크 정의·서비스·HTTP API·VPC Link·Integration·Route·Stage | 배포마다 (CI 자동) |

**분리 이유.** ① 코드만 바뀌면 service 스택만 갱신하면 되어 배포가 5분에 끝난다. ② ECR 리포지토리가
먼저 있어야 첫 이미지를 밀 수 있는데 ECS 서비스는 그 이미지가 있어야 뜬다 — 이 순환이 스택 경계로 풀린다.
③ DynamoDB 테이블에 `DeletionPolicy: Retain`을 걸어 service 스택을 몇 번 갈아엎어도 승인된 카드가 남는다.

**스택 이름은 반드시 `sangseng-` 으로 시작한다.** 배포 사용자 인라인 정책이 역할 생성을
`arn:aws:iam::325899476013:role/sangseng-*` 로 제한하고, CFN 자동 생성 역할 이름이
`<스택명>-<논리ID>-<난수>` 형태이기 때문이다.

### AZ 고정

`ap-northeast-2a` / `ap-northeast-2c` 로 **명시 지정**한다. `!GetAZs` 에 의존하지 않는다 —
**`ap-northeast-2d`(apne2-az4)는 VPC Link V2 를 지원하지 않고**, VPC Link 는 immutable 이라
잘못 만들면 삭제 후 재생성만이 복구 경로다.

### NAT 가 없는 이유

인터넷 egress 가 필요한 것은 ECS 태스크뿐이다(OpenAI 호출, ECR pull). 태스크를 public 서브넷에 두고
public IP 를 붙이면 IGW 로 직접 나간다. 내부 ALB 와 VPC Link ENI 는 VPC 안에서만 통신하므로
**NAT 없는 private 서브넷은 라우트 테이블에 local 만 두면 되어 비용이 0** 이다.
서울 NAT Gateway 는 월 $43, 퍼블릭 IPv4 2개는 월 $7.3 이라 이 규모에서 public 직결이 5.9배 싸다.

대가는 인바운드 차단이 전적으로 보안그룹에 달린다는 것이다. 태스크 SG 는 **ALB SG 를 출처로 하는
8000 포트만** 허용하고 `0.0.0.0/0` 인바운드는 어떤 포트에도 열지 않는다.

### 배포 절차

```bash
./infra/scripts/deploy.sh
```

`preflight → put-secrets → foundation → build&push → service → smoke-test` 순으로 돈다.
스크립트별 책임은 [infra/README.md](../../infra/README.md).

| | 소요 | 병목 |
|---|---|---|
| foundation 최초 | 3~5분 | |
| 이미지 빌드 + 푸시 (최초) | 2~4분 | |
| service 최초 | 12~18분 | **VPC Link 생성 최대 10분** |
| **첫 배포 합계** | **20~30분** | |
| 이후 재배포 | **4~6분** | |
| 철거 | 10~15분 | VPC Link 삭제 + ENI 정리 |

### 컨테이너 이미지

`backend/Dockerfile` — `python:3.12-slim`, ARM64, 비루트(uid 10001), uvicorn 단일 워커.

- `--workers 1` 고정: 0.5GB 제약. OpenAI SDK 로드 후 RSS 116MB(실측)라 2워커는 OOM 위험이다.
  확장은 `DESIRED_COUNT` 로 한다
- `--timeout-graceful-shutdown 30` / `stopTimeout 60`: 최악 24.5초 LLM 요청이 진행 중일 수 있다
- `--timeout-keep-alive 75`: ALB `idle_timeout` 65초보다 길게 (역전되면 간헐 502)
- **`backend/.dockerignore` 는 보안 장치다** — 빌드 컨텍스트에 `.env` 가 들어가면 이미지에 구워지고
  `main.py` 의 `load_dotenv` 가 그 키를 실제로 로드한다. ECR 레이어는 지워도 남아 회수 수단이 키 로테이션뿐이다

정적 산출물은 `build-and-push.sh` 가 `data/processed/` → `backend/app/data/` 로 복사해 이미지에 굽는다.
**이미지에도 태스크 정의에도 `/data` 디렉터리나 볼륨을 만들지 말 것** — `dataload` 의 첫 번째 후보 경로가
`/data/processed` 라 그쪽이 잡히면 이미지에 구운 `/app/app/data` 를 조용히 가린다.

---

## 2. 프론트엔드 — Vercel

GitHub 연동으로 `main` 머지 시 자동 배포된다(PR 은 Preview 배포).

### `frontend/vercel.json`

```json
{ "$schema": "https://openapi.vercel.sh/vercel.json", "regions": ["icn1"] }
```

기본값 `iad1`(버지니아)에서는 한국 사용자 요청이 태평양을 건너고, SSR 안의 API 호출이 서울 백엔드로
**다시 왕복**한다(리전 간 RTT 182ms). `icn1` 로 옮기면 SSR TTFB 가 550~800ms → 60~120ms 가 된다.

**실측 확인 방법**: `curl -sI https://<도메인>/ | grep -i x-vercel-id` → `icn1::icn1::...`
첫 칸은 엣지, **둘째 칸이 함수 실행 리전**이다. `icn1::iad1` 이면 리전 설정이 반영되지 않은 것이다.

### 환경변수 (Settings → Environment Variables, Production·Preview 양쪽)

| 이름 | 값 | 비고 |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | service 스택 Outputs 의 `ApiUrl` | **끝 슬래시 없이.** 없으면 빌드가 실패한다(mock 폴백 없음) |
| `API_MUTATION_TOKEN` | 백엔드 `MUTATION_API_TOKEN` 과 **같은 값** | 서버 전용 — `NEXT_PUBLIC_` 접두사 금지. `MUTATION_API_TOKEN` 이름으로 넣어도 동작한다 |
| `NEXT_PUBLIC_DEMO_READ_ONLY` | 백엔드 `DEMO_READ_ONLY` 와 같은 값 | 다르면 버튼은 열려 있는데 서버가 403 |
| `DATA_GO_KR_API_KEY` | 기상청 단기예보 키 | 위젯 '오늘의 추천' 날씨 줄. 없으면 날씨만 조용히 빠진다 |
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | Kakao JS 키 | 위젯 지도. 없으면 좌표 기반 대체 지도 |

**값을 바꾸면 반드시 Redeploy** 한다 — `NEXT_PUBLIC_*` 는 빌드 시 인라인되므로 재배포 없이는 옛 값이 계속 쓰인다.

> **mock 폴백은 제거됐다.** 예전에는 `NEXT_PUBLIC_API_BASE` 가 비면 `frontend/src/mocks/` 로 조용히
> 폴백해, 환경변수를 빠뜨린 배포가 **가짜 데이터를 진짜처럼 보여줬다**(2026-08-11 실제 발생 —
> 배포본 `/tracking` 의 날짜 20개 중 13개가 실 API 와 달랐다). 지금은 빌드 단계에서 실패한다.

---

## 3. 비용 (서울 리전, 월 기준)

계정이 조직(`o-atbedhir51`) 소속이라 상시 무료 티어를 조직 전체가 공유한다. **프리티어를 가정하지 않는다.**

| 항목 | 단가 | 월 |
|---|---|---|
| 내부 ALB 고정비 | $0.0225 / ALB-시간 | **$16.43** |
| ALB LCU | $0.008 / LCU-시간, 데모 <0.1 LCU | ~$0.6 |
| Fargate ARM Spot ×2 (0.25 vCPU / 0.5 GB) | $0.011175 / $0.001227 | **$4.98** |
| 퍼블릭 IPv4 ×2 | $0.005 / IP-시간 | **$7.30** |
| CloudWatch Logs(7일 보존) · ECR · API GW · DynamoDB | | ~$1 |
| VPC Link · DynamoDB Gateway Endpoint · SSM 표준 파라미터 | 무과금 | $0 |
| **합계** | | **≈ $30** |
| 온디맨드 base 1 혼합 시 | | ≈ $36 |
| **예산 상한 (ARM 온디맨드 ×2)** | | **≈ $42** |

- **ALB 고정비가 전체의 절반 이상**이고 리전 간 가격차가 0이다
- Spot 단가는 AWS 가 수급에 따라 조정한다 — **예산 상한은 온디맨드 기준으로 잡는다**
- Vercel Hobby $0 / LLM 은 사용량 과금(gpt-4o-mini, 데모 수준에서 월 $1 미만)

**"사실상 $0" 서사는 성립하지 않는다.** 새 서사는 **"월 $30 수준, 대가는 콜드스타트 없는 상시 가용"** 이다.

---

## 4. 무중단 배포

`minimumHealthyPercent=100` / `maximumPercent=200`. desiredCount 2 → 배포 시 새 태스크 2개를 먼저 띄우고,
**ALB 대상그룹 헬스체크를 통과한 뒤에야** 구 태스크를 등록 해제한다. 해제 후에는 드레이닝 시간 동안
처리 중이던 요청을 마저 흘려보낸다.

대상그룹이 보는 경로는 `/api/health` 가 아니라 **`/api/health/ready`** 다. `/api/health` 는 계약상
결손 시에도 200이라(05 §5) 정적 JSON 이 빠진 이미지를 healthy 로 통과시킨다.

### 종료 타이밍 예산

| 설정 | 값 | 이유 |
|---|---|---|
| `deregistration_delay.timeout_seconds` | 30 | 기본 300초는 롤링 배포를 태스크당 5분씩 늘린다 |
| `stopTimeout` | 60 | 기본 30초는 최악 24.5초 LLM 요청과 겹치면 빠듯하다 |
| uvicorn `--timeout-graceful-shutdown` | 30 | 합계 최대 90초 < Fargate 한도 120초 |
| `healthCheckGracePeriodSeconds` | 120 | 0.25 vCPU 는 버스트가 없어 기동이 느리다 |
| ALB `idle_timeout` | 65 | API Gateway 통합 타임아웃 30초보다 크게 |
| uvicorn `--timeout-keep-alive` | 75 | ALB idle 보다 길게 (역전 시 간헐 502) |

### 서킷 브레이커의 한계 — 반드시 기억할 것

1. **첫 배포에는 자동 롤백이 없다.** 되돌아갈 COMPLETED 배포가 없으면 롤백하지 못하고 배포가 정지한다
   → 첫 배포를 심사 훨씬 전에 성공시켜 롤백 기준점을 만들어 둔다(2026-08-11 완료).
2. **롤백을 CloudFormation 성공으로 오인할 수 있다.** 되돌린 뒤 steady state 에 도달하면 CFN 은
   `UPDATE_COMPLETE` 로 끝난다 → `deploy-service.sh` 가 `rolloutState == COMPLETED` 이면서
   태스크 정의 리비전이 방금 배포한 것과 일치하는지 대조하고, 불일치면 `exit 1` 한다.

### 실측 (2026-08-11, 2차 배포 = CORS 좁히기)

배포 전 구간을 0.5초 간격으로 폴링(`zero-downtime-check.sh`):

```
총 요청 507 · 실패 0 · 최대지연 469ms
```

### 용량 공급자

```
[{FARGATE, Base: ON_DEMAND_BASE_COUNT, Weight: 0}, {FARGATE_SPOT, Weight: 1}]
```

**Fargate 는 Spot 용량이 부족해도 온디맨드로 자동 대체하지 않는다.** 전부 Spot 이면 최악의 경우
실행 태스크가 0이 된다. 개발 중에는 0(순수 Spot), **심사 기간에는 1** 로 둔다(§5.5).

---

## 4-1. 자동 배포 (CI)

`main` 머지가 배포 트리거다. PR 단계에서는 검증만 하고 배포하지 않는다.

```
PR 생성 ──▶ pr-checks.yml      pytest · cfn-lint · FE lint/build   (AWS 자격증명 불필요)
main 머지 ──▶ backend-deploy.yml  OIDC 인증 → ARM64 빌드 → ECR → service 스택 갱신 → 스모크
```

세 가지를 의도적으로 제한했다.

- **service 스택만 자동화한다.** CI 가 VPC·DynamoDB 를 건드릴 수 있으면 사고 규모가 달라진다.
  foundation 은 거의 바뀌지 않는 계층이라 수동(`deploy-foundation.sh`)으로 남겨도 손해가 없다
- **경로 필터를 건다.** `backend/**`·`data/processed/**`·`infra/**` 가 바뀐 머지에만 반응한다
- **장기 키를 저장소에 두지 않는다.** GitHub OIDC 로 역할 `sangseng-github-deploy` 를 맡고,
  신뢰 정책이 `main` 브랜치로 제한한다. 실제 시크릿은 SSM 에 있어 CI 가 알 필요조차 없다

> **OIDC subject 형식 주의.** 이 저장소는 GitHub 이 **불변 subject**
> (`repo:<owner>@<ownerId>/<repo>@<repoId>:ref:...`)를 발급한다. 고전 형식만 신뢰 정책에 걸면
> `Not authorized to perform sts:AssumeRoleWithWebIdentity` 로 거부되는데 원인이 로그에 드러나지 않는다.
> `bootstrap-github-oidc.sh` 가 `gh api repos/<repo>/actions/oidc/customization/sub` 로 형식을 조회해
> **두 형식을 모두** 허용한다(와일드카드가 아니라 정확한 문자열 2개라 main 제한은 유지).

로컬 `deploy.sh` 와 CI 는 **같은 스크립트**를 쓴다. 차이는 값의 출처뿐이다 — 로컬은 `.env`,
CI 는 GitHub 저장소 변수이며 `load_env` 가 환경변수를 우선한다. `MUTATION_API_TOKEN` 은 저장소 변수로
넘기지 않는다(정본은 SSM) — `preflight.sh` 가 환경에 없으면 SSM 선존재로 대체 확인한다.

**저장소 변수**: `AWS_DEPLOY_ROLE_ARN` · `DEMO_READ_ONLY` · `ALLOWED_ORIGINS` · `OPENAI_MODEL` ·
`DESIRED_COUNT` · `ON_DEMAND_BASE_COUNT` · `NEXT_PUBLIC_API_BASE`(FE 빌드용).

---

## 5. 마무리 조이기 (배포 URL 확정 후)

1. **`ALLOWED_ORIGINS` 좁히기** — `.env` 에 확정된 Vercel 도메인을 넣고 `deploy.sh` 재실행.
   배포 기본값은 빈 목록이다(미설정 CORS 가 localhost 허용으로 새지 않게).
2. **`DEMO_READ_ONLY` / `MUTATION_API_TOKEN` 짝** — `DEMO_READ_ONLY=false` 인데 토큰이 비면 변경 API 가
   전부 503 이다. `preflight.sh` 가 배포 전에 막는다. 토큰은 `openssl rand -hex 32`
   (`secrets.compare_digest` 가 ASCII 만 받는다).
3. **토큰 교체 절차 — 순서를 지킬 것**

   ```
   ① ./infra/scripts/put-secrets.sh          (SSM 값 갱신)
   ② aws ecs update-service --cluster sangseng-cluster --service sangseng-api \
        --force-new-deployment --profile sangseng --region ap-northeast-2
   ③ Vercel 환경변수 API_MUTATION_TOKEN 갱신 → Redeploy
   ```

   **②를 빠뜨리면 반영되지 않는다** — ECS `secrets` 는 컨테이너 기동 시 1회만 주입되므로 SSM 값을
   바꿔도 도는 태스크는 옛 토큰을 계속 쓴다. ②와 ③ 사이에는 FE·BE 토큰이 어긋나 변경 API 가
   401 이 되는 짧은 구간이 있다 — **데모 중에는 하지 않는다.**

---

## 5.5 심사 기간 운영 (제출 ~ 심사 종료, 상세: 12 문서 §5)

- **`ON_DEMAND_BASE_COUNT=1` 로 전환** — Spot 부족으로 배포가 완료되지 않는 사고를 막는다
  (`.env` 와 GitHub 저장소 변수 양쪽)
- **데모 시드 리셋**:
  ```bash
  cd backend && CARDS_TABLE=sangseng-cards PROGRESS_RECORDS_TABLE=sangseng-progress-records \
    AWS_PROFILE=sangseng AWS_DEFAULT_REGION=ap-northeast-2 python seed_demo.py --reset
  ```
  카드 5장 + 추진 기록 9건이 들어간다
- **VPC Link 는 60일 무트래픽 시 INACTIVE** 가 된다. 방치 후 시연하면 첫 요청이 수 분간 실패하므로
  주기적으로 `/api/health` 를 한 번씩 친다
- **Vercel Password Protection 은 꺼 둔다** — 켜져 있으면 심사위원이 로그인 벽을 만난다
- 상시 가동이라 **콜드스타트 안내 문구는 쓰지 않는다**(사실과 다르다)

---

## 6. 철거 (종료 후)

```bash
./infra/scripts/teardown.sh    # ⚠ 심사·전시 종료 전에는 실행 금지
# Vercel: 대시보드에서 프로젝트 Delete (또는 그냥 둬도 $0)
```

service → foundation 역순으로 지운다. VPC Link 삭제와 ENI 정리가 느려 서브넷·SG 삭제가 실패할 수
있으므로 스크립트가 최대 3회 재시도한다. **DynamoDB 테이블 2개는 `Retain` 이라 남는다** — 정말 지우려면
`aws dynamodb delete-table` 을 직접 실행한다.

---

## 7. 실 배포 수준 아키텍처 (승격 경로 — 문서 전용)

지금 구성은 데모·심사 규모에 맞춘 것이다. 실 운영으로 올린다면:

```
                     Route 53 + ACM + WAF
                            │
        ┌───────────────────▼──────────────── VPC ────────────────┐
        │ public-a / public-c    인터넷 ALB (443, ACM) · NAT GW ×2 │
        │ private-app-a / -c     ECS Fargate (assignPublicIp 없음) │
        │ private-data-a / -c    RDS·ElastiCache 등 확장 여지       │
        └──────────────────────────────────────────────────────────┘
```

| 항목 | 지금 | 승격 시 무엇을 바꾸나 |
|---|---|---|
| 진입 | API Gateway + VPC Link | Route 53 + ACM 인증서 + 인터넷 ALB, WAF 부착 |
| 태스크 위치 | public 서브넷 + public IP | private 서브넷 + NAT. **NAT 비용을 줄이려면** ECR(`ecr.api`·`ecr.dkr`) + **S3 게이트웨이(이미지 레이어용, 필수)** + CloudWatch Logs + SSM 인터페이스 엔드포인트를 두면 NAT 를 타는 건 OpenAI egress 뿐이다 |
| 배포 | ECS 롤링 + 서킷 브레이커 | CodeDeploy Blue/Green + 카나리(10% 5분) — 즉시 롤백이 생기는 대신 ECS 서비스가 CFN 관리에서 벗어난다 |
| 확장 | 고정 2태스크 | Application Auto Scaling (ALB `RequestCountPerTarget` 타깃 추적) |
| 관측 | CloudWatch Logs 7일 | Container Insights · X-Ray · ALB 액세스 로그 → S3 |
| 시크릿 | SSM SecureString | Secrets Manager + 자동 로테이션 |
| 데이터 | DynamoDB On-Demand | PITR 활성화, 백업 정책 |
| 배포 자격증명 | GitHub OIDC(구축 완료) + 로컬 액세스 키 | **로컬 `sangseng-deployer` 액세스 키 폐기** — CI 가 배포를 담당하므로 로컬 키는 비상용으로만 |

**돌려보지 않은 CloudFormation 을 검증된 코드와 섞지 않는다** — 위 항목은 문서로만 남긴다.

---

## 8. 알려진 리스크

- **boto3 resource 스레드 안전성** — `db.py`·`progress_db.py` 가 모듈 전역 boto3 resource 를 두고
  동기 라우트를 anyio 기본 40 스레드가 공유한다. boto3 는 resource 의 thread-safety 를 보장하지 않는다.
  Lambda 구성에서도 동일한 코드였고 데모 트래픽은 동시성이 낮으며, API Gateway 스테이지 스로틀링
  (rate 10 / burst 20)이 실질 상한이 되어 심사 기간에는 노출되지 않는다. 실 운영 승격 시 client 기반으로 전환한다.
- **LLM 남용 방어** — Lambda `ReservedConcurrentExecutions=5` 를 대체하는 것이 위 스테이지 스로틀링이다.
  라우트가 전부 동기 `def` 라 태스크 2대 × 40 스레드 = 최대 80 동시 generate 가 가능한데, 게이트웨이에서 막는다.
- **퍼블릭 IPv4 과금** — 태스크마다 IP 하나씩 월 $7.3. 태스크 수를 늘리면 선형 증가한다.

---

## 트러블슈팅

| 증상 | 원인 / 조치 |
|---|---|
| `exec format error`, 태스크 무한 재시작 | 이미지 아키텍처 불일치. `config.sh` 의 `DOCKER_PLATFORM` 과 `service.yaml` 의 `CpuArchitecture` 확인 |
| `ResourceInitializationError` (로그 없음) | 태스크 실행 역할의 `ssm:GetParameters` 누락 또는 SSM 파라미터 부재. `put-secrets.sh` 재실행 |
| API Gateway 504 | VPC Link SG → ALB SG 인바운드 누락 |
| `data_loaded: false` | `build-and-push.sh` 의 데이터 복사 단계 누락. 스크립트로만 배포할 것 |
| 배포가 완료되지 않음 (서비스는 정상) | Fargate Spot 용량 부족. `ON_DEMAND_BASE_COUNT=1` 후 재배포 |
| 롤백됐는데 CFN 은 성공 | `deploy-service.sh` 가 리비전 대조로 잡아 exit 1 한다. 진단 덤프 확인 |
| 화면은 뜨는데 담당자 리포트만 "권한 필요" | Vercel 토큰 값이 SSM 과 다르다. §5 의 교체 절차 ②를 빠뜨렸는지 먼저 본다 |
| FE 빌드 실패 `NEXT_PUBLIC_API_BASE가 비어 있습니다` | 의도된 가드다. Vercel 환경변수에 ApiUrl 을 넣고 Redeploy |
| 오래 방치 후 첫 요청 실패 | VPC Link 는 60일 무트래픽 시 INACTIVE. 재개에 수 분 |
