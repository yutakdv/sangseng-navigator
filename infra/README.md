# infra — 배포

백엔드는 **AWS ECS Fargate**, 프론트는 **Vercel**. 설계 근거는
[docs/plan/09-deployment.md](../docs/plan/09-deployment.md), 결정 이력은
[설계 스펙](../docs/superpowers/specs/2026-08-10-ecs-infra-design.md)에 있다.

## 최초 1회 준비

배포 전용 IAM 사용자 `sangseng-deployer`와 로컬 프로필 `sangseng`이 필요하다.
`PowerUserAccess` + `sangseng-*` 역할 생성용 인라인 정책을 붙인다.

```bash
aws sts get-caller-identity --profile sangseng   # 확인
```

## 배포

```bash
./infra/scripts/deploy.sh
```

`preflight → put-secrets → foundation → build&push → service → smoke-test` 순으로 돈다.
**첫 배포는 20~30분**(VPC Link 생성이 최대 10분), 이후 코드만 바뀐 재배포는 **4~6분**이다.

무중단을 측정하려면 배포와 동시에 별도 터미널에서:

```bash
./infra/scripts/zero-downtime-check.sh    # 배포가 끝나면 Ctrl-C
```

## 자동 배포 (CI)

`main`에 머지되면 `.github/workflows/backend-deploy.yml`이 백엔드를 배포한다.
PR 단계에서는 `pr-checks.yml`이 pytest·cfn-lint·프론트 빌드만 돌리고 배포하지 않는다.

- **인증:** GitHub OIDC → IAM 역할 `sangseng-github-deploy`. 저장소에 AWS 키가 없다.
  신뢰 정책이 `main` 브랜치로 제한돼 있다
- **범위:** service 스택만 갱신한다. foundation(VPC·DynamoDB)은 수동이다 —
  `./infra/scripts/deploy-foundation.sh`
- **경로 필터:** `backend/**`·`data/processed/**`·`infra/**`가 바뀐 경우에만 돈다.
  문서만 고친 머지로는 배포하지 않는다
- **수동 실행:** Actions 탭 → 백엔드 배포 → Run workflow

로컬 `./infra/scripts/deploy.sh`와 CI는 **같은 스크립트**를 쓴다. 차이는 값의 출처뿐이다 —
로컬은 `.env`, CI는 GitHub 저장소 변수이며, 스크립트의 `load_env`가 환경변수를 우선한다.
`MUTATION_API_TOKEN`은 저장소 변수로 넘기지 않는다(정본은 SSM) — `preflight.sh`가 환경에 없으면
SSM 선존재로 대체 확인하고, `smoke-test.sh`도 SSM 에서 직접 읽는다.

> 나중에 "머지 후 사람이 한 번 더 승인" 게이트를 붙이려면 deploy job 에
> `environment: production` 을 추가하고 **OIDC 신뢰 정책의 `sub` 를
> `repo:…:environment:production` 으로 함께 바꿔야 한다** — environment 를 쓰면
> 토큰의 subject 가 브랜치 형식에서 환경 형식으로 바뀌기 때문이다. 한쪽만 바꾸면 인증이 깨진다.

## 배포 후

1. `deploy-service.sh`가 출력한 `ApiUrl`을 Vercel 환경변수 `NEXT_PUBLIC_API_BASE`에
   **끝 슬래시 없이** 넣고 **Redeploy**한다(빌드 시 인라인되므로 재배포 필수).
2. Vercel 도메인이 확정되면 `.env`의 `ALLOWED_ORIGINS`에 넣고 `deploy.sh`를 다시 돌린다.
3. 데모 시드: `cd backend && CARDS_TABLE=sangseng-cards PROGRESS_RECORDS_TABLE=sangseng-progress-records AWS_PROFILE=sangseng AWS_DEFAULT_REGION=ap-northeast-2 python seed_demo.py --reset`

## 문제가 생기면

| 증상 | 원인 / 조치 |
|---|---|
| `exec format error`, 태스크 무한 재시작 | 이미지 아키텍처 불일치. `config.sh`의 `DOCKER_PLATFORM`과 `service.yaml`의 `CpuArchitecture` 확인 |
| `ResourceInitializationError` (로그 없음) | 태스크 실행 역할의 `ssm:GetParameters` 누락 또는 SSM 파라미터 부재. `put-secrets.sh` 재실행 |
| API Gateway 504 | VPC Link SG → ALB SG 인바운드 누락 |
| `data_loaded: false` | `build-and-push.sh`의 데이터 복사 단계 누락. 스크립트로만 배포할 것 |
| 배포가 완료되지 않음 (서비스는 정상) | Fargate Spot 용량 부족. `.env`에 `ON_DEMAND_BASE_COUNT=1` 후 재배포 |
| 롤백됐는데 CFN 은 성공 | `deploy-service.sh`가 리비전 대조로 잡아 exit 1 한다. 진단 덤프 확인 |
| 오래 방치 후 첫 요청 실패 | VPC Link 는 60일 무트래픽 시 INACTIVE 가 된다. 재개에 수 분 |

**첫 배포는 심사 훨씬 전에 성공시켜 둔다** — 서킷 브레이커가 자동 롤백하려면 되돌아갈
성공 배포가 하나는 있어야 하는데, 첫 배포에는 그것이 없다.

## 철거

```bash
./infra/scripts/teardown.sh    # ⚠ 심사·전시 종료 전에는 실행 금지
```
