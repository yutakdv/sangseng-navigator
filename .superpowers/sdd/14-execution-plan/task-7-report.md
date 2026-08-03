# Task 7 (T7) 보고서 — Docker 테스트 환경 (BE + DynamoDB Local)

## 생성 파일

- `docker-compose.yml` (레포 루트) — 브리프 코드 블록 그대로
- `backend/Dockerfile` — 브리프 코드 블록 그대로
- `backend/local_init.py` — 브리프 코드 블록 그대로
- `backend/requirements-dev.txt` — `pytest`, `httpx` 두 줄

## 발견 및 수정 사항 (범위 내 최소 수정)

`backend/requirements.txt`에 `uvicorn`이 누락되어 있었다. `backend/Dockerfile`의 CMD와
`docker-compose.yml`의 backend 커맨드가 모두 `uvicorn`을 그대로 실행하므로(브리프 원문 그대로
사용), 이 누락은 API 계약과 무관한 런타임 의존성 공백이며 수정하지 않으면 T7의 목적
(BE+DynamoDB Local 컨테이너 기동)과 검증 2단계(`curl .../api/health`)가 원천적으로 불가능했다.
`fastapi` 다음 줄에 `uvicorn` 한 줄을 추가했다 (`uvicorn[standard]`가 아닌 plain `uvicorn` —
`--reload`는 내장 StatReload로 동작 확인함).

## 검증 (순서대로 실행, 출력 기록)

### 1. `.env` 복사 + gitignore 확인
```
$ cp /Users/yutak/Desktop/sangseng-navigator/.env ./.env
$ git status
On branch feat/yutak-docker-env
...
(untracked: backend/Dockerfile, backend/local_init.py, backend/requirements-dev.txt, docker-compose.yml)
```
`.env`는 `git status`에 나타나지 않음 → `.gitignore`의 `.env` 규칙대로 정상 무시됨 확인.

### 2. `docker compose up -d --build` → health check
1차 시도는 `uvicorn: executable file not found in $PATH`로 backend 컨테이너 기동 실패
(원인: requirements.txt에 uvicorn 누락, 위 "발견 및 수정 사항" 참고). `docker compose down`으로
정리 후 requirements.txt에 uvicorn 추가, 재빌드:
```
$ docker compose up -d --build
...
 Container agent-a4916435cc6e7e3ba-dynamodb-1 Started
 Container agent-a4916435cc6e7e3ba-backend-1 Started

$ docker compose ps
NAME                                 STATUS         PORTS
agent-a4916435cc6e7e3ba-backend-1    Up 8 seconds   0.0.0.0:8000->8000/tcp
agent-a4916435cc6e7e3ba-dynamodb-1   Up 8 seconds   0.0.0.0:8001->8000/tcp

$ curl -s -i localhost:8000/api/health
HTTP/1.1 200 OK
content-type: application/json

{"ok":true,"data_loaded":false}
```
200 JSON 확인. (`data_loaded:false`는 정적 데이터 마운트/로딩 관련 별개 이슈로 보이며 이번
태스크 범위 밖 — 우려사항에 기록)

### 3. `local_init.py` (멱등성 확인 — 2회 실행)
```
$ cd backend && DYNAMO_ENDPOINT=http://localhost:8001 \
    /Users/yutak/Desktop/sangseng-navigator/.venv/bin/python local_init.py
created: sangseng-cards

$ DYNAMO_ENDPOINT=http://localhost:8001 \
    /Users/yutak/Desktop/sangseng-navigator/.venv/bin/python local_init.py
exists: sangseng-cards
```

### 4. `docker compose down`
```
$ docker compose down
 Container agent-a4916435cc6e7e3ba-backend-1 Removed
 Container agent-a4916435cc6e7e3ba-dynamodb-1 Removed
 Network agent-a4916435cc6e7e3ba_default Removed
```
포트 8000/8001 반납 완료.

## 우려사항

- `/api/health` 응답의 `data_loaded: false`는 이번 태스크(Docker 환경 자체)의 범위가 아니라서
  손대지 않았다. `backend/app/dataload.py`의 로컬 폴백 경로 또는 볼륨 마운트 순서 관련일 가능성이
  있으니 이후 데이터 로딩을 다루는 태스크(T8 이후)에서 확인 필요.
- `backend/requirements.txt`에 `uvicorn`을 추가한 것은 브리프의 "코드 블록을 그대로 사용" 지시와
  별개로, 그 코드 블록이 실행되기 위한 선행 의존성 공백을 메운 최소 수정이다. 15 문서/05
  API 계약에는 영향 없음.
