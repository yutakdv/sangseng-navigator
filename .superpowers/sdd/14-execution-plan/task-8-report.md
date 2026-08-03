# Task 8 (T8) 보고서 — B1 정적 데이터 서빙 (`backend/app/routes/dashboard.py`)

## 변경 파일

- `backend/app/routes/dashboard.py`만 수정 (요구사항대로 이 파일 하나만 손댐)
  - `GET /api/dashboard` → `dataload.load("dashboard")` 결과를 그대로 반환
  - `GET /api/candidates` → `eup_scores.json`(`eup_ranking`, `selected_eups`) +
    `candidates.json`(`candidates`) + `merchants.json`(`merchants`) 3파일을
    05 문서 §1 응답 형태로 병합
  - 두 엔드포인트 모두 `FileNotFoundError` → `HTTPException(503, {"detail": "..."})`
  - 데이터 접근은 `app.dataload.load()`만 사용, 직접 `open()` 없음
  - `backend/requirements.txt` 미수정

## 검증 (Docker, 순서대로 실행)

### 1. `.env` 복사
```
$ cp /Users/yutak/Desktop/sangseng-navigator/.env ./.env
```
`git status`에 `.env`는 나타나지 않음 (`.gitignore` 정상 동작).

### 2. `docker compose up -d --build`
```
 Container agent-a267e2f05ca85aef0-dynamodb-1 Started
 Container agent-a267e2f05ca85aef0-backend-1 Started

$ docker compose ps
NAME                                 STATUS         PORTS
agent-a267e2f05ca85aef0-backend-1    Up 8 seconds   0.0.0.0:8000->8000/tcp
agent-a267e2f05ca85aef0-dynamodb-1   Up 8 seconds   0.0.0.0:8001->8000/tcp
```
빌드·기동 1회에 성공(수정 불필요, T7 산출물 그대로 사용).

### 3. `/api/health`
```
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/health
200
$ curl -s localhost:8000/api/health
{"ok":true,"data_loaded":false}
```
`data_loaded:false` — dashboard.json 미생성 상태이므로 정상.

### 4. `/api/dashboard`
```
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/dashboard
503
$ curl -s localhost:8000/api/dashboard
{"detail":"dashboard.json이 아직 생성되지 않았습니다"}
```

### 5. `/api/candidates`
```
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/candidates
503
$ curl -s localhost:8000/api/candidates
{"detail":"candidates 관련 산출 JSON이 아직 생성되지 않았습니다"}
```

### 6. `usage_monthly.json` 로딩 확인 (컨테이너 내부, 파이썬 한 줄)
```
$ docker compose exec backend python -c "
from app import dataload
d = dataload.load('usage_monthly')
print('OK, top-level keys:', list(d.keys()))
"
OK, top-level keys: ['source', 'base_month', 'months', 'categories', 'region_note', 'usage', 'visitors_monthly']
```
`dataload.load()`가 이미 존재하는 산출 JSON에 대해 정상 동작함을 확인.

### 7. `docker compose down`
```
 Container agent-a267e2f05ca85aef0-backend-1 Removed
 Container agent-a267e2f05ca85aef0-dynamodb-1 Removed
 Network agent-a267e2f05ca85aef0_default Removed
```
포트 8000/8001 반납 완료.

## 셀프 리뷰

- `git diff` 확인 결과 `backend/app/routes/dashboard.py` 외 추적 파일 변경 없음
  (`requirements.txt` 불변, `.env`는 gitignore로 미추적).
- 05 문서 §1 스키마와 07 문서 B1 체크리스트를 코드와 대조 — 일치.
- `eup_scores.json`/`candidates.json`/`merchants.json`이 각각 `{"eup_ranking":..., "selected_eups":...}`,
  `{"candidates":[...]}`, `{"merchants":[...]}` 형태의 dict라는 전제는 06 문서 §"파이프라인 산출
  JSON 스키마" 표(`eup_scores.json` = "§1 eup_ranking + selected_eups" 등, `risk_signal.json`만
  예외적으로 순수 배열로 명시)와 브리프 원문("eup_scores.json에서 eup_ranking, selected_eups")에
  근거함 — 아직 해당 파일들이 생성되지 않아 실물 검증은 T4·T5(스코어링/지오코딩 파이프라인)
  완료 후 가능.

## 우려사항

- `eup_scores.json`/`candidates.json`/`merchants.json`의 실제 top-level 구조는 파이프라인(T4·T5)
  구현 시점에 최종 확정된다. 위 전제와 다르게 생성될 경우(예: `candidates.json`이 배열 자체라면)
  `routes/dashboard.py`의 키 접근부(`candidates["candidates"]` 등)를 그 시점에 함께 조정 필요.
- 그 외 특이사항 없음.
