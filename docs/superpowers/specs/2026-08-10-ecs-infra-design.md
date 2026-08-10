# infra 전면 재설계 — SAM/Lambda → ECS Fargate 무중단 배포 (설계 스펙)

작성 2026-08-10 · 상태: 설계 확정, 구현 전

**Goal:** 백엔드 배포를 SAM(Lambda + Mangum)에서 **ECS Fargate**로 전면 이전해 배포 중 무중단을 확보한다.
프론트는 Vercel을 유지한다. 비용 최소화를 위해 **NAT Gateway를 쓰지 않고**, 동시에 public/private 서브넷을
갖춘 실 배포 수준 아키텍처를 설계·문서화한다.

**전제:** SAM 스택은 **한 번도 실배포된 적이 없다**(docs/review/FINAL-REVIEW-20260809.md, 09 §4).
이관할 DynamoDB 데이터도, 삭제할 실 리소스도 없다 — 마이그레이션이 아니라 **신규 구축**이다.
착수 전 `aws cloudformation describe-stacks --stack-name sangseng-backend`로 1회만 확인한다.

---

## 0. 확정된 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 리전 | **ap-northeast-2 (서울)** | 리전 간 총비용차 5.4%뿐. 지연이 결정적 (§3-2) |
| 진입점 | API Gateway HTTP API → VPC Link → **내부 ALB** → ECS | 도메인 없이 무료 TLS, URL 형태가 현행과 동일 |
| 컴퓨트 | Fargate **ARM64** Spot, 0.25 vCPU / 0.5 GB, 2태스크<br>(`OnDemandBaseCount` 파라미터: 개발 0 / 심사 1) | 서울 Spot 할인 70%, Apple Silicon 네이티브 빌드 |
| 무중단 | ECS 롤링 100%/200% + deployment circuit breaker | ALB 대상그룹 드레이닝이 진행 중 요청을 보호 |
| 네트워크 | public ×2 (태스크) + **private ×2 (ALB·VPC Link, NAT 없음)** | NAT $43/월 회피 + 공식 튜토리얼과 동일 구성 |
| IaC | 순수 CloudFormation 2스택 + bash 스크립트 | 기존 CFN 계열 유지, 신규 툴체인 0 |
| 시크릿 | SSM Parameter Store SecureString | 표준 파라미터 무료, CFN에 값이 남지 않음 |
| 이미지 빌드 | 로컬은 맥북 ARM64 네이티브, CI 는 GitHub ARM64 러너 | 둘 다 네이티브 — 에뮬레이션 없음 |
| 배포 트리거 | **`main` 머지 → GitHub Actions 자동 배포**(OIDC). PR 은 검증만 | 프론트 Vercel 연동과 같은 흐름. 저장소에 AWS 장기 키 없음 (§5-1) |
| LLM provider | **OpenAI 단일** (Anthropic 제거) | 미사용 (§8) |
| 월 비용 | 약 **$30** (상한 $42) | §7 |

### 기각한 대안

- **CloudFront → 인터넷 ALB**: 엣지→ALB 구간이 평문이라 Bearer 토큰 노출 문제를 옮길 뿐이고, ALB를 인터넷에 노출해야 한다.
- **ALB 제거 + API Gateway → Cloud Map 직결**: 월 $22를 아끼지만 연결 드레이닝이 없어 배포 순간 진행 중 요청이 끊긴다. 무중단이 이 작업의 목적이므로 채택하지 않는다. (비용 압박이 커지면 유일하게 의미 있는 지렛대이므로 문서에 남긴다)
- **CodeDeploy Blue/Green**: 즉시 롤백·카나리가 가능하나 ECS 서비스가 CFN 관리에서 벗어나 배포 스크립트가 복잡해진다. §14 실 배포 아키텍처에 승격 경로로 기술한다.
- **백엔드를 us-east-1로 이전**: Vercel 함수 리전을 서울로 옮기면 불필요해진다 (§3-2).

---

## 1. 아키텍처 — 실제로 배포할 구성

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

**AZ는 `ap-northeast-2a` / `ap-northeast-2c`로 명시 고정한다.**
`!Select [n, !GetAZs '']`에 의존하지 않는다 — **`ap-northeast-2d`(apne2-az4)는 VPC Link V2를 지원하지 않는다.**
VPC Link는 immutable이라 잘못 만들면 삭제 후 재생성만이 복구 경로다.

**NAT가 필요 없는 이유.** 인터넷 egress가 필요한 것은 ECS 태스크뿐이다(OpenAI 호출, ECR 이미지 pull).
태스크를 public 서브넷에 두고 public IP를 붙이면 IGW로 직접 나간다. 내부 ALB와 VPC Link ENI는 VPC 안에서만
통신하므로 인터넷이 필요 없고, **NAT 없는 private 서브넷은 라우트 테이블에 local만 두면 되어 비용이 0이다.**
서울 NAT Gateway는 시간당 $0.059 = 월 $43.07이고 퍼블릭 IPv4 2개는 월 $7.30이므로, 이 규모에서 public 직결이 5.9배 저렴하다.

**public 서브넷에 태스크를 두는 대가**는 인바운드 차단이 전적으로 보안그룹에 달린다는 것이다.
태스크 SG는 ALB SG를 출처로 하는 8000 포트만 허용한다. 0.0.0.0/0 인바운드는 어떤 포트에도 열지 않는다.

### 스택 구성

**`sangseng-foundation`** — 수명이 길고 자주 바뀌지 않는 것

VPC · IGW · 서브넷 4개 · 라우트 테이블 2개 · DynamoDB Gateway Endpoint · ECR 리포지토리(라이프사이클 정책)
· DynamoDB 테이블 2개 · IAM 역할 2개(태스크 실행 / 태스크) · CloudWatch 로그 그룹

**`sangseng-service`** — 배포마다 갱신되는 것

보안그룹 3개(vpclink/alb/task) · 내부 ALB + 리스너 + 대상그룹 · ECS 클러스터 · 태스크 정의 · ECS 서비스
· HTTP API + VPC Link + Integration + Route + Stage

**스택 이름은 반드시 `sangseng-`으로 시작해야 한다.** 배포 사용자의 인라인 IAM 정책이 역할 생성을
`arn:aws:iam::325899476013:role/sangseng-*`로 제한하고, CFN 자동 생성 역할 이름이 `<스택명>-<논리ID>-<난수>`
형태이기 때문이다. 스택 이름을 바꾸면 역할 생성이 AccessDenied로 실패한다.

**분리 이유.** ① 코드만 바뀌면 service 스택만 갱신하면 되어 배포가 5분으로 끝난다. ② ECR 리포지토리가
먼저 존재해야 첫 이미지를 밀 수 있는데 ECS 서비스는 그 이미지가 있어야 뜬다 — 이 순환이 스택 경계로 풀린다.
③ DynamoDB 테이블에 `DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain`을 걸어 service 스택을
몇 번을 갈아엎어도 승인된 카드 데이터가 남는다.

**DynamoDB 테이블 이름은 `sangseng-cards` / `sangseng-progress-records`로 고정한다.**
seed_demo·local_init·docker-compose 기본값과 일치시켜 원격 시드/리셋 명령을 문서에 고정할 수 있다.

---

## 2. 무중단 배포 메커니즘

`minimumHealthyPercent=100` / `maximumPercent=200`. desiredCount 2 → 배포 시 새 태스크 2개를 먼저 띄우고,
**ALB 대상그룹 헬스체크를 통과한 뒤에야** 구 태스크를 등록 해제한다. 등록 해제 후에는 드레이닝 시간 동안
처리 중이던 요청을 마저 흘려보낸다.

### 종료 타이밍 예산

Fargate 컨테이너의 `stopTimeout`은 최대 120초이고, Spot 회수 통지는 2분 전에 온다. 그 안에 드레이닝이 끝나야 한다.

| 설정 | 값 | 이유 |
|---|---|---|
| `deregistration_delay.timeout_seconds` | **30** | 기본값 300초는 롤링 배포를 태스크당 5분씩 늘린다 |
| `stopTimeout` | **60** | 기본 30초는 최악 24.5초 LLM 요청과 겹치면 빠듯하다 |
| uvicorn `--timeout-graceful-shutdown` | **30** | 합계 최대 90초 < 120초 한도 |
| `healthCheckGracePeriodSeconds` | **120** | 0.25 vCPU는 버스트가 없어 3~5배 느리다. ENI 프로비저닝 + ECR pull + 타깃 등록 + 헬스체크 2연속 통과가 더해진다 |
| ALB `idle_timeout` | **65** | API Gateway 통합 타임아웃 30초보다 크게 |
| uvicorn `--timeout-keep-alive` | **75** | 기본 5초가 ALB idle 65초보다 짧으면 간헐 502가 날 수 있다 |

### 용량 공급자 전략

```
[{FARGATE, Base: 1, Weight: 0}, {FARGATE_SPOT, Weight: 1}]
```

**Fargate는 Spot 용량이 부족해도 온디맨드로 자동 대체하지 않는다.** 전부 Spot으로 두면 최악의 경우
실행 태스크가 0이 된다. `OnDemandBaseCount` 파라미터로 노출해 개발 중에는 0(순수 Spot), 심사 기간에는 1로 둔다.

### 서킷 브레이커의 한계 — 반드시 문서에 남길 것

1. **첫 배포에는 자동 롤백이 없다.** 되돌아갈 COMPLETED 배포가 없으면 서킷 브레이커가 롤백하지 못하고
   배포가 정지한다. → **첫 배포를 심사 훨씬 전에 성공시켜 롤백 기준점을 만들어 둔다.**
2. **롤백을 CloudFormation 성공으로 오인할 수 있다.** 서킷 브레이커가 되돌린 뒤 서비스가 steady state에
   도달하면 CFN은 `UPDATE_COMPLETE`로 끝난다. → 배포 스크립트가 `describe-services`로
   **`deployments[0].rolloutState == COMPLETED` 이면서 taskDefinition 리비전이 방금 배포한 것과 일치하는지**
   검증하고, 불일치면 `exit 1` 한다.

---

## 3. 두 가지 큰 정정

### 3-1. 30초 제한은 사라지지 않는다

**API Gateway HTTP API의 통합 타임아웃은 30초이며 증액이 불가능하다.** 제약이 Lambda에서 게이트웨이로
옮겨갔을 뿐이다. 따라서 `llm.py`의 최악 24.5초 예산(LLM_TIMEOUT 12초 × attempts 2 + backoff 0.5초)은
**숫자를 그대로 유지**하고 근거만 재앵커링한다. 예산을 늘리면 generate가 504로 잘려 규칙 기반 폴백에도
도달하지 못한다.

지금 **FE 30초 · API GW 30초 · 앱 24.5초** 세 경계가 겹쳐 있다. → **프론트 POST 타임아웃을 35초로 올려**
게이트웨이가 먼저 끊게 한다([api.ts:105](../../../frontend/src/lib/api.ts#L105)).

### 3-2. Vercel 함수 리전이 진짜 병목이었다

레포에 `vercel.json`이 없어 Vercel 함수가 기본값 **iad1(버지니아)**에서 돌고 백엔드는 서울이다.
한국 사용자 요청이 태평양을 건너고, SSR 안의 API 호출이 **다시 태평양을 왕복**한다.

Hobby 플랜도 단일 리전 선택이 가능하다(공식 문서 "Hobby plans can select any single region").

| 조합 | SSR TTFB (백엔드 2회 호출 가정) |
|---|---|
| 현재 — Vercel iad1 + 백엔드 서울 | 550~800 ms |
| Vercel iad1 + 백엔드 us-east-1 | 230~300 ms |
| **Vercel icn1 + 백엔드 서울** | **60~120 ms** |

→ `frontend/vercel.json`에 `{"regions": ["icn1"]}`. 리전 간 RTT 182ms가 사라진다.
**적용 후 응답 헤더 `x-vercel-id`로 실측 확인이 필요하다** — Hobby에서 리전 설정이 무시됐다는 과거 제보가 있다.

---

## 4. `infra/` 파일 구조

```
infra/
  README.md                    배포 전 체크 → 실행 → 검증
  config.sh                    리전·스택명·프로필·아키텍처 단일 정의 (모든 스크립트가 source)
  cloudformation/
    foundation.yaml
    service.yaml
  scripts/
    lib/common.sh              로깅·에러 트랩·CFN 대기·진단 덤프
    preflight.sh               자격증명·권한·.env·데이터 5종·Docker·아키텍처 대조
    put-secrets.sh             .env → SSM SecureString
    deploy-foundation.sh
    build-and-push.sh          ARM64 네이티브 빌드 → ECR (태그 = git short SHA)
    deploy-service.sh          service 스택 갱신 + 롤아웃 검증
    smoke-test.sh              /api/health datasets 5종 + Authorization 왕복
    zero-downtime-check.sh     배포 중 0.5초 폴링 → 실패율·최대지연 리포트
    rollback.sh                직전 태스크 정의 리비전으로 즉시 복귀
    teardown.sh                역순 철거 (ENI 정리 재시도 포함)
    deploy.sh                  전체 오케스트레이션
```

**아키텍처는 `config.sh` 한 곳에서만 정의**하고, `preflight.sh`가 CloudFormation의 `RuntimePlatform`과
빌드 대상 플랫폼을 대조한다. 불일치는 `exec format error`로 100% 첫 배포 실패이고, 첫 배포에는 자동 복구가 없다.

삭제: `infra/template.yaml`, `infra/deploy-backend.sh`, `infra/.aws-sam/`(56MB).
`.gitignore`의 `# aws sam` 섹션도 함께 제거한다.

---

## 5. 배포 흐름

`./infra/scripts/deploy.sh`:

1. **preflight** — `sts get-caller-identity`(프로필 `sangseng`), Docker 데몬, `data/processed` 5종 존재·JSON 파싱,
   아키텍처 대조, 기존 SAM 스택 부재 확인
2. **가드** — 현행 `deploy-backend.sh:23-34`의 `DEMO_READ_ONLY` / `MUTATION_API_TOKEN` 짝 검사를 **그대로 계승**.
   `DEMO_READ_ONLY`는 앱 기본값이 false라 태스크 정의에 **항상 명시**하고, 미설정 시 배포를 중단한다
   (빠뜨리면 공개 데모가 쓰기 가능 상태로 뜬다)
3. **시크릿** — `.env` → SSM. 배포 전 `get-parameters-by-path /sangseng`로 선존재 검증
   (없으면 태스크가 `ParameterNotFound`로 조용히 죽는다)
4. **foundation 배포** — 변경 없으면 수 초
5. **데이터 준비 + 이미지 빌드** — `rm -rf backend/app/data && cp -r data/processed backend/app/data` 후
   ARM64 빌드. **`rm` 없이 `cp`만 하면 옛 산출물이 이미지에 구워진다.** 태그는 git short SHA(불변)
6. **service 배포** — CFN 갱신 → `rolloutState` + 리비전 일치 검증(§2)
7. **스모크 테스트** — API Gateway URL로 `/api/health`(datasets 5종 true) · `/api/health/ready`(200) ·
   **`/api/progress-report`로 Authorization 헤더 전달 검증**(담당자 전용 GET이라 상태를 바꾸지 않는다 —
   변경 API로 확인하면 데모 시드가 오염된다)
8. **Outputs** — Vercel에 넣을 `ApiUrl`. **끝 슬래시 없이 복사하라고 명시**
   ([api.ts:69](../../../frontend/src/lib/api.ts#L69)가 `${BASE}${path}`로 조립해 `//api/...`는 404가 된다)

무중단은 주장이 아니라 측정으로 남긴다. `zero-downtime-check.sh`가 배포 전 구간을 0.5초 간격으로 폴링해
총 요청 수 / 실패 수 / 최대 지연을 출력한다. 심사 Q&A 자료로 쓴다.

### 소요 시간

| | 소요 | 병목 |
|---|---|---|
| foundation 최초 | 3~5분 | |
| 이미지 빌드 + 푸시 (최초) | 2~4분 | |
| service 최초 | 12~18분 | **VPC Link 생성 최대 10분** |
| **첫 배포 합계** | **20~30분** | |
| 이후 재배포 | **4~6분** | |
| 철거 | 10~15분 | VPC Link 삭제 + ENI 정리 |

---

## 5-1. 자동 배포 (CI)

`main` 머지가 배포 트리거다. PR 단계에서는 pytest·cfn-lint·프론트 빌드만 돌리고 배포하지 않는다.
프론트는 Vercel git 연동이 이미 같은 흐름으로 동작하므로 백엔드만 추가하면 양쪽이 맞는다.

```
PR 생성 ──▶ pr-checks.yml     pytest · cfn-lint · FE lint/build   (AWS 자격증명 불필요)
main 머지 ──▶ backend-deploy.yml  OIDC 인증 → ARM64 빌드 → ECR → service 스택 갱신 → 스모크
```

세 가지를 의도적으로 제한했다.

**service 스택만 자동화한다.** CI가 VPC·DynamoDB를 건드릴 수 있으면 사고 규모가 달라진다.
foundation은 거의 바뀌지 않는 계층이라 수동으로 남겨도 손해가 없다.

**경로 필터를 건다.** `backend/**`·`data/processed/**`·`infra/**`가 바뀐 머지에만 반응한다.
문서만 고친 머지로 컨테이너가 재배포되면 낭비이자 위험이다.

**장기 키를 저장소에 두지 않는다.** GitHub OIDC로 역할(`sangseng-github-deploy`)을 맡고,
신뢰 정책이 `main` 브랜치로 제한한다. 실제 시크릿은 SSM에 있어 CI가 알 필요조차 없다.
비민감 설정값(`DEMO_READ_ONLY`·`ALLOWED_ORIGINS` 등)만 GitHub 저장소 변수로 넘긴다.

레포가 public이라 Actions 실행 시간이 무제한이고 **ARM64 러너를 무료로 쓴다** — 이미지가 ARM64라
x86 러너였으면 QEMU 에뮬레이션이 필요했다.

로컬과 CI는 **같은 스크립트**를 쓴다. 차이는 값의 출처뿐이고(로컬 `.env` / CI 저장소 변수),
스크립트의 `load_env`가 환경변수를 우선한다. 스크립트가 갈라지면 "로컬은 되는데 CI는 안 되는"
문제가 반드시 생긴다.

> **승인 게이트를 한 단계 더 붙이려면**(머지 후 사람이 Actions에서 한 번 더 승인) deploy job에
> `environment: production`을 추가하고 **OIDC 신뢰 정책의 `sub`도 `repo:…:environment:production`으로
> 함께 바꿔야 한다.** environment를 쓰면 토큰 subject가 브랜치 형식에서 환경 형식으로 바뀌어,
> 한쪽만 고치면 인증이 깨진다.

---

## 6. 백엔드 변경

### 6-1. `backend/app/main.py`

| 줄 | 변경 |
|---|---|
| 6-8 | `AWS_LAMBDA_FUNCTION_NAME` 판별 → `APP_ENV != "production"`. 태스크 정의에 `APP_ENV=production` |
| 13, 85 | `from mangum import Mangum`, `handler = Mangum(app)` **삭제** |
| 18-23 | **가장 위험한 실질 결함.** ECS에는 `AWS_LAMBDA_FUNCTION_NAME`이 없어 항상 else로 떨어져, `ALLOWED_ORIGINS` 미설정 시 **배포 환경에서 로컬 오리진이 조용히 허용된다.** `APP_ENV` 기준으로 교체, 배포 기본값은 빈 목록. `'*'` 금지 가드는 유지 |
| 63-82 | **`/api/health`가 `data_loaded: false`에도 200을 반환한다.** 정적 JSON이 빠진 이미지가 healthy로 판정되면 서킷 브레이커가 롤백하지 않고 **고장난 버전을 무중단으로 전량 배포**한다 |

**헬스체크는 엔드포인트를 나눈다.** `/api/health`의 200-always 동작은 05 문서에 계약으로 적혀 있고
기존 스모크 테스트 2건이 그 동작을 검증한다. 계약을 깨는 대신 **`/api/health/ready`를 신설**해
`REQUIRED_DATASETS` 결손 시 503을 반환하게 하고, **ALB 대상그룹은 이 경로만 본다.**
`/api/health`는 사람이 진단할 때 쓰는 경로로 그대로 둔다(어느 산출물이 빠졌는지 `datasets`로 보여주는 게 목적이라
503으로 죽으면 오히려 진단이 막힌다). 기존 테스트는 깨지지 않고 신규 1건만 추가된다.

> ⚠ 13·85행을 남긴 채 `requirements.txt`의 mangum만 지우면 컨테이너가 import 단계에서 `ModuleNotFoundError`로
> 기동 실패한다. 반드시 함께 수정한다.

### 6-2. 의존성 · 이미지

- `requirements.txt`: `mangum` 삭제, **`uvicorn[standard]==0.52.1` 추가**(현재 Dockerfile이 버전 미고정으로
  설치해 비재현 이미지가 된다). `python-dotenv`는 **유지 필수** — main.py:8이 import한다
- `requirements-dev.txt`: uvicorn 줄 삭제. `pytest.ini`의 mangum 경고 필터 삭제
- `Dockerfile`: `ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1`(없으면 로그가 awslogs로 늦게 나가
  장애 분석이 막힌다), non-root 유저, `EXPOSE 8000`, CMD에 `--workers 1 --proxy-headers
  --timeout-graceful-shutdown 30 --timeout-keep-alive 75`. **멀티스테이지는 불필요** — 의존성이 대부분
  pure-python 휠이라 용량 이득이 작다
- **`backend/.dockerignore` 신규 — 선행 필수.** 레포에 `.dockerignore`가 전혀 없다.
  제외: `.venv/`, `tests/`, `.pytest_cache/`, `__pycache__/`, `*.pyc`, `local_init.py`, `requirements-dev.txt`.
  **보안상 최우선:** 빌드 컨텍스트에 루트 `.env`(LLM 키 포함)가 들어가면 이미지에 구워지고,
  main.py:8의 `load_dotenv`가 **그 키를 실제로 로드한다.** ECR 레이어는 지워도 남아 회수 수단이 키 로테이션뿐이다

**`--workers 1` 고정 근거(실측):** import 직후 RSS 74.5MB → 전체 데이터셋 로드 후 76.1MB →
OpenAI SDK import 후 116MB. 워커 2개 이상은 SDK 로드 후 250MB+로 0.5GB에서 OOMKilled 위험.
확장은 desiredCount로 한다. `import app.main` 0.285초, 데이터셋 콜드 파싱 0.002초로 기동 경로에 무거운 작업은 없다.

### 6-3. 데이터 경로 — 사고 방지

컨테이너에서 `dataload.CANDIDATE_DIRS[0]`은 `/data/processed`로 풀린다(존재하지 않음 → 두 번째 후보
`/app/app/data`로 폴백). **이미지·태스크 정의에서 `/data` 볼륨이나 디렉터리를 절대 만들지 않는다** —
만들면 stale 데이터가 이미지에 구운 `/app/app/data`를 조용히 가린다.
`.gitignore`의 `backend/app/data/` 무시 규칙은 그대로 필요하다.

### 6-4. 그 외

| 파일 | 변경 |
|---|---|
| `security.py:14` | `DEMO_READ_ONLY` 태스크 정의에 항상 명시 (앱 기본값 false ≠ 구 SAM 기본값 true) |
| `security.py:18` | ECS `secrets`는 **기동 시 1회만 주입**된다. SSM 값을 바꿔도 `--force-new-deployment` 없이는 반영되지 않는다. Vercel `API_MUTATION_TOKEN`과의 동시 갱신 순서를 절차로 못박는다 |
| `security.py:33` | `secrets.compare_digest`는 ASCII만 받는다 — 토큰은 `openssl rand -hex 32`로 제한 |
| `db.py`, `progress_db.py` | **이번 범위에서 변경하지 않는다.** 모듈 전역 boto3 resource를 동기 라우트 40 스레드가 공유하는데 boto3는 resource의 thread-safety를 보장하지 않는다. 다만 Lambda에서도 동일 코드였고 데모 트래픽은 동시성이 낮다. §6-5의 스로틀링(rate 10)이 실질 상한이 되므로 심사 기간에는 노출되지 않는다 — **알려진 리스크로 09 문서에 기록**하고, 실 운영 승격 시 client 기반으로 전환한다 |
| 태스크 정의 environment | **`OPENAI_MODEL` 추가 — 미해결 감사 지적 M2 해소.** 현재 배포본은 항상 코드 기본값을 쓴다 |
| `tests/test_algorithms.py:45` | docstring의 "Lambda 30초 예산" → "API Gateway 통합 타임아웃 30초 예산" |
| `tests/test_smoke.py:187-216` | health 503화로 2건이 깨진다 — 함께 갱신 |
| `seed_demo.py` | 코드 변경 불필요. 단 `DYNAMO_ENDPOINT`가 없으면 실 DynamoDB에 붙고 `--reset`이 전체 삭제한다 |

### 6-5. LLM 동시 호출 상한 재구축

Lambda `ReservedConcurrentExecutions=5`가 무인증 공개 URL의 generate 폭주를 막는 **유일한 인프라 방어**였다
(09 §5.5, 12 §5). ECS에는 대응물이 없고, 라우트가 전부 동기 `def`라 FastAPI가 anyio 기본 40 스레드 풀에서
병렬 처리한다 — **태스크 2대 × 40 = 최대 80개**의 generate가 동시에 OpenAI를 부를 수 있다.

→ API Gateway Stage `DefaultRouteSettings`(rate 10 / burst 20) + generate 라우트 개별 스로틀링으로 대체하고,
09·11·12 문서의 "호출 상한 3중" 서술을 맞춘다.

---

## 7. 비용 (서울, 프리티어 없음)

계정이 조직(`o-atbedhir51`) 소속이라 상시 무료 티어도 조직 전체가 공유한다. **프리티어를 가정하지 않는다.**

| 항목 | 단가 | 월 |
|---|---|---|
| 내부 ALB 고정비 | $0.0225 / ALB-시간 | **$16.43** |
| ALB LCU | $0.008 / LCU-시간, 데모 <0.1 LCU | ~$0.6 |
| Fargate ARM Spot ×2 (0.25 vCPU / 0.5 GB) | $0.011175 / $0.001227 | **$4.98** |
| **퍼블릭 IPv4 ×2** | $0.005 / IP-시간 | **$7.30** |
| CloudWatch Logs (7일 보존) · ECR · API GW · DynamoDB | | ~$1 |
| VPC Link · DynamoDB Gateway Endpoint · SSM 표준 | 무과금 | $0 |
| **합계** | | **≈ $30** |
| 온디맨드 base 1 혼합 시 | | ≈ $36 |
| **예산 상한 (ARM 온디맨드 ×2)** | | **≈ $42** |

- **ALB 고정비가 전체의 절반 이상**이고 리전 간 가격차가 0이다
- Spot 단가는 AWS가 수급에 따라 조정한다 — **예산 상한은 온디맨드 기준으로 잡는다**
- 서울 프리미엄의 59%가 CloudWatch Logs 한 항목(서울 $0.76/GB vs us-east-1 $0.50/GB)에서 나온다.
  보존 7일 유지 + 필요 시 Infrequent Access 클래스로 상쇄한다

**"사실상 $0 / 월 $1 미만" 서사는 성립하지 않는다.** 최소 7곳을 고쳐야 한다 —
README:103, `01-overview.md:74`(**성공 기준이라 그대로 두면 구조적으로 미달 판정**), `02:35-48`, `09 §3`,
`11:119`(Q&A 답변), `12`(리스크표), `22:184`(발표 슬라이드 고정 수치).
새 서사: **"월 $30 수준, 대가는 콜드스타트 없는 상시 가용."**

---

## 8. Anthropic 제거

`llm.py`에서 Anthropic은 폴백이 아니라 `LLM_PROVIDER`로 택일하는 병렬 provider라, 떼어내도 OpenAI 경로에
영향이 없다. `LLM_PROVIDER` 환경변수 자체를 없앤다(값이 하나뿐인 스위치는 설정 표면만 늘린다).

`llm.py:43-73`(분기 제거, ~25줄 감소) · `requirements.txt`(anthropic 삭제, 이미지 경량화) ·
`tests/test_algorithms.py:45-65`(두 provider 검증 → OpenAI만) · `.env.example:44-61` ·
`CLAUDE.md`(provider 분기 규칙 문구) · `docs/plan/04·07·09` · `docker-compose.yml`

---

## 9. 프론트 변경 (2건)

1. **`frontend/vercel.json` 신규** — `{"regions": ["icn1"]}` (§3-2)
2. **`api.ts:105`의 POST 타임아웃 30초 → 35초** (§3-1)

그리고 **사용자에게 보이는 콜드스타트 문구 2개가 사실과 달라진다.** ECS는 상시 가동이라 "서버가 깨어나는 중"이
거짓이 된다 — 심사위원에게 보이는 텍스트이므로 반드시 교체한다:
[PageSkeleton.tsx:118](../../../frontend/src/components/PageSkeleton.tsx#L118),
[error.tsx:61](../../../frontend/src/app/error.tsx#L61).
스켈레톤·loading·error 3종 구조 자체는 유지한다(FINAL-REVIEW가 가점 요소로 꼽았다).

---

## 10. 배포에서 깨질 지점과 대응

### 스크립트가 막는 것

| 실패 지점 | 증상 | 대응 |
|---|---|---|
| 아키텍처 불일치 | `exec format error` 무한 재시작. 서비스는 생성됐는데 태스크만 안 뜸 | `config.sh` 단일 정의 + preflight 대조 |
| ECR 빈 상태로 service 배포 | `CannotPullContainerError` → CFN 전체 롤백, 20분 낭비 | `deploy-service.sh` 진입부에서 이미지 존재 확인 |
| 태스크 실행 역할 SSM 권한 누락 | `ResourceInitializationError`. **로그에 안 남고 `stoppedReason`에만** | 역할에 `ssm:GetParameters` 포함(`AmazonECSTaskExecutionRolePolicy`에 없다), 실패 시 `stoppedReason` 자동 덤프 |
| SSM 파라미터 부재 | `ParameterNotFound`로 조용히 실패 | 배포 전 `get-parameters-by-path` 검증 |
| VPC Link ↔ ALB SG 인바운드 누락 | 게이트웨이는 200 라우트인데 504 | 두 SG를 짝으로 생성 |
| 보안그룹 순환 참조 | CFN 순환 의존으로 배포 거부 | 인그레스를 `AWS::EC2::SecurityGroupIngress` 별도 리소스로 분리 |
| `data/processed` 복사 누락 | `data_loaded: false` | preflight 5종 검증 + 스모크 테스트 |
| 서킷 브레이커 롤백을 성공으로 오인 | CFN은 UPDATE_COMPLETE인데 구버전이 돌고 있음 | rolloutState + 리비전 일치 검증 (§2) |
| ALB dereg delay 기본 300초 | 배포가 5분+ | 30초 명시 |

### 사람이 판단해야 하는 것

- **Fargate Spot 용량 부족** — 기존 태스크는 계속 돌아 서비스는 안 끊기지만 **배포가 완료되지 않는다.**
  심사 직전에 만나면 곤란하므로 `OnDemandBaseCount=1`로 전환
- **0.25 vCPU 적정성** — 첫 배포 후 실측하고 필요하면 0.5로 올린다(파라미터화)
- **`NEXT_PUBLIC_API_BASE`는 빌드 시점 인라인** — 값만 바꾸고 Redeploy 안 하면 옛 URL로 계속 간다
- **VPC Link는 60일 무트래픽 시 INACTIVE** — 방치 후 시연하면 첫 요청이 수 분간 실패한다. 주기적 헬스 핑 필요

---

## 11. 배포 후 실증해야 하는 항목 (P0)

문서로 확정할 수 없어 **실제 배포 직후 1회 확인이 필요한 것들**이다. `smoke-test.sh`에 포함한다.

1. **`$default` 스테이지에서 백엔드 경로에 스테이지 접두사가 붙지 않는가.** AWS 문서는 "프라이빗 통합은
   백엔드 요청 경로에 스테이지 부분을 포함시킨다"고 명시한다. `$default`면 접두사가 없는 것이 알려진 동작이나
   명문 확인은 못 했다. 붙으면 전 API가 FastAPI 404가 되고 — **ALB 헬스체크는 통과하는데 게이트웨이 경유만
   실패**하는 최악의 디버깅 난도가 된다
2. **API Gateway가 `Authorization: Bearer`를 백엔드까지 전달하는가.** 모든 변경 API의 유일한 경계다.
   **`/api/progress-report` GET 1회**로 확인한다(토큰이 필요하면서 상태를 바꾸지 않는 유일한 계열)
3. **DynamoDB Gateway Endpoint가 실제로 쓰이는가.** 태스크에 퍼블릭 IP가 있어서 **엔드포인트가 잘못
   연결돼도 DynamoDB 호출은 IGW 경유로 그냥 성공한다**(장애가 안 나서 더 위험).
   `describe-route-tables`로 `com.amazonaws.ap-northeast-2.dynamodb` prefix list 경로 주입을 확인해야
   "프라이빗 경로" 주장이 사실이 된다
4. **Vercel 함수가 실제로 icn1에서 도는가** — 응답 헤더 `x-vercel-id`

---

## 12. 문서 갱신 범위

조사 결과 **62개 파일**이 SAM/Lambda 전제에 묶여 있다.

**전면 재작성(5):** `docs/plan/09-deployment.md`(배포 정본), `02-architecture.md`, `07-backend-ai-tasks.md`,
`14-execution-plan.md`, `infra/` 전체

**갱신(주요):** `CLAUDE.md`(레포 구조·자주 쓰는 명령·provider 규칙), `README.md`, `.env.example`,
`.gitignore`, `docker-compose.yml`, `docs/plan/01·03·04·05·08·10·11·12·20·21·22·README`,
`frontend/README.md`, 프론트 콜드스타트 문구 3곳

**보존(감사 기록):** `docs/audit/`, `docs/review/`는 **작성 시점의 사실 기록**이므로 고치지 않는다.
09 문서에 "2026-08-10 ECS 이전으로 대체됨"을 명기해 참조자가 혼동하지 않게 한다.

---

## 13. 실 배포 수준 아키텍처 (문서 전용)

`docs/plan/09`의 독립 절로 작성한다. **템플릿으로 만들지 않는다** — 돌려보지 않은 CloudFormation을
검증된 코드와 섞으면 나중에 사고가 난다. 대신 각 항목에 "지금 구성에서 무엇을 바꾸면 되는지"를 붙인다.

```
                     Route 53 + ACM + WAF
                            │
        ┌───────────────────▼──────────────── VPC ────────────────┐
        │ public-a / public-c    인터넷 ALB (443, ACM) · NAT GW ×2 │
        │ private-app-a / -c     ECS Fargate (assignPublicIp 없음) │
        │ private-data-a / -c    RDS·ElastiCache 등 확장 여지       │
        └──────────────────────────────────────────────────────────┘
```

- **NAT 비용을 다시 줄이는 정공법**: ECR(`ecr.api`·`ecr.dkr`) + **S3 게이트웨이(이미지 레이어용, 필수)** +
  CloudWatch Logs + SSM 인터페이스 엔드포인트를 두면 NAT를 타는 건 OpenAI egress뿐이다
- CodeDeploy Blue/Green + 카나리(10% 5분), Application Auto Scaling(ALB `RequestCountPerTarget` 타깃 추적)
- Container Insights · X-Ray · ALB 액세스 로그 → S3
- Secrets Manager 자동 로테이션, DynamoDB PITR
- ~~GitHub Actions OIDC 무키 배포~~ → **이번 범위에 포함됐다** (§5-1, 계획 Task C2).
  남은 승격 항목은 **로컬 `sangseng-deployer` 액세스 키 폐기**다 — CI가 배포를 담당하면
  로컬 키는 비상용으로만 남는다
- 마지막에 **데모 구성 ↔ 실 배포 구성 대비표**(비용·가용성·보안 경계·복구 시간)와 승격 순서

---

## 14. 범위 밖 (비목표)

- 파이프라인(`pipeline/`)과 `data/` — 변경 없음
- 프론트 화면·컴포넌트 — §9의 3건(vercel.json, 타임아웃, 콜드스타트 문구) 외 손대지 않는다
- API 계약(`docs/plan/05`) — **`/api/health/ready` 1건 추가 외 변경 없음.** 기존 엔드포인트의 스키마·동작은
  그대로다. 계약 문서를 코드보다 먼저 고친다(CLAUDE.md 규칙)
- 인증·RBAC 도입 — 공유 Bearer 토큰 경계를 유지한다

---

## 15. 선행 완료 사항

- [x] **배포 권한 확보** — IAM 사용자 `sangseng-deployer` 생성, `PowerUserAccess` + `sangseng-*` 역할
      생성용 인라인 정책, 로컬 프로필 `sangseng`. 두 리전 9개 서비스 읽기 검증 완료
- [x] **조직 SCP 차단 없음 확인** — 모든 거부가 IAM 정책 부족이었고 두 리전이 동일
- [ ] GitHub Actions OIDC 배포 구축 (계획 Task C2) → 그 후 로컬 `sangseng-deployer` 액세스 키 폐기
