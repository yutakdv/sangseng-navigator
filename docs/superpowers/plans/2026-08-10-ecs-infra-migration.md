# ECS Fargate 무중단 배포 인프라 이전 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 백엔드 배포를 SAM(Lambda + Mangum)에서 ECS Fargate로 전면 이전해 배포 중 무중단을 확보하고, NAT Gateway 없이 public/private 서브넷을 갖춘 구성으로 만든다.

**Architecture:** API Gateway HTTP API → VPC Link → 내부 ALB → ECS Fargate ARM64 Spot 2태스크. 태스크는 public 서브넷에서 public IP로 직접 egress(OpenAI·ECR)하고, ALB와 VPC Link는 NAT 없는 private 서브넷에 둔다. CloudFormation 2스택(`sangseng-foundation` / `sangseng-service`)과 bash 스크립트로 배포한다.

**Tech Stack:** CloudFormation(순수, SAM 미사용) · bash · Docker(ARM64) · FastAPI/uvicorn · pytest · Next.js 16(Vercel)

**설계 정본:** [docs/superpowers/specs/2026-08-10-ecs-infra-design.md](../specs/2026-08-10-ecs-infra-design.md) — 결정 근거·기각안·비용 산출은 전부 스펙에 있다. 이 계획은 실행 절차만 담는다.

---

## Global Constraints

- **리전 `ap-northeast-2` 고정.** AZ는 `ap-northeast-2a` / `ap-northeast-2c`로 **명시 지정**한다. `!GetAZs`에 의존 금지 — `ap-northeast-2d`(apne2-az4)는 VPC Link V2 미지원이고 VPC Link는 immutable이라 잘못 만들면 삭제·재생성만이 복구 경로다.
- **CloudFormation 스택 이름은 반드시 `sangseng-`으로 시작.** 배포 사용자 인라인 정책이 역할 생성을 `arn:aws:iam::325899476013:role/sangseng-*`로 제한한다.
- **AWS 프로필은 `sangseng`.** 모든 스크립트가 `config.sh`를 통해 이 프로필을 쓴다.
- **CPU 아키텍처는 ARM64 단일.** `infra/config.sh` 한 곳에서만 정의하고 `preflight.sh`가 CloudFormation `RuntimePlatform`과 대조한다. 불일치는 `exec format error`로 첫 배포 100% 실패이며 자동 롤백도 없다.
- **LLM 타임아웃 예산 24.5초는 숫자 그대로 유지.** 근거만 "Lambda Timeout 30초" → "API Gateway HTTP API 통합 타임아웃 30초(증액 불가)"로 재앵커링. **예산을 늘리면 generate가 504로 잘려 규칙 기반 폴백에도 도달하지 못한다.**
- **CLAUDE.md 절대 규칙 유지:** UI에 Gini·HHI 노출 금지 · "지역 전환율"에 `근사 지표` 배지 · 시뮬레이션 출력에 "가정 기반 전망" 문구 · AI는 제안만 · 원래 Score 순위 병기 · 처방은 하이원포인트 가맹점 확충 고정.
- **커밋:** `feat/*` 브랜치, Task 단위 커밋(`feat|fix|infra|docs: 요약`), main 직접 커밋 금지. **Claude 저자 표기 금지**(`Co-Authored-By` 트레일러·"Generated with Claude Code" 푸터 금지).
- **`docs/audit/`·`docs/review/`는 수정하지 않는다** — 작성 시점의 사실 기록이다.
- **신규 npm/pip 의존성 0.** `uvicorn[standard]`은 이미 `requirements-dev.txt`에 있던 것을 런타임으로 옮기는 것이다. CI 워크플로가 `cfn-lint`를 ad-hoc 설치하지만 **`requirements*.txt`에는 넣지 않는다** — CI 전용 도구는 프로젝트 의존성이 아니다.
- **스크립트는 `.env` 없이도 동작해야 한다.** 값은 환경변수를 먼저 보고 `.env`는 폴백이다 — GitHub Actions 러너에는 `.env`가 없고, 로컬과 CI가 **같은 스크립트**를 써야 "로컬은 되는데 CI는 안 되는" 문제가 안 생긴다.
- 백엔드 테스트: `cd backend && python -m pytest`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `infra/config.sh` | 리전·스택명·프로필·ECR·아키텍처 **단일 정의**. 모든 스크립트가 source |
| `infra/cloudformation/foundation.yaml` | VPC·서브넷·엔드포인트·ECR·DynamoDB·IAM·로그그룹 (수명 김) |
| `infra/cloudformation/service.yaml` | SG·ALB·ECS·API Gateway·VPC Link (배포마다 갱신) |
| `infra/scripts/lib/common.sh` | 로깅·에러 트랩·CFN 배포 래퍼·실패 시 진단 덤프 |
| `infra/scripts/preflight.sh` | 자격증명·Docker·데이터 5종·아키텍처 대조·가드 |
| `infra/scripts/put-secrets.sh` | `.env` → SSM SecureString |
| `infra/scripts/deploy-foundation.sh` | foundation 스택 배포 |
| `infra/scripts/build-and-push.sh` | 데이터 복사 → ARM64 빌드 → ECR push |
| `infra/scripts/deploy-service.sh` | service 스택 배포 + **롤아웃 진위 검증** |
| `infra/scripts/smoke-test.sh` | health·ready·Authorization 왕복 |
| `infra/scripts/zero-downtime-check.sh` | 배포 중 0.5초 폴링 리포트 |
| `infra/scripts/rollback.sh` | 직전 태스크 정의 리비전 복귀 |
| `infra/scripts/teardown.sh` | 역순 철거 |
| `infra/scripts/deploy.sh` | 전체 오케스트레이션 |
| `infra/README.md` | 배포 절차 |
| `backend/.dockerignore` | **신규 — 빌드 컨텍스트에서 `.env`·`.venv`·tests 배제 (보안)** |
| `.github/workflows/pr-checks.yml` | PR 검증 — pytest·cfn-lint·FE 빌드. **AWS 자격증명 불필요** |
| `.github/workflows/backend-deploy.yml` | `main` 머지 시 백엔드 자동 배포 (OIDC, 장기 키 없음) |
| `infra/scripts/bootstrap-github-oidc.sh` | 1회용 — OIDC 공급자 + 배포 역할 생성 |

**삭제:** `infra/template.yaml` · `infra/deploy-backend.sh` · `infra/.aws-sam/`(56MB)

---

# Phase A — 백엔드·프론트 코드 (AWS 없이 로컬에서 완결 검증)

### Task A1: Anthropic 제거

**Files:**
- Modify: `backend/app/llm.py:1,43-73`
- Modify: `backend/requirements.txt:7`
- Modify: `backend/tests/test_algorithms.py:91-119`
- Modify: `.env.example:44-61`
- Modify: `docker-compose.yml`
- Modify: `CLAUDE.md:64`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `llm.generate_json(system, user, schema, schema_name="result", timeout=None, attempts=2) -> dict` — 시그니처 불변. `LLM_PROVIDER` 환경변수는 더 이상 읽지 않는다. 모델은 `OPENAI_MODEL`(기본 `gpt-4o-mini`)만 본다.

- [ ] **Step 1: 기존 테스트를 OpenAI 단일로 고쳐 실패시킨다**

`backend/tests/test_algorithms.py`의 `test_llm_clients_disable_sdk_internal_retries`(91-119행)를 통째로 교체:

```python
def test_llm_clients_disable_sdk_internal_retries(monkeypatch):
    """llm.py의 지연 예산(timeout × attempts)은 SDK 내부 재시도가 꺼져 있어야 성립한다.

    openai SDK는 기본 max_retries=2로 타임아웃·429·5xx를 자체 재시도하므로, 막지 않으면
    앱 레벨 시도 1회가 timeout×3까지 늘어나 API Gateway HTTP API의 통합 타임아웃 30초
    (증액 불가) 예산을 넘고, 규칙 기반 폴백에 도달하기 전에 게이트웨이가 504로 끊는다.
    """
    import openai as openai_sdk

    from app import llm

    captured = {}

    def ctor(**kwargs):
        captured.update(kwargs)
        raise RuntimeError("네트워크 호출 전 중단")

    monkeypatch.setattr(openai_sdk, "OpenAI", ctor)

    with pytest.raises(llm.LLMError):
        llm.generate_json("s", "u", {"type": "object"}, attempts=1)
    assert captured.get("max_retries") == 0, (
        "OpenAI 클라이언트가 max_retries=0 없이 생성됨 — SDK 내부 재시도가 살아 있다")


def test_llm_does_not_read_provider_env(monkeypatch):
    """provider 분기 제거 확인 — LLM_PROVIDER가 무엇이든 OpenAI 경로로만 간다."""
    import openai as openai_sdk

    from app import llm

    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    called = {"openai": False}

    def ctor(**kwargs):
        called["openai"] = True
        raise RuntimeError("네트워크 호출 전 중단")

    monkeypatch.setattr(openai_sdk, "OpenAI", ctor)
    with pytest.raises(llm.LLMError):
        llm.generate_json("s", "u", {"type": "object"}, attempts=1)
    assert called["openai"], "LLM_PROVIDER=anthropic 인데 OpenAI 경로로 가지 않았다"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python -m pytest tests/test_algorithms.py -k llm -v`
Expected: `test_llm_does_not_read_provider_env` FAIL — `LLMError: Unsupported LLM_PROVIDER` 또는 anthropic 경로 진입

- [ ] **Step 3: `llm.py`에서 provider 분기 제거**

1행 docstring 교체:

```python
"""LLM 어댑터 — OpenAI 단일 provider (CLAUDE.md 규칙, docs/plan/07 B3)."""
```

9-12행 주석에서 Lambda 근거를 게이트웨이로 교체:

```python
# 재시도 사이 고정 대기. 최악 지연 = cardgen timeout 12s × 2회 + backoff 0.5s = 24.5s
# < API Gateway HTTP API 통합 타임아웃 30초(증액 불가). 마지막 시도 뒤에는 대기하지 않는다.
```

43-73행(`provider = os.environ.get(...)` 부터 `out = json.loads(...)` 까지)을 교체:

```python
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    attempts = max(1, attempts)     # 0 이하면 아래 raise last_exc 가 None을 raise 하므로 최소 1회는 돈다
    last_exc: Exception | None = None
    started = time.perf_counter()   # 소요시간은 호출 전체(재시도·backoff 포함) 기준
    for attempt in range(1, attempts + 1):
        try:
            from openai import OpenAI
            client = OpenAI(max_retries=0)   # 재시도는 이 함수의 attempts가 전담 (위 예산 주석)
            # timeout 미지정(None)이면 with_options를 거치지 않고 SDK 기본 타임아웃을 유지한다 —
            # with_options(timeout=None)을 호출하면 "타임아웃 없음(무한 대기)"으로 바뀌어 버린다.
            if timeout is not None:
                client = client.with_options(timeout=timeout)
            resp = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_schema",
                                 "json_schema": {"name": schema_name, "schema": schema, "strict": True}},
            )
            out = json.loads(resp.choices[0].message.content)
            log.info("llm ok model=%s schema=%s attempt=%d/%d elapsed=%.2fs",
                     model, schema_name, attempt, attempts, time.perf_counter() - started)
            return out
```

이어지는 `except Exception as exc:` 블록은 그대로 두고, 함수 끝의 두 로그·raise에서 `provider=%s`와 `provider` 인자만 제거:

```python
    cause = redact(f"{type(last_exc).__name__}: {last_exc}")
    log.info("llm fail model=%s schema=%s attempts=%d elapsed=%.2fs error=%s",
             model, schema_name, attempts, time.perf_counter() - started, cause)
    raise LLMError(cause) from None     # 원인 체인을 끊어 마스킹 안 된 SDK 메시지가 새지 않게 (위 docstring)
```

- [ ] **Step 4: 의존성·설정에서 제거**

`backend/requirements.txt` — `anthropic==0.120.2` 줄 삭제.

`.env.example` 44-61행에서 `LLM_PROVIDER`·`ANTHROPIC_API_KEY`·`ANTHROPIC_MODEL` 및 관련 주석 전부 삭제. `OPENAI_API_KEY`·`OPENAI_MODEL`만 남긴다.

`docker-compose.yml` — `LLM_PROVIDER`/`ANTHROPIC_*` 참조가 있으면 삭제(`env_file: .env`로만 들어오면 조치 불필요, grep으로 확인).

`CLAUDE.md` 64행 교체:

```
- LLM 호출은 `backend/app/llm.py`의 `generate_json(system, user, schema)` 하나로 통일.
  provider는 OpenAI 단일이며 SDK 호출은 이 파일 안에만 존재한다.
```

- [ ] **Step 5: 전체 테스트 통과 확인**

Run: `cd backend && python -m pytest -q`
Expected: 전부 PASS. `pip uninstall anthropic` 없이도 통과해야 한다(코드가 import하지 않으므로).

Run: `cd backend && grep -rn "anthropic\|ANTHROPIC" app/ tests/ requirements.txt`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add backend/app/llm.py backend/requirements.txt backend/tests/test_algorithms.py .env.example docker-compose.yml CLAUDE.md
git commit -m "fix: Anthropic provider 제거 — OpenAI 단일로 통일"
```

---

### Task A2: Lambda 탈출 — Mangum 제거 + 배포 환경 판별 교체

**Files:**
- Modify: `backend/app/main.py:6-8,13,18-23,25-29,85`
- Modify: `backend/requirements.txt`
- Modify: `backend/requirements-dev.txt:1,4`
- Modify: `backend/pytest.ini:4-7`
- Test: `backend/tests/test_algorithms.py` (신규 테스트 3건 추가)

**Interfaces:**
- Consumes: Task A1의 `llm.py`
- Produces: `main.resolve_allowed_origins(raw: str | None, is_deployed: bool) -> list[str]` — CORS 오리진 결정 순수 함수. `main.IS_DEPLOYED: bool` — `APP_ENV == "production"` 여부. `handler` 심볼은 **더 이상 존재하지 않는다.**

> **⚠ 순서 주의:** 13·85행(`from mangum import Mangum`, `handler = Mangum(app)`)을 남긴 채 `requirements.txt`의 mangum만 지우면 컨테이너가 import 단계에서 `ModuleNotFoundError`로 기동 실패한다. 이 태스크에서 **반드시 함께** 처리한다.

- [ ] **Step 1: 실패 테스트 3건 추가**

`backend/tests/test_algorithms.py` 끝에 추가:

```python
def test_resolve_allowed_origins_deployed_defaults_to_empty():
    """배포 환경에서 ALLOWED_ORIGINS 미설정이면 어떤 오리진도 허용하지 않는다.

    구 코드는 AWS_LAMBDA_FUNCTION_NAME 유무로 판별했는데 ECS에는 그 변수가 없어
    배포 환경에서도 localhost가 조용히 허용됐다.
    """
    from app import main
    assert main.resolve_allowed_origins(None, True) == []


def test_resolve_allowed_origins_local_defaults_to_localhost():
    from app import main
    assert main.resolve_allowed_origins(None, False) == [
        "http://localhost:3100", "http://127.0.0.1:3100"]


def test_resolve_allowed_origins_rejects_wildcard():
    from app import main
    with pytest.raises(RuntimeError, match="not allowed"):
        main.resolve_allowed_origins("https://a.example,*", True)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python -m pytest tests/test_algorithms.py -k resolve_allowed -v`
Expected: FAIL — `AttributeError: module 'app.main' has no attribute 'resolve_allowed_origins'`

- [ ] **Step 3: `main.py` 수정**

6-8행 교체 (dotenv 판별):

```python
# 배포 환경 판별 — ECS·Lambda 어디서도 성립하는 명시적 신호를 쓴다.
# (구 코드는 AWS_LAMBDA_FUNCTION_NAME 유무로 판별해 ECS에서 항상 '로컬'로 오판했다)
IS_DEPLOYED = os.environ.get("APP_ENV", "").strip().lower() == "production"

if not IS_DEPLOYED:                                     # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")
```

13행 `from mangum import Mangum` **삭제**.
11행 `from fastapi import FastAPI, Request` → `from fastapi import FastAPI, HTTPException, Request` (Task A3에서 쓴다)

18-23행을 순수 함수 + 호출로 교체:

```python
def resolve_allowed_origins(raw: str | None, is_deployed: bool) -> list[str]:
    """CORS 허용 오리진 결정.

    배포 환경에서 미설정 CORS가 전체 허용이나 localhost 허용으로 새지 않게 한다.
    로컬만 명시적인 localhost 기본값을 쓰고, 배포는 빈 목록이 기본이다.
    """
    default = "" if is_deployed else "http://localhost:3100,http://127.0.0.1:3100"
    origins = [o.strip() for o in (default if raw is None else raw).split(",") if o.strip()]
    if "*" in origins:
        raise RuntimeError("ALLOWED_ORIGINS='*' is not allowed; configure explicit frontend origins")
    return origins


ALLOWED_ORIGINS = resolve_allowed_origins(os.environ.get("ALLOWED_ORIGINS"), IS_DEPLOYED)
```

25-29행 로깅 주석 교체:

```python
# 로깅: 컨테이너 stdout을 awslogs 드라이버가 CloudWatch로 보낸다.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
if not logging.getLogger().handlers:    # uvicorn이 이미 붙인 핸들러는 덮지 않는다
    logging.basicConfig(level=LOG_LEVEL)
logging.getLogger("app").setLevel(LOG_LEVEL)
```

85행 `handler = Mangum(app)   # Lambda 진입점` **삭제**.

- [ ] **Step 4: 의존성 정리**

`backend/requirements.txt`:
- `mangum==0.21.0` 삭제
- `uvicorn[standard]==0.52.1` 추가 (현재 Dockerfile이 버전 미고정으로 설치해 비재현 이미지가 된다)
- 1-2행 주석 교체:

```
# ECS 컨테이너 이미지 런타임 의존성. pandas/numpy 등 무거운 패키지는 넣지 않는다
# (이미지 크기·빌드 시간, 07 의존성 원칙). 개발·테스트 전용은 requirements-dev.txt.
```

`backend/requirements-dev.txt`:
- 4행 `uvicorn==0.52.1 ...` 줄 삭제 (런타임으로 이동)
- 1행 헤더 교체: `# 개발·테스트 전용 — requirements.txt에는 절대 넣지 않는다 (런타임 이미지 오염 방지, 07 의존성 원칙·15 §5)`

`backend/pytest.ini` — mangum 경고 필터와 그 주석 삭제, 다음만 남긴다:

```ini
[pytest]
testpaths = tests
```

- [ ] **Step 5: 통과 확인 + Mangum 잔재 없음 확인**

Run: `cd backend && python -m pytest -q`
Expected: 전부 PASS

Run: `cd backend && grep -rn "mangum\|Mangum\|AWS_LAMBDA_FUNCTION_NAME" app/ tests/ requirements.txt pytest.ini`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add backend/app/main.py backend/requirements.txt backend/requirements-dev.txt backend/pytest.ini backend/tests/test_algorithms.py
git commit -m "fix: Mangum 제거 및 배포 환경 판별을 APP_ENV로 교체 (ECS 대비)"
```

---

### Task A3: `/api/health/ready` 신설 (ALB 대상그룹 전용)

**Files:**
- Modify: `backend/app/main.py` (health 함수 뒤에 추가)
- Modify: `docs/plan/05-api-contract.md` (§5 health 절)
- Test: `backend/tests/test_smoke.py`

**Interfaces:**
- Consumes: Task A2의 `main.py`
- Produces: `GET /api/health/ready` → 200 `{"ready": true}` 또는 503 `{"detail": "필수 산출물 누락: ..."}`. **ALB 대상그룹이 보는 유일한 경로.**

> `/api/health`의 200-always 동작은 05 계약이고 기존 테스트 2건이 검증한다. 그것을 깨지 않고 별도 경로를 만든다. `/api/health`는 어느 산출물이 빠졌는지 `datasets`로 보여주는 **진단용**이라 결손 시에도 200이어야 하고, `/api/health/ready`는 결손 이미지가 트래픽을 받지 못하게 막는 게 목적이라 **반드시 실패해야 한다.**

- [ ] **Step 1: 실패 테스트 작성**

`backend/tests/test_smoke.py`의 health 테스트 2건 바로 뒤에 추가:

```python
def test_health_ready_returns_200_when_all_required_datasets_present():
    """ALB 대상그룹 전용 경로 — 정상 이미지에서는 200."""
    res = client.get("/api/health/ready")
    assert res.status_code == 200
    assert res.json() == {"ready": True}


def test_health_ready_returns_503_when_required_dataset_missing(monkeypatch):
    """정적 JSON이 빠진 이미지가 healthy로 판정되면 서킷 브레이커가 롤백하지 못하고
    고장난 버전이 무중단으로 전량 배포된다 — 그래서 이 경로는 반드시 실패해야 한다."""
    real_load = dataload.load

    def _load(name):
        if name == "merchants":
            raise FileNotFoundError(name)
        return real_load(name)

    monkeypatch.setattr(dataload, "load", _load)
    res = client.get("/api/health/ready")
    assert res.status_code == 503
    assert "merchants" in res.json()["detail"]


def test_health_ready_ignores_optional_dataset(monkeypatch):
    """risk_signal은 '없으면 컷'인 선택 입력이라 ready를 내리지 않는다 (07 B4 ⑥)."""
    real_load = dataload.load

    def _load(name):
        if name == OPTIONAL_DATASET:
            raise FileNotFoundError(name)
        return real_load(name)

    monkeypatch.setattr(dataload, "load", _load)
    assert client.get("/api/health/ready").status_code == 200
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && python -m pytest tests/test_smoke.py -k health_ready -v`
Expected: FAIL — 404 (라우트 없음)

- [ ] **Step 3: 구현**

`backend/app/main.py`의 `health()` 함수 바로 뒤에 추가:

```python
@app.get("/api/health/ready")
def health_ready():
    """ALB 대상그룹 전용 준비 상태 — 필수 산출물이 하나라도 없으면 503.

    /api/health와 나뉜 이유: health는 어느 산출물이 빠졌는지 보여주는 진단용이라 결손
    시에도 200이어야 하고(05 §5 계약), 이 경로는 결손 이미지가 트래픽을 받지 못하게
    막는 것이 목적이라 반드시 실패해야 한다. 둘을 합치면 진단이 막히거나 방어가 뚫린다.
    """
    from app import dataload
    missing = []
    for name in REQUIRED_DATASETS:
        try:
            dataload.load(name)
        except (FileNotFoundError, json.JSONDecodeError):
            missing.append(name)
    if missing:
        raise HTTPException(status_code=503, detail=f"필수 산출물 누락: {', '.join(missing)}")
    return {"ready": True}
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && python -m pytest -q`
Expected: 전부 PASS (기존 health 테스트 2건 포함)

- [ ] **Step 5: API 계약 문서 갱신 (코드보다 문서 먼저가 원칙이나 여기서는 같은 커밋에 묶는다)**

`docs/plan/05-api-contract.md`의 health 절에 추가:

```markdown
### `GET /api/health/ready`

ALB 대상그룹 헬스체크 전용. 필수 산출물(dashboard·eup_scores·candidates·merchants)이
하나라도 없으면 **503**을 반환한다.

- 200: `{"ready": true}`
- 503: `{"detail": "필수 산출물 누락: merchants"}`

`/api/health`와 나뉘어 있다 — health는 결손을 **보고**하는 진단용(항상 200)이고,
이 경로는 결손 이미지가 트래픽을 받지 못하게 **차단**하는 용도다.
```

- [ ] **Step 6: 커밋**

```bash
git add backend/app/main.py backend/tests/test_smoke.py docs/plan/05-api-contract.md
git commit -m "feat: ALB 대상그룹용 /api/health/ready 추가 — 결손 이미지 배포 차단"
```

---

### Task A4: `.dockerignore` 신설 + Dockerfile 프로덕션화

**Files:**
- Create: `backend/.dockerignore`
- Modify: `backend/Dockerfile` (전면 재작성)
- Modify: `docker-compose.yml:54` (주석)

**Interfaces:**
- Consumes: Task A2의 requirements.txt(uvicorn 포함)
- Produces: `backend/Dockerfile` — 빌드 컨텍스트 `./backend`, 정적 JSON은 빌드 전에 `backend/app/data/`로 복사돼 있어야 한다(Task B4가 수행). 컨테이너는 8000 포트에서 uvicorn 단일 워커로 뜬다.

> **보안상 최우선.** 레포에 `.dockerignore`가 전혀 없다. 빌드 컨텍스트에 `.env`가 들어가면 이미지에 구워지고, `main.py`의 `load_dotenv`가 그 키를 **실제로 로드한다**. ECR 레이어는 지워도 남아 회수 수단이 키 로테이션뿐이다.

- [ ] **Step 1: `.dockerignore` 작성**

`backend/.dockerignore`:

```
# 빌드 컨텍스트 최소화 + 시크릿 유입 차단.
# ⚠ .env 계열이 이미지에 들어가면 main.py의 load_dotenv가 실제로 로드한다.
#   ECR 레이어는 삭제해도 남아 회수 수단이 키 로테이션뿐이다.
.env
.env.*
*.pem
*.key

.venv/
venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/

tests/
requirements-dev.txt
local_init.py
pytest.ini

# app/data 는 빌드 직전 build-and-push.sh 가 채운다 — 제외하지 않는다.
```

- [ ] **Step 2: 컨텍스트에 `.env`가 없음을 확인**

Run: `cd backend && docker build --no-cache -t sangseng-ctx-probe . -f - <<'EOF'
FROM python:3.12-slim
COPY . /probe
RUN test ! -e /probe/.env && test ! -d /probe/.venv && test ! -d /probe/tests && echo "CONTEXT OK"
EOF`
Expected: 빌드 로그에 `CONTEXT OK`

Run: `docker rmi sangseng-ctx-probe`

- [ ] **Step 3: Dockerfile 재작성**

`backend/Dockerfile` 전체 교체:

```dockerfile
# ECS Fargate(ARM64) 런타임 이미지. 로컬 통합 테스트(docker compose)도 같은 이미지를 쓰고
# 핫리로드만 compose 쪽 command 로 덮어쓴다 (docs/plan/09).
FROM python:3.12-slim

# 로그가 버퍼에 갇히면 awslogs 로 늦게/안 나가 장애 분석이 막힌다.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# 의존성만 먼저 복사해 레이어 캐시를 살린다 (소스 수정 때 재설치 안 함)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# app/data 에는 build-and-push.sh 가 복사해 둔 data/processed 사본이 들어 있다.
# dataload.py 의 두 번째 후보 경로(Path(__file__).parent / "data")가 정확히 이 위치다.
#
# ⚠ 컨테이너에서 dataload 의 **첫 번째** 후보 경로는 /data/processed 로 풀린다(존재하지 않아 폴백).
#   이미지에도 태스크 정의에도 /data 디렉터리나 볼륨을 절대 만들지 말 것 —
#   만들면 그쪽이 먼저 잡혀 이미지에 구운 /app/app/data 를 조용히 가린다.
COPY app ./app

# 비루트 실행. app/ 는 읽기만 하므로 소유권 변경 없이 실행 사용자만 바꾼다.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# exec form — uvicorn 이 PID 1 로 SIGTERM 을 직접 받아 graceful shutdown 한다.
#   --workers 1 : 0.5GB 제약. OpenAI SDK 로드 후 RSS 116MB(실측)라 2워커는 OOM 위험.
#                 확장은 ECS desiredCount 로 한다.
#   --timeout-graceful-shutdown 30 : stopTimeout 60초 안에 반드시 끝나게
#   --timeout-keep-alive 75        : ALB idle_timeout 65초보다 길게 (역전 시 간헐 502)
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", \
     "--timeout-graceful-shutdown", "30", \
     "--timeout-keep-alive", "75"]
```

- [ ] **Step 4: `docker-compose.yml` 주석 갱신**

54행 주석 교체:

```yaml
      - ./data/processed:/app/app/data:ro         # ECS 이미지와 동일 경로(/app/app/data)
```

`backend` 서비스에 `APP_ENV`를 넣지 **않는다**(로컬은 배포 환경이 아니다). `seed` 서비스도 그대로 둔다.

- [ ] **Step 5: 로컬 통합 환경으로 검증 — 비루트 전환 후 회귀 확인**

Run: `docker compose down -v && docker compose up -d --build`
Run: `sleep 20 && curl -s localhost:8000/api/health | python3 -m json.tool`
Expected: `"data_loaded": true`, `datasets` 5종 전부 true

Run: `curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/health/ready`
Expected: `200`

Run: `curl -s -o /dev/null -w '%{http_code}\n' localhost:3100/`
Expected: `200`

Run: `docker compose logs backend --tail 20`
Expected: 권한 오류(`Permission denied`) 없음 — 비루트 전환이 바인드 마운트와 충돌하지 않았는지 확인

Run: `docker compose down`

- [ ] **Step 6: 커밋**

```bash
git add backend/.dockerignore backend/Dockerfile docker-compose.yml
git commit -m "infra: 프로덕션 컨테이너 이미지화 — .dockerignore 신설, 비루트·graceful shutdown"
```

---

### Task A5: 프론트 3건 — 리전·타임아웃·콜드스타트 문구

**Files:**
- Create: `frontend/vercel.json`
- Modify: `frontend/src/lib/api.ts:103-105`
- Modify: `frontend/src/components/PageSkeleton.tsx:117-119`
- Modify: `frontend/src/app/error.tsx:61`
- Modify: `frontend/README.md:64,170`

**Interfaces:**
- Consumes: 없음 (백엔드와 독립)
- Produces: Vercel 함수가 `icn1`(서울)에서 실행된다. POST 타임아웃 35초.

- [ ] **Step 1: `frontend/vercel.json` 생성**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"]
}
```

> **왜:** 기본값 `iad1`(버지니아)에서는 한국 사용자 요청이 태평양을 건너고, SSR 안의 API 호출이 서울 백엔드로 **다시 왕복**한다(리전 간 RTT 182ms). `icn1`로 옮기면 SSR TTFB가 550~800ms → 60~120ms가 된다. Hobby 플랜도 단일 리전 선택이 가능하다. Next.js 16.3에서는 edge runtime이 제거되어 서버 컴포넌트·Server Action이 전부 이 함수 리전에서 돈다.

- [ ] **Step 2: POST 타임아웃 30초 → 35초**

`frontend/src/lib/api.ts` 103-105행 교체:

```typescript
    // generate는 LLM 재시도까지 최대 24.5초. API Gateway HTTP API의 통합 타임아웃이 30초
    // (증액 불가)이므로 FE를 35초로 두어 **게이트웨이가 먼저 끊게** 한다 — FE가 먼저 끊으면
    // 서버가 만든 폴백 응답조차 못 받는다.
    signal: AbortSignal.timeout(35_000),
```

- [ ] **Step 3: 콜드스타트 문구 교체 (심사위원에게 보이는 텍스트)**

ECS는 상시 가동이라 "서버가 깨어나는 중"이 거짓이 된다. 스켈레톤·loading·error 3종 구조는 유지한다.

`frontend/src/components/PageSkeleton.tsx` 117-119행:

```tsx
            <p className="u-note">
              데이터를 불러오는 중입니다.
            </p>
```

`frontend/src/app/error.tsx` 61행:

```tsx
            : "데이터 서버 응답을 받지 못했습니다. 일시적인 네트워크 문제일 수 있으니 다시 시도해 주세요."}
```

- [ ] **Step 4: `frontend/README.md` 문구 정리**

64행의 `배포(Vercel + API Gateway)에서는 공개 …` → `배포(Vercel + AWS ECS)에서는 공개 …`
170행의 `Lambda 콜드스타트 1~3초를 "고장"으로 오인하지 않게` → `느린 응답을 "고장"으로 오인하지 않게`

- [ ] **Step 5: 검증**

Run: `cd frontend && npm run check:banned`
Expected: 통과 (금지어 미노출)

Run: `cd frontend && npm run lint`
Expected: 에러 없음

Run: `cd frontend && npm run build`
Expected: 빌드 성공

Run: `cd frontend && grep -rn "깨어나\|콜드스타트\|cold start" src/`
Expected: 사용자에게 보이는 문구에는 출력 없음 (주석은 남아도 무방하나 함께 정리 권장)

- [ ] **Step 6: 커밋**

```bash
git add frontend/vercel.json frontend/src/lib/api.ts frontend/src/components/PageSkeleton.tsx frontend/src/app/error.tsx frontend/README.md
git commit -m "fix: Vercel 함수 리전을 서울로 이전, POST 타임아웃 35초, 콜드스타트 문구 제거"
```

> **배포 후 실측 필요:** Vercel에 반영된 뒤 응답 헤더 `x-vercel-id`의 리전 접두사가 `icn1`인지 확인한다. Hobby에서 리전 설정이 무시됐다는 과거 제보가 있다.

---

# Phase B — 인프라 코드

### Task B1: `config.sh` + `lib/common.sh` + `preflight.sh`

**Files:**
- Create: `infra/config.sh`
- Create: `infra/scripts/lib/common.sh`
- Create: `infra/scripts/preflight.sh`

**Interfaces:**
- Consumes: 없음
- Produces: 모든 후속 스크립트가 `source "$(dirname "$0")/../config.sh"`와 `source "$(dirname "$0")/lib/common.sh"`로 불러 쓴다.
  `common.sh`가 제공하는 함수: `log_step <msg>` · `log_ok <msg>` · `die <msg>` · `aws_ <args...>`(프로필·리전 자동 주입) · `cfn_deploy <stack> <template> <params...>` · `stack_output <stack> <key>` · `dump_task_diagnostics`

- [ ] **Step 1: `infra/config.sh` 작성**

```bash
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
```

- [ ] **Step 2: `infra/scripts/lib/common.sh` 작성**

```bash
#!/usr/bin/env bash
# 공통 로깅·AWS 래퍼·CFN 배포·진단 덤프.

set -euo pipefail

_C_RESET=$'\033[0m'; _C_BLUE=$'\033[34m'; _C_GREEN=$'\033[32m'; _C_RED=$'\033[31m'; _C_YEL=$'\033[33m'

# ⚠ 로그는 전부 stderr 로 보낸다. build-and-push.sh 가 이미지 태그를 stdout 으로 넘기는데,
#   로그가 섞이면 호출부가 태그를 읽으려 파이프를 걸어야 하고 그러면 진행 상황이 안 보인다.
log_step() { printf '%s▸ %s%s\n' "$_C_BLUE" "$*" "$_C_RESET" >&2; }
log_ok()   { printf '%s  ✓ %s%s\n' "$_C_GREEN" "$*" "$_C_RESET" >&2; }
log_warn() { printf '%s  ⚠ %s%s\n' "$_C_YEL" "$*" "$_C_RESET" >&2; }
die()      { printf '%s  ✗ %s%s\n' "$_C_RED" "$*" "$_C_RESET" >&2; exit 1; }

# 리전을 항상 명시해 셸 환경에 상관없이 같은 대상에 배포한다. 프로필은 config.sh 가
# AWS_PROFILE 로 내보내고 aws CLI 가 자동으로 읽는다 — CI 에는 그 변수가 없고 OIDC 자격증명이 쓰인다.
aws_() { aws --region "$AWS_REGION" "$@"; }

# 환경변수 우선, .env 는 폴백. 이미 설정된 값은 덮지 않는다.
# CI 러너에는 .env 가 없고 GitHub 저장소 변수로 값이 들어온다 —
# 프론트의 next.config.mjs 가 루트 .env 를 승계하는 규칙과 같다.
load_env() {
  [ -f "$REPO_ROOT/.env" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -n "${!key:-}" ] || export "$key=$val"
  done < "$REPO_ROOT/.env"
}

stack_output() {   # $1=스택명 $2=OutputKey
  aws_ cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

stack_exists() { aws_ cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; }

cfn_deploy() {     # $1=스택명 $2=템플릿 나머지=Key=Value 파라미터
  local stack="$1" template="$2"; shift 2
  # ⚠ macOS 기본 bash 는 3.2 라 `set -u` 아래에서 빈 배열 "${arr[@]}" 가 unbound variable 로 죽는다.
  #   파라미터 유무로 호출을 나눠 3.2 에서도 동작하게 한다.
  if [ $# -gt 0 ]; then
    aws_ cloudformation deploy \
      --stack-name "$stack" --template-file "$template" \
      --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
      --parameter-overrides "$@"
  else
    aws_ cloudformation deploy \
      --stack-name "$stack" --template-file "$template" \
      --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset
  fi
}

# 태스크가 죽는 이유는 CloudWatch 로그가 아니라 stoppedReason 에만 남는 경우가 많다
# (예: 태스크 실행 역할의 ssm:GetParameters 누락 → ResourceInitializationError).
dump_task_diagnostics() {
  log_warn "최근 중지된 태스크 진단:"
  local arns
  arns=$(aws_ ecs list-tasks --cluster "$CLUSTER_NAME" --desired-status STOPPED \
           --query 'taskArns[:5]' --output text 2>/dev/null || true)
  if [ -n "$arns" ] && [ "$arns" != "None" ]; then
    aws_ ecs describe-tasks --cluster "$CLUSTER_NAME" --tasks $arns \
      --query 'tasks[].{stopped:stoppedReason,code:stopCode,containers:containers[].reason}' \
      --output json || true
  else
    log_warn "  중지된 태스크 없음"
  fi
  log_warn "서비스 이벤트 (최근 10건):"
  aws_ ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
    --query 'services[0].events[:10].message' --output json 2>/dev/null || true
}
```

- [ ] **Step 3: `infra/scripts/preflight.sh` 작성**

```bash
#!/usr/bin/env bash
# 배포 전 사전 점검 — 아무것도 만들지 않는다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

log_step "1. AWS 자격증명"
CALLER=$(aws_ sts get-caller-identity --query Arn --output text) \
  || die "프로필 '$AWS_PROFILE' 로 인증할 수 없습니다. infra/README.md 의 배포 사용자 준비를 보세요."
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
  die "DEMO_READ_ONLY=$DEMO_READ_ONLY 인데 MUTATION_API_TOKEN 이 비어 있습니다. 변경 API 가 전부 503 이 됩니다.
  1) openssl rand -hex 32
  2) .env 의 MUTATION_API_TOKEN 에 기입
  3) 같은 값을 Vercel 환경변수 API_MUTATION_TOKEN 에 등록 (NEXT_PUBLIC_ 접두사 금지)"
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
```

- [ ] **Step 4: 문법 검사**

Run: `bash -n infra/config.sh infra/scripts/lib/common.sh infra/scripts/preflight.sh`
Expected: 출력 없음

Run: `chmod +x infra/scripts/*.sh`

> 이 시점에는 `service.yaml`이 아직 없어 preflight 4·7단계가 실패한다. Task B5 이후 전체를 돌린다.

- [ ] **Step 5: 커밋**

```bash
git add infra/config.sh infra/scripts/lib/common.sh infra/scripts/preflight.sh
git commit -m "infra: 배포 설정 단일 정의와 사전 점검 스크립트 추가"
```

---

### Task B2: `foundation.yaml` + `deploy-foundation.sh`

**Files:**
- Create: `infra/cloudformation/foundation.yaml`
- Create: `infra/scripts/deploy-foundation.sh`

**Interfaces:**
- Consumes: Task B1의 `config.sh`·`common.sh`
- Produces: CloudFormation Export 9종 — `sangseng-foundation-VpcId` · `-PublicSubnetIds` · `-PrivateSubnetIds` · `-EcrRepositoryUri` · `-CardsTableName` · `-ProgressRecordsTableName` · `-TaskExecutionRoleArn` · `-TaskRoleArn` · `-LogGroupName`. Task B5의 `service.yaml`이 `Fn::ImportValue`로 가져간다.

- [ ] **Step 1: `infra/cloudformation/foundation.yaml` 작성**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: sangseng-navigator — 네트워크·레지스트리·데이터·IAM (수명이 긴 계층)

Parameters:
  AzA: { Type: AWS::EC2::AvailabilityZone::Name, Default: ap-northeast-2a }
  AzC: { Type: AWS::EC2::AvailabilityZone::Name, Default: ap-northeast-2c }
  # ⚠ ap-northeast-2d(apne2-az4)는 VPC Link V2 미지원. 기본값을 바꾸지 말 것.

Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags: [{ Key: Name, Value: sangseng }]

  Igw:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags: [{ Key: Name, Value: sangseng }]

  IgwAttachment:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties: { VpcId: !Ref Vpc, InternetGatewayId: !Ref Igw }

  # public — ECS 태스크. assignPublicIp 로 IGW 직행(OpenAI·ECR). NAT 불필요.
  PublicSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      AvailabilityZone: !Ref AzA
      CidrBlock: 10.0.0.0/20
      Tags: [{ Key: Name, Value: sangseng-public-a }]

  PublicSubnetC:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      AvailabilityZone: !Ref AzC
      CidrBlock: 10.0.16.0/20
      Tags: [{ Key: Name, Value: sangseng-public-c }]

  # private — 내부 ALB·VPC Link ENI. 인터넷이 필요 없으므로 NAT 없이 local 라우트만 둔다(비용 0).
  PrivateSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      AvailabilityZone: !Ref AzA
      CidrBlock: 10.0.32.0/20
      Tags: [{ Key: Name, Value: sangseng-private-a }]

  PrivateSubnetC:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      AvailabilityZone: !Ref AzC
      CidrBlock: 10.0.48.0/20
      Tags: [{ Key: Name, Value: sangseng-private-c }]

  PublicRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref Vpc
      Tags: [{ Key: Name, Value: sangseng-public }]

  PublicDefaultRoute:
    Type: AWS::EC2::Route
    DependsOn: IgwAttachment
    Properties:
      RouteTableId: !Ref PublicRouteTable
      DestinationCidrBlock: 0.0.0.0/0
      GatewayId: !Ref Igw

  PublicRouteAssocA:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PublicSubnetA, RouteTableId: !Ref PublicRouteTable }

  PublicRouteAssocC:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PublicSubnetC, RouteTableId: !Ref PublicRouteTable }

  PrivateRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref Vpc
      Tags: [{ Key: Name, Value: sangseng-private }]

  PrivateRouteAssocA:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PrivateSubnetA, RouteTableId: !Ref PrivateRouteTable }

  PrivateRouteAssocC:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PrivateSubnetC, RouteTableId: !Ref PrivateRouteTable }

  # DynamoDB 를 인터넷 경유 없이 부른다. Gateway 엔드포인트는 무과금이고 라우트 테이블에 붙는다.
  # 태스크가 public 서브넷에 있으므로 public 라우트 테이블에 연결한다.
  DynamoDbEndpoint:
    Type: AWS::EC2::VPCEndpoint
    Properties:
      VpcId: !Ref Vpc
      ServiceName: !Sub com.amazonaws.${AWS::Region}.dynamodb
      VpcEndpointType: Gateway
      RouteTableIds: [!Ref PublicRouteTable]

  EcrRepository:
    Type: AWS::ECR::Repository
    Properties:
      RepositoryName: sangseng-api
      ImageScanningConfiguration: { ScanOnPush: true }
      LifecyclePolicy:
        LifecyclePolicyText: |
          {"rules":[{"rulePriority":1,"description":"최근 10개만 보관",
          "selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},
          "action":{"type":"expire"}}]}

  # 이름을 고정한다 — seed_demo.py·local_init.py·docker-compose 기본값과 일치시켜
  # 원격 시드/리셋 명령을 문서에 고정할 수 있다.
  CardsTable:
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: sangseng-cards
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions: [{ AttributeName: id, AttributeType: S }]
      KeySchema: [{ AttributeName: id, KeyType: HASH }]

  ProgressRecordsTable:
    Type: AWS::DynamoDB::Table
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      TableName: sangseng-progress-records
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - { AttributeName: record_id, AttributeType: S }
        - { AttributeName: card_id, AttributeType: S }
        - { AttributeName: report_bucket, AttributeType: S }
        - { AttributeName: recorded_at_key, AttributeType: S }
      KeySchema: [{ AttributeName: record_id, KeyType: HASH }]
      GlobalSecondaryIndexes:
        - IndexName: card-recorded-at-index
          KeySchema:
            - { AttributeName: card_id, KeyType: HASH }
            - { AttributeName: recorded_at_key, KeyType: RANGE }
          Projection: { ProjectionType: ALL }
        - IndexName: report-bucket-recorded-at-index
          KeySchema:
            - { AttributeName: report_bucket, KeyType: HASH }
            - { AttributeName: recorded_at_key, KeyType: RANGE }
          Projection: { ProjectionType: ALL }

  LogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: /ecs/sangseng-api
      RetentionInDays: 7      # 서울 수집 단가가 $0.76/GB 로 높다 — 보존을 짧게 유지

  # 이미지 pull·로그 전송·SSM 시크릿 주입은 '태스크 실행 역할'이 한다.
  # ⚠ ssm:GetParameters 는 AmazonECSTaskExecutionRolePolicy 에 포함되지 않는다.
  #   누락 시 애플리케이션 로그 없이 ResourceInitializationError 로 태스크가 죽는다.
  TaskExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: ecs-tasks.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
      Policies:
        - PolicyName: read-ssm-parameters
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: ssm:GetParameters
                Resource: !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/sangseng/prod/*

  # 애플리케이션 코드가 쓰는 권한.
  TaskRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: ecs-tasks.amazonaws.com }
            Action: sts:AssumeRole
      Policies:
        - PolicyName: dynamodb-access
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - dynamodb:GetItem
                  - dynamodb:PutItem
                  - dynamodb:UpdateItem
                  - dynamodb:DeleteItem
                  - dynamodb:Query
                  - dynamodb:Scan
                  - dynamodb:BatchGetItem
                  - dynamodb:BatchWriteItem
                  - dynamodb:TransactWriteItems
                  - dynamodb:DescribeTable
                Resource:
                  - !GetAtt CardsTable.Arn
                  - !GetAtt ProgressRecordsTable.Arn
                  - !Sub '${ProgressRecordsTable.Arn}/index/*'

Outputs:
  VpcId:
    Value: !Ref Vpc
    Export: { Name: !Sub '${AWS::StackName}-VpcId' }
  PublicSubnetIds:
    Value: !Join [',', [!Ref PublicSubnetA, !Ref PublicSubnetC]]
    Export: { Name: !Sub '${AWS::StackName}-PublicSubnetIds' }
  PrivateSubnetIds:
    Value: !Join [',', [!Ref PrivateSubnetA, !Ref PrivateSubnetC]]
    Export: { Name: !Sub '${AWS::StackName}-PrivateSubnetIds' }
  EcrRepositoryUri:
    Value: !GetAtt EcrRepository.RepositoryUri
    Export: { Name: !Sub '${AWS::StackName}-EcrRepositoryUri' }
  CardsTableName:
    Value: !Ref CardsTable
    Export: { Name: !Sub '${AWS::StackName}-CardsTableName' }
  ProgressRecordsTableName:
    Value: !Ref ProgressRecordsTable
    Export: { Name: !Sub '${AWS::StackName}-ProgressRecordsTableName' }
  TaskExecutionRoleArn:
    Value: !GetAtt TaskExecutionRole.Arn
    Export: { Name: !Sub '${AWS::StackName}-TaskExecutionRoleArn' }
  TaskRoleArn:
    Value: !GetAtt TaskRole.Arn
    Export: { Name: !Sub '${AWS::StackName}-TaskRoleArn' }
  LogGroupName:
    Value: !Ref LogGroup
    Export: { Name: !Sub '${AWS::StackName}-LogGroupName' }
```

- [ ] **Step 2: `infra/scripts/deploy-foundation.sh` 작성**

```bash
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

log_step "foundation 스택 배포 ($FOUNDATION_STACK)"
cfn_deploy "$FOUNDATION_STACK" "$REPO_ROOT/infra/cloudformation/foundation.yaml" \
  "AzA=$AZ_A" "AzC=$AZ_C"

log_ok "완료"
aws_ cloudformation describe-stacks --stack-name "$FOUNDATION_STACK" \
  --query 'Stacks[0].Outputs' --output table
```

- [ ] **Step 3: 템플릿 검증 (배포 없이)**

Run: `bash -n infra/scripts/deploy-foundation.sh && chmod +x infra/scripts/deploy-foundation.sh`
Expected: 출력 없음

Run: `aws --profile sangseng --region ap-northeast-2 cloudformation validate-template --template-body file://infra/cloudformation/foundation.yaml`
Expected: JSON 응답에 Parameters 2개(AzA·AzC)

- [ ] **Step 4: 실제 배포 (3~5분)**

Run: `./infra/scripts/deploy-foundation.sh`
Expected: `CREATE_COMPLETE`, Outputs 9종 출력

- [ ] **Step 5: private 서브넷에 기본 라우트가 없는지 확인 (NAT 없음 증명)**

Run:
```bash
aws --profile sangseng --region ap-northeast-2 ec2 describe-route-tables \
  --filters "Name=tag:Name,Values=sangseng-private" \
  --query 'RouteTables[0].Routes[].{dst:DestinationCidrBlock,gw:GatewayId,nat:NatGatewayId}' --output table
```
Expected: `local` 경로 하나만. `0.0.0.0/0`이나 NAT 항목이 **없어야 한다**

- [ ] **Step 6: 커밋**

```bash
git add infra/cloudformation/foundation.yaml infra/scripts/deploy-foundation.sh
git commit -m "infra: foundation 스택 — VPC(public 2 + private 2, NAT 없음)·ECR·DynamoDB·IAM"
```

---

### Task B3: `put-secrets.sh`

**Files:**
- Create: `infra/scripts/put-secrets.sh`

**Interfaces:**
- Consumes: Task B1의 `config.sh`
- Produces: SSM SecureString 2개 — `/sangseng/prod/OPENAI_API_KEY` · `/sangseng/prod/MUTATION_API_TOKEN`. Task B5의 태스크 정의가 `secrets`로 참조한다.

- [ ] **Step 1: 작성**

```bash
#!/usr/bin/env bash
# .env 의 시크릿을 SSM Parameter Store(SecureString)로 올린다.
# 값이 CloudFormation 템플릿·스택 이벤트·태스크 정의 어디에도 남지 않게 하기 위함이다.
# 표준 파라미터는 무과금이다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

# 로컬 전용이다 — CI 는 SSM 에 이미 올라간 값을 쓰고 이 스크립트를 실행하지 않는다.
[ -f "$REPO_ROOT/.env" ] || die ".env 없음 (put-secrets 는 로컬에서만 실행한다)"
load_env

put() {  # $1=파라미터명 $2=값
  [ -n "$2" ] || die "$1 값이 비어 있습니다."
  aws_ ssm put-parameter --name "$SSM_PREFIX/$1" --type SecureString \
    --value "$2" --overwrite >/dev/null
  log_ok "$SSM_PREFIX/$1"
}

log_step "SSM SecureString 업로드"
put OPENAI_API_KEY "${OPENAI_API_KEY:-}"
put MUTATION_API_TOKEN "${MUTATION_API_TOKEN:-}"

log_step "선존재 검증"
# 태스크 정의가 없는 파라미터를 참조하면 ParameterNotFound 로 조용히 죽는다.
for name in OPENAI_API_KEY MUTATION_API_TOKEN; do
  aws_ ssm get-parameter --name "$SSM_PREFIX/$name" >/dev/null \
    || die "$SSM_PREFIX/$name 조회 실패"
done
log_ok "2종 확인"
```

- [ ] **Step 2: 검증**

Run: `bash -n infra/scripts/put-secrets.sh && chmod +x infra/scripts/put-secrets.sh`
Run: `./infra/scripts/put-secrets.sh`
Expected: 2종 업로드·확인

Run: `aws --profile sangseng --region ap-northeast-2 ssm get-parameters-by-path --path /sangseng/prod --query 'Parameters[].Name' --output text`
Expected: 두 경로 출력. **값은 출력하지 않는다**(`--with-decryption` 사용 금지)

- [ ] **Step 3: 커밋**

```bash
git add infra/scripts/put-secrets.sh
git commit -m "infra: .env 시크릿을 SSM Parameter Store 로 올리는 스크립트"
```

---

### Task B4: `build-and-push.sh`

**Files:**
- Create: `infra/scripts/build-and-push.sh`

**Interfaces:**
- Consumes: Task A4의 `backend/Dockerfile`, Task B2의 `EcrRepositoryUri` Export
- Produces: ECR에 `<repo>:<git-short-sha>` 이미지. 표준출력 마지막 줄에 **이미지 태그만** 출력해 다른 스크립트가 `$(...)`로 받는다.

- [ ] **Step 1: 작성**

```bash
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
```

- [ ] **Step 2: 검증**

Run: `bash -n infra/scripts/build-and-push.sh && chmod +x infra/scripts/build-and-push.sh`
Run: `./infra/scripts/build-and-push.sh`
Expected: 마지막 줄에 git short SHA. 아키텍처 검증에서 `arm64`

Run: `aws --profile sangseng --region ap-northeast-2 ecr describe-images --repository-name sangseng-api --query 'imageDetails[].imageTags' --output text`
Expected: 방금 태그 출력

- [ ] **Step 3: 커밋**

```bash
git add infra/scripts/build-and-push.sh
git commit -m "infra: ARM64 이미지 빌드·ECR 푸시 스크립트 (아키텍처 검증 포함)"
```

---

### Task B5: `service.yaml`

**Files:**
- Create: `infra/cloudformation/service.yaml`

**Interfaces:**
- Consumes: Task B2의 Export 9종, Task B3의 SSM 파라미터, Task B4의 이미지 태그
- Produces: Outputs `ApiUrl`(Vercel `NEXT_PUBLIC_API_BASE`에 넣을 값, **끝 슬래시 없음**) · `TaskDefinitionArn`(Task B6의 롤아웃 검증에 쓴다) · `ClusterName` · `ServiceName`

- [ ] **Step 1: 작성**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: sangseng-navigator — ALB·ECS·API Gateway (배포마다 갱신되는 계층)

Parameters:
  FoundationStack:   { Type: String, Default: sangseng-foundation }
  ImageTag:          { Type: String }
  DesiredCount:      { Type: Number, Default: 2 }
  # Fargate 는 Spot 부족 시 온디맨드로 자동 대체하지 않는다 — 전부 Spot 이면 최악의 경우
  # 실행 태스크가 0 이 된다. 심사 기간에는 1 로 두어 최소 1대를 온디맨드로 확보한다.
  OnDemandBaseCount: { Type: Number, Default: 0 }
  TaskCpu:           { Type: String, Default: '256' }
  TaskMemory:        { Type: String, Default: '512' }
  DemoReadOnly:
    Type: String
    AllowedValues: ['true', 'false']
    # 기본값을 두지 않는다 — 배포자가 반드시 명시하게 한다.
    # 앱 기본값은 false 라 빠뜨리면 공개 데모가 쓰기 가능 상태로 뜬다.
  AllowedOrigins:    { Type: String, Default: '' }
  OpenAiModel:       { Type: String, Default: gpt-4o-mini }

Resources:
  # ── 보안그룹 ──────────────────────────────────────────────────────────
  # 인그레스를 별도 리소스로 뺀다 — SG 끼리 서로 참조하면 CloudFormation 순환 의존이 된다.
  VpcLinkSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: API Gateway VPC Link ENI
      VpcId: !ImportValue
        'Fn::Sub': '${FoundationStack}-VpcId'

  AlbSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: internal ALB
      VpcId: !ImportValue
        'Fn::Sub': '${FoundationStack}-VpcId'

  TaskSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      # 태스크는 public 서브넷에 public IP 를 달고 있다 — 인바운드 차단은 전적으로 이 SG 가 한다.
      GroupDescription: ECS task (inbound only from ALB)
      VpcId: !ImportValue
        'Fn::Sub': '${FoundationStack}-VpcId'

  AlbIngressFromVpcLink:
    Type: AWS::EC2::SecurityGroupIngress
    Properties:
      GroupId: !Ref AlbSecurityGroup
      IpProtocol: tcp
      FromPort: 80
      ToPort: 80
      SourceSecurityGroupId: !Ref VpcLinkSecurityGroup

  TaskIngressFromAlb:
    Type: AWS::EC2::SecurityGroupIngress
    Properties:
      GroupId: !Ref TaskSecurityGroup
      IpProtocol: tcp
      FromPort: 8000
      ToPort: 8000
      SourceSecurityGroupId: !Ref AlbSecurityGroup

  # ── 내부 ALB ─────────────────────────────────────────────────────────
  LoadBalancer:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Scheme: internal          # 인터넷에서 접근 불가. 진입은 API Gateway 뿐이다.
      Type: application
      SecurityGroups: [!Ref AlbSecurityGroup]
      Subnets: !Split
        - ','
        - !ImportValue
          'Fn::Sub': '${FoundationStack}-PrivateSubnetIds'
      LoadBalancerAttributes:
        # API Gateway 통합 타임아웃 30초보다 크게 둔다.
        - { Key: idle_timeout.timeout_seconds, Value: '65' }

  TargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      TargetType: ip
      Protocol: HTTP
      Port: 8000
      VpcId: !ImportValue
        'Fn::Sub': '${FoundationStack}-VpcId'
      # /api/health 가 아니라 /api/health/ready 를 본다 —
      # health 는 데이터가 없어도 200 이라 결손 이미지를 healthy 로 통과시킨다.
      HealthCheckPath: /api/health/ready
      HealthCheckProtocol: HTTP
      HealthCheckIntervalSeconds: 15
      HealthCheckTimeoutSeconds: 5
      HealthyThresholdCount: 2
      UnhealthyThresholdCount: 3
      Matcher: { HttpCode: '200' }
      TargetGroupAttributes:
        # 기본 300초는 롤링 배포를 태스크당 5분씩 늘린다.
        - { Key: deregistration_delay.timeout_seconds, Value: '30' }

  Listener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      LoadBalancerArn: !Ref LoadBalancer
      Protocol: HTTP
      Port: 80
      DefaultActions: [{ Type: forward, TargetGroupArn: !Ref TargetGroup }]

  # ── ECS ──────────────────────────────────────────────────────────────
  Cluster:
    Type: AWS::ECS::Cluster
    Properties:
      ClusterName: sangseng-cluster
      CapacityProviders: [FARGATE, FARGATE_SPOT]

  TaskDefinition:
    Type: AWS::ECS::TaskDefinition
    Properties:
      Family: sangseng-api
      RequiresCompatibilities: [FARGATE]
      NetworkMode: awsvpc
      Cpu: !Ref TaskCpu
      Memory: !Ref TaskMemory
      RuntimePlatform:
        CpuArchitecture: ARM64      # ⚠ infra/config.sh 의 CPU_ARCHITECTURE 와 일치해야 한다
        OperatingSystemFamily: LINUX
      ExecutionRoleArn: !ImportValue
        'Fn::Sub': '${FoundationStack}-TaskExecutionRoleArn'
      TaskRoleArn: !ImportValue
        'Fn::Sub': '${FoundationStack}-TaskRoleArn'
      ContainerDefinitions:
        - Name: api
          Image: !Sub
            - '${Uri}:${Tag}'
            - Uri: !ImportValue
                'Fn::Sub': '${FoundationStack}-EcrRepositoryUri'
              Tag: !Ref ImageTag
          Essential: true
          PortMappings: [{ ContainerPort: 8000, Protocol: tcp }]
          # 최악 24.5초 LLM 요청이 진행 중일 수 있다. 기본 30초로는 잘린다. (최대 120)
          StopTimeout: 60
          Environment:
            - { Name: APP_ENV, Value: production }
            - { Name: AWS_REGION, Value: !Ref 'AWS::Region' }
            - Name: CARDS_TABLE
              Value: !ImportValue
                'Fn::Sub': '${FoundationStack}-CardsTableName'
            - Name: PROGRESS_RECORDS_TABLE
              Value: !ImportValue
                'Fn::Sub': '${FoundationStack}-ProgressRecordsTableName'
            - { Name: ALLOWED_ORIGINS, Value: !Ref AllowedOrigins }
            - { Name: DEMO_READ_ONLY,  Value: !Ref DemoReadOnly }
            # 감사 지적 M2 — 미전달 시 배포본이 항상 코드 기본값을 쓴다
            - { Name: OPENAI_MODEL,    Value: !Ref OpenAiModel }
          Secrets:
            - Name: OPENAI_API_KEY
              ValueFrom: !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/sangseng/prod/OPENAI_API_KEY
            - Name: MUTATION_API_TOKEN
              ValueFrom: !Sub arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/sangseng/prod/MUTATION_API_TOKEN
          LogConfiguration:
            LogDriver: awslogs
            Options:
              awslogs-group: !ImportValue
                'Fn::Sub': '${FoundationStack}-LogGroupName'
              awslogs-region: !Ref 'AWS::Region'
              awslogs-stream-prefix: ecs

  Service:
    Type: AWS::ECS::Service
    DependsOn: Listener      # 리스너 없이 대상그룹에 등록하면 생성이 실패한다
    Properties:
      ServiceName: sangseng-api
      Cluster: !Ref Cluster
      TaskDefinition: !Ref TaskDefinition
      DesiredCount: !Ref DesiredCount
      CapacityProviderStrategy:
        - { CapacityProvider: FARGATE,      Base: !Ref OnDemandBaseCount, Weight: 0 }
        - { CapacityProvider: FARGATE_SPOT, Weight: 1 }
      DeploymentConfiguration:
        # 새 태스크가 헬스체크를 통과한 뒤에야 구 태스크를 내린다 = 무중단
        MinimumHealthyPercent: 100
        MaximumPercent: 200
        DeploymentCircuitBreaker: { Enable: true, Rollback: true }
      NetworkConfiguration:
        AwsvpcConfiguration:
          # public 서브넷 + public IP = NAT 없이 ECR pull·OpenAI 호출
          AssignPublicIp: ENABLED
          Subnets: !Split
            - ','
            - !ImportValue
              'Fn::Sub': '${FoundationStack}-PublicSubnetIds'
          SecurityGroups: [!Ref TaskSecurityGroup]
      LoadBalancers:
        - { ContainerName: api, ContainerPort: 8000, TargetGroupArn: !Ref TargetGroup }
      # 0.25 vCPU 는 버스트가 없어 기동이 느리다. ENI 프로비저닝 + ECR pull +
      # 타깃 등록 + 헬스체크 2연속 통과까지 여유를 준다.
      HealthCheckGracePeriodSeconds: 120

  # ── API Gateway ──────────────────────────────────────────────────────
  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: sangseng-api
      ProtocolType: HTTP
      # CORS 설정을 두지 않는다 — 모든 호출이 Vercel 서버에서 오는 서버-대-서버라
      # 브라우저 프리플라이트가 발생하지 않는다. 앱(FastAPI)의 ALLOWED_ORIGINS 가 정본이다.

  VpcLink:
    Type: AWS::ApiGatewayV2::VpcLink
    Properties:
      Name: sangseng-vpclink
      # ⚠ immutable — 서브넷·보안그룹 변경은 교체(Replacement)를 유발하고 생성에 수 분 걸린다.
      SubnetIds: !Split
        - ','
        - !ImportValue
          'Fn::Sub': '${FoundationStack}-PrivateSubnetIds'
      SecurityGroupIds: [!Ref VpcLinkSecurityGroup]

  Integration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref HttpApi
      IntegrationType: HTTP_PROXY
      IntegrationMethod: ANY
      ConnectionType: VPC_LINK
      ConnectionId: !Ref VpcLink
      IntegrationUri: !Ref Listener      # 프라이빗 통합의 대상은 ALB 리스너 ARN
      PayloadFormatVersion: '1.0'

  Route:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref HttpApi
      RouteKey: 'ANY /{proxy+}'
      Target: !Sub 'integrations/${Integration}'

  Stage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref HttpApi
      # ⚠ $default 여야 한다. 명명 스테이지를 쓰면 백엔드 경로에 /<stage> 접두사가 붙어
      #   프론트의 모든 경로가 FastAPI 404 가 된다.
      StageName: $default
      AutoDeploy: true
      DefaultRouteSettings:
        # Lambda 의 ReservedConcurrentExecutions=5 를 대체하는 LLM 남용 방어선.
        # 태스크 2대 × anyio 기본 40 스레드 = 최대 80 동시 generate 를 여기서 막는다.
        ThrottlingRateLimit: 10
        ThrottlingBurstLimit: 20

Outputs:
  ApiUrl:
    Description: Vercel 의 NEXT_PUBLIC_API_BASE 에 넣을 값 (끝 슬래시 없이 그대로 복사)
    Value: !Sub 'https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com'
  TaskDefinitionArn:
    Value: !Ref TaskDefinition
  ClusterName:
    Value: !Ref Cluster
  ServiceName:
    Value: !GetAtt Service.Name
```

- [ ] **Step 2: 문법 검증**

Run: `aws --profile sangseng --region ap-northeast-2 cloudformation validate-template --template-body file://infra/cloudformation/service.yaml`
Expected: JSON 응답. Parameters에 `ImageTag`·`DemoReadOnly`가 기본값 없이 나온다

- [ ] **Step 3: preflight 전체 통과 확인 (이제 service.yaml 이 존재한다)**

Run: `./infra/scripts/preflight.sh`
Expected: 1~7단계 전부 통과, 마지막에 `사전 점검 통과`

- [ ] **Step 4: 커밋**

```bash
git add infra/cloudformation/service.yaml
git commit -m "infra: service 스택 — 내부 ALB·ECS Fargate ARM64 Spot·API Gateway VPC Link"
```

---

### Task B6: `deploy-service.sh` — 롤아웃 진위 검증 포함

**Files:**
- Create: `infra/scripts/deploy-service.sh`

**Interfaces:**
- Consumes: Task B4의 이미지 태그, Task B5의 `service.yaml`
- Produces: 배포 완료 후 `ApiUrl` 출력. 서킷 브레이커가 롤백한 경우 **exit 1**.

> **핵심:** 서킷 브레이커가 되돌린 뒤 서비스가 steady state에 도달하면 CloudFormation은 `UPDATE_COMPLETE`로 끝난다. CFN 성공만 믿으면 **구버전이 도는데 배포 성공으로 착각한다.** `rolloutState`와 태스크 정의 리비전을 둘 다 확인해야 한다.

- [ ] **Step 1: 작성**

```bash
#!/usr/bin/env bash
# service 스택 배포 + 롤아웃 진위 검증.
# 사용: deploy-service.sh <이미지태그>
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

TAG="${1:-}"
[ -n "$TAG" ] || die "사용법: deploy-service.sh <이미지태그>"

ECR_URI="$(stack_output "$FOUNDATION_STACK" EcrRepositoryUri)"
log_step "이미지 존재 확인 ($TAG)"
aws_ ecr describe-images --repository-name "$ECR_REPO" --image-ids "imageTag=$TAG" >/dev/null 2>&1 \
  || die "ECR 에 $ECR_REPO:$TAG 가 없습니다. build-and-push.sh 를 먼저 실행하세요.
  (이미지 없이 서비스를 만들면 CannotPullContainerError 로 스택 전체가 롤백됩니다)"
log_ok "존재"

load_env      # 환경변수 우선, .env 폴백 — CI 는 GitHub 저장소 변수로 값을 넘긴다

log_step "service 스택 배포 (첫 생성은 VPC Link 때문에 12~18분 걸립니다)"
if ! cfn_deploy "$SERVICE_STACK" "$REPO_ROOT/infra/cloudformation/service.yaml" \
      "FoundationStack=$FOUNDATION_STACK" \
      "ImageTag=$TAG" \
      "DesiredCount=${DESIRED_COUNT:-2}" \
      "OnDemandBaseCount=${ON_DEMAND_BASE_COUNT:-0}" \
      "DemoReadOnly=${DEMO_READ_ONLY}" \
      "AllowedOrigins=${ALLOWED_ORIGINS:-}" \
      "OpenAiModel=${OPENAI_MODEL:-gpt-4o-mini}"; then
  dump_task_diagnostics
  die "CloudFormation 배포 실패"
fi

log_step "롤아웃 진위 검증"
# 서킷 브레이커가 롤백해도 CFN 은 UPDATE_COMPLETE 로 끝난다 — 실제로 새 리비전이
# 떴는지 rolloutState 와 태스크 정의를 둘 다 본다.
EXPECTED_TD="$(stack_output "$SERVICE_STACK" TaskDefinitionArn)"
read -r STATE ACTUAL_TD <<<"$(aws_ ecs describe-services \
  --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
  --query 'services[0].deployments[0].[rolloutState,taskDefinition]' --output text)"

log_ok "rolloutState=$STATE"
if [ "$STATE" != "COMPLETED" ]; then
  dump_task_diagnostics
  die "롤아웃이 완료되지 않았습니다 (rolloutState=$STATE)"
fi
if [ "$ACTUAL_TD" != "$EXPECTED_TD" ]; then
  dump_task_diagnostics
  die "서킷 브레이커가 롤백했습니다.
  기대: $EXPECTED_TD
  실제: $ACTUAL_TD
  구버전이 돌고 있습니다 — 위 진단을 확인하세요."
fi
log_ok "$ACTUAL_TD"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
printf '\n%sApiUrl: %s%s\n' "$_C_GREEN" "$API_URL" "$_C_RESET"
printf '  Vercel 환경변수 NEXT_PUBLIC_API_BASE 에 이 값을 **끝 슬래시 없이** 넣고 Redeploy 하세요.\n'
printf '  (값만 바꾸고 재배포하지 않으면 빌드 시 인라인된 옛 URL 이 계속 쓰입니다)\n'
```

- [ ] **Step 2: 문법 검사**

Run: `bash -n infra/scripts/deploy-service.sh && chmod +x infra/scripts/deploy-service.sh`
Expected: 출력 없음

- [ ] **Step 3: 커밋** (실제 배포는 Task C1에서)

```bash
git add infra/scripts/deploy-service.sh
git commit -m "infra: service 배포 스크립트 — 서킷 브레이커 롤백을 성공으로 오인하지 않게 검증"
```

---

### Task B7: 검증·운영 스크립트 5종 + `deploy.sh` + `infra/README.md`

**Files:**
- Create: `infra/scripts/smoke-test.sh` · `zero-downtime-check.sh` · `rollback.sh` · `teardown.sh` · `deploy.sh`
- Create: `infra/README.md`

**Interfaces:**
- Consumes: Task B1~B6 전부
- Produces: `./infra/scripts/deploy.sh` 단일 진입점

- [ ] **Step 1: `smoke-test.sh`**

```bash
#!/usr/bin/env bash
# 배포 후 검증. 상태를 바꾸지 않는 호출만 쓴다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
[ -n "$API_URL" ] && [ "$API_URL" != "None" ] || die "ApiUrl 을 읽지 못했습니다."
load_env
# CI 에는 .env 가 없다 — 토큰 정본인 SSM 에서 직접 읽어 로컬과 똑같은 검증을 한다.
if [ -z "${MUTATION_API_TOKEN:-}" ]; then
  MUTATION_API_TOKEN="$(aws_ ssm get-parameter --name "$SSM_PREFIX/MUTATION_API_TOKEN" \
    --with-decryption --query 'Parameter.Value' --output text)" \
    || die "SSM 에서 MUTATION_API_TOKEN 을 읽지 못했습니다."
fi

log_step "1. /api/health — 정적 산출물 적재"
BODY="$(curl -fsS --max-time 20 "$API_URL/api/health")" || die "health 호출 실패"
echo "$BODY" | python3 -c '
import json,sys
b=json.load(sys.stdin)
assert b["data_loaded"] is True, "data_loaded=false — 이미지에 data/processed 가 안 실렸습니다"
missing=[k for k,v in b["datasets"].items() if not v]
assert not missing, f"결손 산출물: {missing}"
print("  datasets:", ", ".join(b["datasets"]))
print("  demo_read_only:", b["demo_read_only"])
' || die "health 본문 검증 실패"
log_ok "health 보고 산출물 전부 적재"

log_step "1-1. /api/dashboard — health 가 보고하지 않는 산출물까지 확인"
# usage_daily·usage_monthly 는 health 의 datasets 에 안 들어 있다. 실제 라우트를 한 번 때려야
# "health 는 초록인데 화면은 500" 인 상태를 잡을 수 있다.
curl -fsS --max-time 20 "$API_URL/api/dashboard" >/dev/null || die "dashboard 호출 실패 — 산출물 결손 가능"
log_ok "200"

log_step "2. /api/health/ready — ALB 대상그룹이 보는 경로"
CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL/api/health/ready")"
[ "$CODE" = "200" ] || die "ready 가 $CODE"
log_ok "200"

log_step "3. 스테이지 접두사 확인 (P0)"
# \$default 스테이지가 아니면 백엔드 경로에 /<stage> 가 붙어 전 API 가 404 가 된다.
# health 가 200 이라는 것 자체가 접두사가 안 붙었다는 증거다.
log_ok "/api/health 가 200 — 스테이지 접두사 없음"

log_step "4. Authorization 헤더 전달 (P0)"
# 담당자 전용 GET — 토큰이 필요하면서 상태를 바꾸지 않는 유일한 계열이다.
# 변경 API 로 확인하면 데모 시드가 오염된다.
NO_TOKEN="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 "$API_URL/api/progress-report" || true)"
WITH_TOKEN="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer ${MUTATION_API_TOKEN}" "$API_URL/api/progress-report" || true)"
[ "$NO_TOKEN" = "401" ] || log_warn "토큰 없이 $NO_TOKEN (401 기대) — 경계 확인 필요"
[ "$WITH_TOKEN" = "200" ] \
  || die "토큰을 넣었는데 $WITH_TOKEN — API Gateway 가 Authorization 헤더를 백엔드로 전달하지 않고 있습니다."
log_ok "무토큰 $NO_TOKEN / 유토큰 $WITH_TOKEN"

log_step "5. DynamoDB Gateway Endpoint 실사용 확인 (P0)"
# 태스크에 퍼블릭 IP 가 있어서 엔드포인트가 잘못 연결돼도 DynamoDB 호출은 IGW 경유로
# 그냥 성공한다 — 장애가 안 나서 더 위험하다. 라우트 주입을 직접 본다.
PL="$(aws_ ec2 describe-route-tables --filters "Name=tag:Name,Values=sangseng-public" \
  --query "RouteTables[0].Routes[?starts_with(DestinationPrefixListId, 'pl-')].GatewayId" --output text)"
[ -n "$PL" ] && [ "$PL" != "None" ] \
  || die "public 라우트 테이블에 DynamoDB prefix list 경로가 없습니다 — '프라이빗 경로' 주장이 성립하지 않습니다."
log_ok "$PL"

printf '\n%s스모크 테스트 통과 — %s%s\n' "$_C_GREEN" "$API_URL" "$_C_RESET"
```

- [ ] **Step 2: `zero-downtime-check.sh`**

```bash
#!/usr/bin/env bash
# 배포와 **동시에** 별도 터미널에서 실행한다. Ctrl-C 로 멈추면 집계를 출력한다.
#   터미널1: ./infra/scripts/zero-downtime-check.sh
#   터미널2: ./infra/scripts/deploy.sh
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

API_URL="$(stack_output "$SERVICE_STACK" ApiUrl)"
TOTAL=0; FAIL=0; MAXMS=0

report() {
  printf '\n─── 무중단 측정 결과 ───\n'
  printf '  총 요청 : %d\n  실패    : %d\n  최대지연: %d ms\n' "$TOTAL" "$FAIL" "$MAXMS"
  if [ "$FAIL" -eq 0 ]; then
    printf '%s  무중단 확인 — 배포 전 구간에서 실패 0건%s\n' "$_C_GREEN" "$_C_RESET"
  else
    printf '%s  실패 %d건 발생 — 무중단이 성립하지 않았습니다%s\n' "$_C_RED" "$FAIL" "$_C_RESET"
  fi
  exit 0
}
trap report INT TERM

printf '%s0.5초 간격 폴링 시작 (%s). 배포가 끝나면 Ctrl-C%s\n' "$_C_BLUE" "$API_URL" "$_C_RESET"
while true; do
  MS="$(curl -fsS -o /dev/null -w '%{time_total}' --max-time 10 "$API_URL/api/health" 2>/dev/null \
        | awk '{printf "%d", $1*1000}')" || MS=""
  TOTAL=$((TOTAL + 1))
  if [ -z "$MS" ]; then
    FAIL=$((FAIL + 1)); printf '%s✗%s' "$_C_RED" "$_C_RESET"
  else
    [ "$MS" -gt "$MAXMS" ] && MAXMS="$MS"
    printf '.'
  fi
  sleep 0.5
done
```

- [ ] **Step 3: `rollback.sh`**

```bash
#!/usr/bin/env bash
# CloudFormation 을 기다리지 않고 직전 태스크 정의 리비전으로 되돌린다 (수십 초).
# 되돌린 뒤 CFN 과 상태가 어긋나므로, 원인을 고친 다음 정상 배포로 정리한다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

CURRENT="$(aws_ ecs describe-services --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME" \
  --query 'services[0].taskDefinition' --output text)"
REVISION="${CURRENT##*:}"
FAMILY="${CURRENT%:*}"; FAMILY="${FAMILY##*/}"
[ "$REVISION" -gt 1 ] || die "리비전이 1뿐이라 되돌릴 대상이 없습니다."

PREVIOUS="${FAMILY}:$((REVISION - 1))"
log_step "$CURRENT → $PREVIOUS 로 되돌립니다"
read -r -p "  계속할까요? [y/N] " ans
[ "$ans" = "y" ] || die "취소"

aws_ ecs update-service --cluster "$CLUSTER_NAME" --service "$SERVICE_NAME" \
  --task-definition "$PREVIOUS" >/dev/null
log_step "안정화 대기"
aws_ ecs wait services-stable --cluster "$CLUSTER_NAME" --services "$SERVICE_NAME"
log_ok "$PREVIOUS 로 복귀 완료"
log_warn "CloudFormation 과 상태가 어긋나 있습니다 — 원인을 고친 뒤 deploy.sh 로 정리하세요."
```

- [ ] **Step 4: `teardown.sh`**

```bash
#!/usr/bin/env bash
# 역순 철거. VPC Link 삭제와 ENI 정리가 느려 서브넷·SG 삭제가 실패할 수 있으므로 재시도한다.
# ⚠ 심사·전시가 끝나기 전에는 실행하지 않는다 (docs/plan/12 §6).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

printf '%s이 작업은 되돌릴 수 없습니다.%s\n' "$_C_RED" "$_C_RESET"
printf '  삭제: %s, %s\n' "$SERVICE_STACK" "$FOUNDATION_STACK"
printf '  보존: DynamoDB 테이블 2개 (DeletionPolicy: Retain — 카드 데이터가 남습니다)\n'
read -r -p "  스택 이름을 입력해 확인하세요 [$SERVICE_STACK]: " ans
[ "$ans" = "$SERVICE_STACK" ] || die "취소"

log_step "1. service 스택 삭제 (VPC Link 때문에 10분 이상 걸릴 수 있습니다)"
aws_ cloudformation delete-stack --stack-name "$SERVICE_STACK"
aws_ cloudformation wait stack-delete-complete --stack-name "$SERVICE_STACK" || true
log_ok "완료"

log_step "2. foundation 스택 삭제 (ENI 정리 지연 시 최대 3회 재시도)"
for i in 1 2 3; do
  aws_ cloudformation delete-stack --stack-name "$FOUNDATION_STACK"
  if aws_ cloudformation wait stack-delete-complete --stack-name "$FOUNDATION_STACK" 2>/dev/null; then
    log_ok "완료"; break
  fi
  log_warn "시도 $i 실패 — 60초 후 재시도 (ENI 정리 대기)"
  sleep 60
done

log_warn "DynamoDB 테이블 2개는 남아 있습니다. 정말 지우려면:"
printf '  aws --profile %s --region %s dynamodb delete-table --table-name sangseng-cards\n' "$AWS_PROFILE" "$AWS_REGION"
printf '  aws --profile %s --region %s dynamodb delete-table --table-name sangseng-progress-records\n' "$AWS_PROFILE" "$AWS_REGION"
```

- [ ] **Step 5: `deploy.sh`**

```bash
#!/usr/bin/env bash
# 전체 배포 오케스트레이션.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

"$SCRIPT_DIR/preflight.sh"
"$SCRIPT_DIR/put-secrets.sh"
"$SCRIPT_DIR/deploy-foundation.sh"
TAG="$("$SCRIPT_DIR/build-and-push.sh" | tail -1)"
"$SCRIPT_DIR/deploy-service.sh" "$TAG"
"$SCRIPT_DIR/smoke-test.sh"

printf '\n%s배포 완료%s\n' "$_C_GREEN" "$_C_RESET"
```

- [ ] **Step 6: `infra/README.md`**

````markdown
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
````

- [ ] **Step 7: 문법 검사·커밋**

Run: `bash -n infra/scripts/smoke-test.sh infra/scripts/zero-downtime-check.sh infra/scripts/rollback.sh infra/scripts/teardown.sh infra/scripts/deploy.sh`
Expected: 출력 없음

Run: `chmod +x infra/scripts/*.sh`

```bash
git add infra/scripts/ infra/README.md
git commit -m "infra: 스모크·무중단측정·롤백·철거 스크립트와 배포 오케스트레이션"
```

---

### Task B8: SAM 잔재 삭제

**Files:**
- Delete: `infra/template.yaml` · `infra/deploy-backend.sh` · `infra/.aws-sam/`
- Modify: `.gitignore:19-25`

**Interfaces:**
- Consumes: Task B1~B7 (대체 경로가 전부 존재해야 한다)
- Produces: 없음

- [ ] **Step 1: 대체 경로 존재 확인**

Run: `ls infra/config.sh infra/cloudformation/foundation.yaml infra/cloudformation/service.yaml infra/scripts/deploy.sh infra/README.md`
Expected: 5개 전부 존재

- [ ] **Step 2: 삭제**

```bash
git rm infra/template.yaml infra/deploy-backend.sh
rm -rf infra/.aws-sam
```

- [ ] **Step 3: `.gitignore` 정리**

19-25행의 `# aws sam` 섹션(`infra/.aws-sam/`, `samconfig.toml.bak`) 삭제.
**`backend/app/data/` 무시 규칙은 반드시 유지한다** — 커밋되면 정적 산출물의 원본이 둘이 된다.

- [ ] **Step 4: 잔재 확인**

Run: `git status --short && ls infra/`
Expected: `infra/`에 `README.md` `config.sh` `cloudformation/` `scripts/` 만

Run: `grep -rn "deploy-backend.sh\|infra/template.yaml\|\.aws-sam" --include="*.sh" --include="*.yml" --include="*.yaml" . | grep -v node_modules`
Expected: 출력 없음 (문서는 Phase D에서 처리)

- [ ] **Step 5: 커밋**

```bash
git add -A infra .gitignore
git commit -m "infra: SAM 템플릿·배포 스크립트·빌드 산출물 제거"
```

---

# Phase C — 실배포와 실증

### Task C1: 첫 배포 + P0 4건 실증

**Files:** 없음 (실행만)

**Interfaces:**
- Consumes: Phase A·B 전부
- Produces: 동작하는 `ApiUrl`. 실증 결과는 Task D1의 09 문서에 기록한다.

> 이 태스크의 산출물은 코드가 아니라 **검증된 사실**이다. 실패하면 원인을 기록하고 해당 Task로 돌아간다.

- [ ] **Step 1: 무중단 측정을 먼저 띄운다 (별도 터미널)**

첫 배포에는 기존 태스크가 없어 측정 대상이 없다. **첫 배포에서는 생략**하고, Step 6의 두 번째 배포에서 실행한다.

- [ ] **Step 2: 첫 배포**

Run: `./infra/scripts/deploy.sh`
Expected: 20~30분 후 `배포 완료`, `ApiUrl` 출력

실패 시: 출력된 진단 덤프(`stoppedReason`·서비스 이벤트)를 근거로 `infra/README.md`의 트러블슈팅 표를 따른다.

- [ ] **Step 3: P0 실증 4건 결과 기록**

`smoke-test.sh`가 1~5를 자동 검증한다. 통과 결과를 그대로 옮겨 적는다:

| # | 확인 | 결과 |
|---|---|---|
| 1 | `$default` 스테이지에 스테이지 접두사 없음 | `/api/health` 200 |
| 2 | API Gateway가 `Authorization` 전달 | 무토큰 401 / 유토큰 200 |
| 3 | DynamoDB Gateway Endpoint 실사용 | prefix list 경로 존재 |
| 4 | 퍼블릭 IPv4 과금 | Billing 콘솔에서 `PublicIPv4:InUseAddress` 항목 확인 |

- [ ] **Step 4: Vercel 연결**

1. Vercel 대시보드 → Settings → Environment Variables → `NEXT_PUBLIC_API_BASE` = `ApiUrl` (끝 슬래시 없이)
2. `API_MUTATION_TOKEN` = `.env`의 `MUTATION_API_TOKEN`과 동일 값
3. `NEXT_PUBLIC_DEMO_READ_ONLY` = `.env`의 `DEMO_READ_ONLY`와 동일 값
4. **Redeploy**

- [ ] **Step 5: Vercel 리전 실측 (Task A5의 검증)**

Run: `curl -sI https://<프로젝트>.vercel.app/ | grep -i x-vercel-id`
Expected: `icn1` 접두사. `iad1`이면 Vercel 대시보드 Settings → Functions → Function Regions에서 직접 지정

- [ ] **Step 6: CORS 좁히기 + 무중단 실측 (두 번째 배포)**

1. `.env`의 `ALLOWED_ORIGINS`에 확정된 Vercel 도메인 기입
2. 터미널1: `./infra/scripts/zero-downtime-check.sh`
3. 터미널2: `./infra/scripts/deploy.sh`
4. 배포 완료 후 터미널1에서 Ctrl-C

Expected: **실패 0건**. 이 숫자를 09 문서와 발표 자료에 인용한다

- [ ] **Step 7: 데모 시드**

Run:
```bash
cd backend && CARDS_TABLE=sangseng-cards PROGRESS_RECORDS_TABLE=sangseng-progress-records \
  AWS_PROFILE=sangseng AWS_DEFAULT_REGION=ap-northeast-2 python seed_demo.py --reset
```
Expected: 카드 5장 + 추진 기록 9건

Run: `curl -s "$API_URL/api/cards" | python3 -m json.tool | head -20`
Expected: 시드된 카드 반환 — **DynamoDB 접근·IAM·엔드포인트가 전부 정상이라는 증거**

- [ ] **Step 8: 실증 결과를 커밋 메시지에 남긴다**

```bash
git commit --allow-empty -m "infra: 첫 ECS 배포 성공 — P0 4건 실증 통과, 무중단 배포 실패 0건"
```

---

### Task C2: GitHub Actions 자동 배포 (main 머지 → 배포)

**Files:**
- Create: `infra/scripts/bootstrap-github-oidc.sh`
- Create: `.github/workflows/pr-checks.yml`
- Create: `.github/workflows/backend-deploy.yml`
- Modify: `infra/README.md` (CI 절 추가)

**Interfaces:**
- Consumes: Task C1이 배포해 둔 foundation·service 스택과 ECR 이미지. **CI는 "갱신"만 한다** — 첫 생성은 Task C1의 수동 배포가 이미 끝냈어야 한다.
- Produces: `main` 머지 시 백엔드가 자동 배포된다. 프론트는 Vercel git 연동이 이미 담당한다.

> **왜 service 스택만 자동화하는가.** CI가 VPC·DynamoDB 테이블을 건드릴 수 있으면 사고 규모가 달라진다. foundation은 거의 바뀌지 않는 계층이라 수동으로 남겨도 손해가 없다.
>
> **왜 OIDC인가.** 저장소에 AWS 장기 액세스 키를 두지 않는다. GitHub이 발급한 단기 토큰으로 역할을 맡고, 신뢰 정책이 `main` 브랜치로 제한한다. 실제 시크릿(OpenAI 키·mutation 토큰)은 이미 SSM에 있어 CI가 알 필요조차 없다.
>
> **레포가 public이라 유리하다.** Actions 실행 시간이 무제한이고 **ARM64 러너를 무료로 쓴다** — 이미지가 ARM64라 x86 러너였으면 QEMU 에뮬레이션이 필요했다.

- [ ] **Step 1: OIDC 부트스트랩 스크립트 작성**

`infra/scripts/bootstrap-github-oidc.sh`:

```bash
#!/usr/bin/env bash
# 1회용 — GitHub Actions 가 AWS 역할을 맡을 수 있게 OIDC 공급자와 배포 역할을 만든다.
# 장기 액세스 키를 저장소에 두지 않기 위한 구성이다.
#
# ⚠ IAM 자원을 만든다. 내용을 확인한 뒤 직접 실행할 것.
# 되돌리기:
#   aws iam delete-role-policy --role-name sangseng-github-deploy --policy-name PassTaskRoles
#   aws iam detach-role-policy --role-name sangseng-github-deploy --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
#   aws iam delete-role --role-name sangseng-github-deploy
#   aws iam delete-open-id-connect-provider --open-id-connect-provider-arn <위 출력의 ARN>
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh"
source "$SCRIPT_DIR/lib/common.sh"

GH_REPO="yutakdv/sangseng-navigator"
ROLE_NAME="sangseng-github-deploy"
ACCOUNT="$(aws_ sts get-caller-identity --query Account --output text)"
PROVIDER_ARN="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

log_step "1. OIDC 공급자"
if aws_ iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" >/dev/null 2>&1; then
  log_ok "이미 존재"
else
  # thumbprint 는 AWS 가 신뢰된 루트 CA 로 검증하므로 값 자체는 형식만 맞으면 된다.
  aws_ iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
  log_ok "생성됨"
fi

log_step "2. 배포 역할 ($ROLE_NAME)"
TRUST="$(mktemp)"
cat > "$TRUST" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${PROVIDER_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:${GH_REPO}:ref:refs/heads/main"
      }
    }
  }]
}
JSON
if aws_ iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  aws_ iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "file://$TRUST"
  log_ok "신뢰 정책 갱신"
else
  aws_ iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "file://$TRUST" \
    --description "GitHub Actions deploy for ${GH_REPO} (main only)" >/dev/null
  log_ok "생성됨"
fi
rm -f "$TRUST"

log_step "3. 권한 부착"
aws_ iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
PASS="$(mktemp)"
cat > "$PASS" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PassTaskRolesToEcs",
    "Effect": "Allow",
    "Action": ["iam:PassRole", "iam:GetRole"],
    "Resource": "arn:aws:iam::${ACCOUNT}:role/sangseng-*",
    "Condition": { "StringEqualsIfExists": { "iam:PassedToService": "ecs-tasks.amazonaws.com" } }
  }]
}
JSON
aws_ iam put-role-policy --role-name "$ROLE_NAME" --policy-name PassTaskRoles \
  --policy-document "file://$PASS"
rm -f "$PASS"
log_ok "PowerUserAccess + PassTaskRoles"

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"
printf '\n%s역할 ARN: %s%s\n' "$_C_GREEN" "$ROLE_ARN" "$_C_RESET"
printf '\n다음 명령으로 GitHub 저장소 변수를 등록하세요 (시크릿 아님 — 전부 비민감 값):\n\n'
printf '  gh variable set AWS_DEPLOY_ROLE_ARN --body "%s"\n' "$ROLE_ARN"
printf '  gh variable set DEMO_READ_ONLY       --body "<true|false>"\n'
printf '  gh variable set ALLOWED_ORIGINS      --body "https://<vercel-도메인>"\n'
printf '  gh variable set OPENAI_MODEL         --body "gpt-4o-mini"\n'
printf '  gh variable set DESIRED_COUNT        --body "2"\n'
printf '  gh variable set ON_DEMAND_BASE_COUNT --body "1"\n'
```

- [ ] **Step 2: 스크립트 문법 검사 후 사용자에게 실행 요청**

Run: `bash -n infra/scripts/bootstrap-github-oidc.sh && chmod +x infra/scripts/bootstrap-github-oidc.sh`
Expected: 출력 없음

**이 스크립트는 IAM 자원을 만들므로 에이전트가 직접 실행하지 않는다.** 사용자에게 파일 경로와 하는 일을 알리고 실행을 요청한 뒤, 출력된 역할 ARN과 저장소 변수 등록 완료를 확인받는다.

확인 명령:

Run: `gh variable list`
Expected: `AWS_DEPLOY_ROLE_ARN`·`DEMO_READ_ONLY`·`ALLOWED_ORIGINS`·`OPENAI_MODEL`·`DESIRED_COUNT`·`ON_DEMAND_BASE_COUNT` 6종

- [ ] **Step 3: PR 검증 워크플로**

`.github/workflows/pr-checks.yml`:

```yaml
name: PR 검증

on:
  pull_request:
    branches: [main]

# 포크 PR 에서도 안전하게 돌도록 자격증명이 필요한 단계를 두지 않는다.
# ⚠ pull_request_target 은 절대 쓰지 않는다 — 포크의 코드를 시크릿과 함께 실행하게 된다.
permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-24.04-arm      # public 레포는 ARM 러너 무료. 실패하면 ubuntu-latest 로 바꾼다
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r backend/requirements.txt -r backend/requirements-dev.txt
      - run: python -m pytest -q
        working-directory: backend

  templates:
    runs-on: ubuntu-24.04-arm
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      # AWS 자격증명 없이 검사한다 — cfn-lint 는 CI 전용이고 프로젝트 의존성이 아니다.
      - run: pip install cfn-lint
      - run: cfn-lint infra/cloudformation/foundation.yaml infra/cloudformation/service.yaml
      - run: bash -n infra/config.sh infra/scripts/*.sh infra/scripts/lib/*.sh

  frontend:
    runs-on: ubuntu-24.04-arm
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run check:banned
      - run: npm run build
```

- [ ] **Step 4: 배포 워크플로**

`.github/workflows/backend-deploy.yml`:

```yaml
name: 백엔드 배포

on:
  push:
    branches: [main]
    # 문서만 고친 머지로 컨테이너가 재배포되지 않게 경로를 좁힌다.
    paths:
      - 'backend/**'
      - 'data/processed/**'
      - 'infra/cloudformation/service.yaml'
      - 'infra/config.sh'
      - 'infra/scripts/**'
      - '.github/workflows/backend-deploy.yml'
  workflow_dispatch:      # 경로 필터에 안 걸린 변경을 밀 때 수동 실행

permissions:
  id-token: write         # OIDC 토큰 발급에 필요
  contents: read

# 배포는 겹치면 안 되고, 진행 중인 배포를 중간에 끊어서도 안 된다.
concurrency:
  group: backend-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-24.04-arm     # 이미지가 ARM64 — 네이티브 빌드 (public 레포 무료)
    steps:
      - uses: actions/checkout@v4

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ap-northeast-2

      - name: 사전 점검
        env:
          DEMO_READ_ONLY: ${{ vars.DEMO_READ_ONLY }}
        run: ./infra/scripts/preflight.sh

      - name: 빌드 · 배포
        env:
          DEMO_READ_ONLY:       ${{ vars.DEMO_READ_ONLY }}
          ALLOWED_ORIGINS:      ${{ vars.ALLOWED_ORIGINS }}
          OPENAI_MODEL:         ${{ vars.OPENAI_MODEL }}
          DESIRED_COUNT:        ${{ vars.DESIRED_COUNT }}
          ON_DEMAND_BASE_COUNT: ${{ vars.ON_DEMAND_BASE_COUNT }}
        run: |
          set -euo pipefail
          TAG="$(./infra/scripts/build-and-push.sh | tail -1)"
          ./infra/scripts/deploy-service.sh "$TAG"

      - name: 스모크 테스트
        run: ./infra/scripts/smoke-test.sh
```

> `deploy-service.sh`가 `rolloutState`와 태스크 정의 리비전을 대조하므로, 서킷 브레이커가 되돌린 배포는 **워크플로가 빨간불로 끝난다.** CloudFormation 성공만 보고 초록불이 되는 함정을 CI에서도 피한다.

- [ ] **Step 5: `infra/README.md`에 CI 절 추가**

`## 배포` 절 아래에 삽입:

````markdown
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

> 나중에 "머지 후 사람이 한 번 더 승인" 게이트를 붙이려면 deploy job 에 
> `environment: production` 을 추가하고 **OIDC 신뢰 정책의 `sub` 를
> `repo:…:environment:production` 으로 함께 바꿔야 한다** — environment 를 쓰면
> 토큰의 subject 가 브랜치 형식에서 환경 형식으로 바뀌기 때문이다. 한쪽만 바꾸면 인증이 깨진다.
````

- [ ] **Step 6: 실제 동작 확인**

Run: `git push -u origin feat/ecs-infra && gh pr create --base main --title "infra: ECS Fargate 무중단 배포 이전" --body "설계 스펙: docs/superpowers/specs/2026-08-10-ecs-infra-design.md"`
Expected: PR 생성

Run: `gh pr checks --watch`
Expected: `backend`·`templates`·`frontend` 3개 job 전부 통과

머지 후:

Run: `gh run watch`
Expected: `백엔드 배포` 워크플로가 사전 점검 → 빌드·배포 → 스모크 테스트까지 완주

- [ ] **Step 7: 커밋**

```bash
git add .github/workflows infra/scripts/bootstrap-github-oidc.sh infra/README.md
git commit -m "infra: GitHub Actions 자동 배포 — main 머지 시 OIDC 로 배포, PR 은 검증만"
```

---

# Phase D — 문서

### Task D1: `09-deployment.md` 전면 재작성 + 실 배포 아키텍처 절

**Files:**
- Rewrite: `docs/plan/09-deployment.md`

**Interfaces:**
- Consumes: Task C1의 실증 결과
- Produces: 배포 정본 문서. 다른 문서들이 이 문서를 참조한다.

- [ ] **Step 1: 기존 문서 구조를 유지하되 내용을 전면 교체**

절 구성:
1. **구성 요약 + 구조도** — §1 아키텍처 다이어그램(스펙 §1 그대로)
2. **§1 백엔드 — ECS Fargate** — 2스택 구성, 리소스 목록, AZ 고정 이유, 배포 절차(`deploy.sh`), 소요 시간 표
3. **§2 프론트엔드 — Vercel** — 환경변수 4종 + **`vercel.json` 리전 설정**과 `x-vercel-id` 실측
4. **§3 비용** — 스펙 §7의 표를 그대로. **"사실상 $0" 서술 전면 삭제**, "월 $30 수준, 상한 $42" + 프리티어 미적용(조직 계정) 명시
5. **§4 무중단 배포** — 롤링 메커니즘, 종료 타이밍 예산 표, **서킷 브레이커 한계 2가지**, Task C1의 실측 결과
5-1. **§4-1 자동 배포(CI)** — 워크플로 2종(PR 검증 / `main` 머지 배포), OIDC 역할과 신뢰 정책,
   경로 필터, **service 스택만 자동화하고 foundation 은 수동으로 두는 이유**, 로컬 `deploy.sh` 와의 관계
6. **§5 마무리 조이기** — `ALLOWED_ORIGINS` 좁히기, `DEMO_READ_ONLY`/`MUTATION_API_TOKEN` 짝, 그리고
   **토큰 교체 절차**를 순서까지 못박는다:

   ```
   ① ./infra/scripts/put-secrets.sh          (SSM 값 갱신)
   ② aws ecs update-service --cluster sangseng-cluster --service sangseng-api \
        --force-new-deployment --profile sangseng --region ap-northeast-2
   ③ Vercel 환경변수 API_MUTATION_TOKEN 갱신 → Redeploy
   ```

   **②를 빠뜨리면 반영되지 않는다** — ECS `secrets`는 컨테이너 기동 시 1회만 주입되므로
   SSM 값을 바꿔도 도는 태스크는 옛 토큰을 계속 쓴다. ②와 ③ 사이에는 FE·BE 토큰이
   어긋나 변경 API 가 401 이 되는 짧은 구간이 있다 — 데모 중에는 하지 않는다.
7. **§5.5 심사 기간 운영** — 시드 리셋, `ON_DEMAND_BASE_COUNT=1` 전환, **VPC Link 60일 INACTIVE 주의**, Vercel Password Protection OFF
8. **§6 철거** — `teardown.sh`, DynamoDB Retain
9. **§7 실 배포 수준 아키텍처(승격 경로)** — 스펙 §13 전체
10. **§8 알려진 리스크** — boto3 resource 스레드 안전성(스펙 §6-4)
11. **트러블슈팅 표** — `infra/README.md`와 동일 내용

- [ ] **Step 2: 대체 사실 명기**

문서 머리말에 추가:

```markdown
> **2026-08-10 — SAM(Lambda + Mangum) 구성에서 ECS Fargate 로 전면 이전했다.**
> 이전 구성에 대한 서술은 `docs/audit/`·`docs/review/` 에 작성 시점의 기록으로 남아 있으며
> 그 문서들은 사실 기록이므로 수정하지 않는다. 현재 배포 정본은 이 문서다.
```

- [ ] **Step 3: 검증**

Run: `grep -n "sam \|SAM\|Lambda\|Mangum\|사실상 \$0\|월 \$1 미만" docs/plan/09-deployment.md`
Expected: 이전 구성을 **역사적으로 언급하는 곳**(머리말) 외에는 출력 없음

- [ ] **Step 4: 커밋**

```bash
git add docs/plan/09-deployment.md
git commit -m "docs: 09 배포 문서 전면 재작성 — ECS Fargate 정본 + 실 배포 아키텍처 절"
```

---

### Task D2: `02` · `07` · `14` 재작성

**Files:**
- Modify: `docs/plan/02-architecture.md:13-20,27,33,35-48,100-106`
- Modify: `docs/plan/07-backend-ai-tasks.md:3-13,24-31,35,39-41,75,84-90,109,113,254-262,307,343,459`
- Modify: `docs/plan/14-execution-plan.md:19,31,173,288-323`

**Interfaces:**
- Consumes: Task D1의 09 문서
- Produces: 없음

- [ ] **Step 1: `02-architecture.md`**

- 전체 구조도의 런타임 부분을 `Lambda + Mangum` → `ECS Fargate(ARM64 Spot) + 내부 ALB + API Gateway VPC Link`
- 설계 결정 표: `BE = Lambda + HTTP API` → `BE = ECS Fargate + 내부 ALB + HTTP API(VPC Link)`, `IaC = AWS SAM` → `IaC = CloudFormation(순수)`
- 비용표 6행을 09 §3과 **동일한 수치**로 교체
- `종료 후 sam delete` → `종료 후 ./infra/scripts/teardown.sh`
- 보안 절: NoEcho 파라미터 → SSM SecureString, CORS 2층 → **서버-대-서버라 CORS 무관, 경계는 내부 ALB + SG**

- [ ] **Step 2: `07-backend-ai-tasks.md`**

- 머리말 `FastAPI 하나로 로컬(uvicorn)과 Lambda(Mangum)를 겸한다` → `FastAPI 를 로컬·컨테이너 양쪽에서 uvicorn 으로 동일하게 실행한다`
- 의존성 원칙: mangum 제거, uvicorn을 런타임으로, 근거를 `Lambda 번들 크기·콜드스타트` → `이미지 크기·빌드 시간`
- `main.py = handler = Mangum(app)` 서술 삭제
- 254-343행의 타임아웃 예산: **숫자 24.5초는 유지**, 근거만 `Lambda 30초` → `API Gateway HTTP API 통합 타임아웃 30초(증액 불가)`
- provider 분기 서술에서 Anthropic 제거

- [ ] **Step 3: `14-execution-plan.md`**

- Global Constraints의 `개발 중 AWS 배포 금지 — sam deploy는 T17에서만` → `개발 중 AWS 배포 금지 — ./infra/scripts/deploy.sh 는 T17에서만`
- Phase 1 완료표의 `infra SAM 템플릿(sam validate·build 통과)` → `infra CloudFormation 2스택(validate-template 통과)`
- 288-323행 T17 배포 시퀀스를 09 §1 절차로 교체

- [ ] **Step 4: 검증**

Run: `grep -n "SAM\|Lambda\|Mangum\|sam deploy\|sam build" docs/plan/02-architecture.md docs/plan/07-backend-ai-tasks.md docs/plan/14-execution-plan.md`
Expected: 출력 없음

- [ ] **Step 5: 커밋**

```bash
git add docs/plan/02-architecture.md docs/plan/07-backend-ai-tasks.md docs/plan/14-execution-plan.md
git commit -m "docs: 아키텍처·백엔드·실행계획 문서를 ECS 구성으로 갱신"
```

---

### Task D3: 나머지 문서 갱신 + 비용 서사 7곳

**Files:**
- Modify: `CLAUDE.md:15,19,36-39,64-65,68` · `README.md:103-105` · `.env.example`
- Modify: `docs/plan/01-overview.md:74` · `03:30,34,40,63-65` · `04:13,138-139,150,176,185` · `05:11,591,640,647` · `08:182-184` · `10:22,35,80,88-90` · `11:119` · `12:25,27,28,69,71,74,96,102` · `20` · `21:112-115,122,192,196` · `22:25,182,184` · `README.md`

**Interfaces:**
- Consumes: Task D1의 09 문서 (비용·구성 수치의 단일 출처)
- Produces: 없음

> **비용 서사는 7곳에서 거짓이 된다.** 특히 `01-overview.md:74`는 **프로젝트 성공 기준**이라 그대로 두면 구조적으로 미달 판정이 난다.

- [ ] **Step 1: `CLAUDE.md`**

- 15행 레포 구조: `backend/    FastAPI (Lambda+Mangum) — app/main.py 이 진입점` → `backend/    FastAPI (ECS Fargate, uvicorn) — app/main.py 이 진입점`
- 19행: `infra/      SAM 템플릿(template.yaml) + BE 배포 스크립트` → `infra/      CloudFormation 2스택 + BE 배포 스크립트 (FE는 Vercel git 연동)`
- 36-39행 자주 쓰는 명령: `cd infra && ./deploy-backend.sh` → `./infra/scripts/deploy.sh`
- 64-65행: Task A1에서 이미 수정됨 (provider 규칙)
- 68행 BE 정적 데이터 로딩 서술의 `Lambda: app/data/` → `컨테이너: app/data/`

- [ ] **Step 2: `README.md` 103-105행**

```markdown
- **기술 스택**: FastAPI on AWS ECS Fargate + 내부 ALB + API Gateway(HTTP API) + DynamoDB (CloudFormation)
- **배포**: Vercel(FE, 서울 리전) + AWS ECS(BE, ap-northeast-2) — 배포 중 무중단(롤링 + 서킷 브레이커)
```

- [ ] **Step 3: `.env.example`**

- `RESERVED_CONCURRENCY` 항목 **삭제**(Lambda 전용). 대체 서술을 `ALLOWED_ORIGINS` 근처에 추가:
  `# LLM 남용 방어는 API Gateway 스테이지 스로틀링(rate 10 / burst 20)이 담당한다 — infra/cloudformation/service.yaml`
- `ALLOWED_ORIGINS` 설명의 `deploy-backend.sh가 SAM 파라미터 AllowedOrigins로 넘긴다` → `deploy-service.sh 가 CloudFormation 파라미터 AllowedOrigins 로 넘긴다`
- `NEXT_PUBLIC_API_BASE` 설명의 `SAM Outputs의 ApiUrl` → `service 스택 Outputs 의 ApiUrl`
- `CARDS_TABLE` 기본값 안내를 `sangseng-cards` 고정으로, `PROGRESS_RECORDS_TABLE`을 `sangseng-progress-records`로
- 신규 추가:

```
# 배포 규모 조정 (선택 — 비우면 service.yaml 기본값)
# DESIRED_COUNT=2            상시 태스크 수
# ON_DEMAND_BASE_COUNT=0     Spot 부족 대비 온디맨드 최소 대수. 심사 기간에는 1 권장
DESIRED_COUNT=
ON_DEMAND_BASE_COUNT=
```

- [ ] **Step 4: 비용 서사 7곳 — 09 §3과 같은 수치로 통일**

| 파일:줄 | 교체 |
|---|---|
| `README.md:103` | Step 2에서 처리 |
| `01-overview.md:74` | `AWS 월 예상 비용 $1 미만(LLM 사용량 제외) 유지` → `AWS 월 예상 비용 $30 수준·상한 $42 유지(LLM 사용량 제외). 상시 가동 ALB·Fargate 를 쓰는 대가로 콜드스타트가 없다` |
| `02:35-48` | Task D2에서 처리 |
| `09 §3` | Task D1에서 처리 |
| `11:119` | Q&A 답변 → `ECS Fargate Spot + 내부 ALB + DynamoDB + Vercel — 월 $30 수준. 절반 이상이 ALB 고정비이고, 그 대가로 콜드스타트 없이 상시 가용합니다. 실비용의 나머지는 LLM 호출입니다 (Billing 캡처)` |
| `12` 리스크표 | `Vercel + Lambda(상시, 콜드스타트만 존재)` → `Vercel + ECS Fargate(상시 가동, 콜드스타트 없음)`. `Lambda에는 LLM 키만 SAM NoEcho 파라미터` → `LLM 키는 SSM Parameter Store SecureString 으로만 주입` |
| `22:184` | 발표 슬라이드 고정 수치 → 09 §3과 동일한 표. S17 스택 다이어그램을 `Vercel(FE) + API Gateway/VPC Link/ALB/ECS Fargate/DynamoDB` 로 |

- [ ] **Step 5: 나머지 문서**

| 파일 | 교체 |
|---|---|
| `03:30,34,40,63-65` | 디렉터리 트리에서 mangum 제거, `main.py = handler = Mangum(app)` 삭제, dataload `(Lambda: app/data/, 로컬 …)` → `(컨테이너: app/data/, 로컬 …)`. `infra/` 트리를 새 구조로 |
| `04:13,138-139,150,176,185` | `AWS CLI + SAM CLI 셋업` → `AWS CLI + Docker 셋업`, `SAM CLI \| brew install aws-sam-cli` 행 삭제, `CARDS_TABLE \| 1차 배포 후 Outputs` → `sangseng-cards 고정` |
| `05:11,591,640,647` | Base URL `배포 후 API Gateway URL` 유지(정확함). health 설명의 `deploy-backend.sh의 data 복사 누락 진단용` → `build-and-push.sh 의 data 복사 누락 진단용` |
| `08:182-184` | F9 `Lambda 콜드스타트 1~3초를 심사위원이 "고장"으로 오인하지 않게 하는 장치` → `느린 응답을 "고장"으로 오인하지 않게 하는 장치` |
| `10:22,35,80,88-90` | `AWS 프로파일·SAM CLI 확인` → `AWS 프로파일(sangseng)·Docker 확인`, `sam validate·sam build 성공까지 확인 완료` → `CloudFormation validate-template 통과`, `./deploy-backend.sh` → `./infra/scripts/deploy.sh` |
| `20` | 재사용 감사 프롬프트의 레포 구조 설명 2곳: `backend/ FastAPI + Mangum(Lambda)` → `backend/ FastAPI (ECS Fargate, uvicorn)`, `infra/ template.yaml(SAM)·deploy-backend.sh` → `infra/ cloudformation/{foundation,service}.yaml · scripts/deploy.sh`. 3모듈 점검 대상 목록의 `sam build 산출물` 항목 삭제 |
| `21:112-115,122,192,196` | `Vercel(FE)·SAM(BE) 배포` → `Vercel(FE)·ECS(BE) 배포`, `infra/deploy-backend.sh의 가드 조건` → `infra/scripts/preflight.sh 의 가드 조건`, `MUTATION_API_TOKEN이 Lambda와 Vercel 양쪽` → `SSM 과 Vercel 양쪽` |
| `docs/plan/README.md:11-12,16-17,27,38,48` | Architecture `FastAPI(Lambda, API Gateway HTTP API)` → `FastAPI(ECS Fargate, 내부 ALB, API Gateway HTTP API + VPC Link)`. Tech Stack `Python 3.12+FastAPI+Mangum … 배포: Vercel(FE)` → `Python 3.12+FastAPI+uvicorn … 배포: Vercel(FE, icn1) + AWS ECS(BE, ap-northeast-2)`. 나머지 3곳의 `SAM` 표기를 `CloudFormation` 으로 |

- [ ] **Step 6: 전체 검증**

Run:
```bash
grep -rn "SAM\|Mangum\|mangum\|deploy-backend\|사실상 \$0\|월 \$1 미만\|RESERVED_CONCURRENCY" \
  CLAUDE.md README.md .env.example docs/plan/ frontend/README.md
```
Expected: 출력 없음

Run: `grep -rn "Lambda" CLAUDE.md README.md .env.example docs/plan/`
Expected: 09 문서 머리말의 역사적 언급 1건만

Run: `cd backend && python -m pytest -q && cd ../frontend && npm run lint && npm run check:banned`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add CLAUDE.md README.md .env.example docs/plan/ frontend/README.md
git commit -m "docs: 전 문서를 ECS 구성으로 정합화 + 비용 서사 7곳 정정"
```

---

## 완료 기준

- [ ] `cd backend && python -m pytest` 전부 통과
- [ ] `cd frontend && npm run build && npm run lint && npm run check:banned` 전부 통과
- [ ] `./infra/scripts/deploy.sh` 성공, `smoke-test.sh` 5단계 통과
- [ ] `zero-downtime-check.sh` 실패 0건
- [ ] Vercel `x-vercel-id`에 `icn1`
- [ ] 레포 전체에 `SAM`·`Mangum`·`deploy-backend.sh`·"사실상 $0" 잔재 없음 (`docs/audit/`·`docs/review/` 제외)
- [ ] 시드 후 `GET /api/cards`가 카드 5장 반환
- [ ] PR 을 열면 `pr-checks` 3개 job 이 통과하고, `main` 머지 시 `backend-deploy` 가 배포까지 완주
