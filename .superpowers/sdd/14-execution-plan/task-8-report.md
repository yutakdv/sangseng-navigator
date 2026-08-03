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

## 우려사항 (픽스 라운드 1 이전 시점 — 아래에서 해소됨)

- ~~`eup_scores.json`/`candidates.json`/`merchants.json`의 실제 top-level 구조는 파이프라인(T4·T5)
  구현 시점에 최종 확정된다. 위 전제와 다르게 생성될 경우(예: `candidates.json`이 배열 자체라면)
  `routes/dashboard.py`의 키 접근부(`candidates["candidates"]` 등)를 그 시점에 함께 조정 필요.~~
  → 리뷰에서 지적됨, 아래 픽스 라운드 1에서 해소.

---

## 픽스 라운드 1 (리뷰 Critical 1건 대응)

### 리뷰 발견사항
`backend/app/routes/dashboard.py:28-29` — `candidates["candidates"]`, `merchants["merchants"]`가
dict-wrapped 페이로드를 전제했으나, 05 문서 §6(`docs/plan/05-api-contract.md:205-206`)은 두 파일을
**순수 배열(bare array)**로 명시: `candidates.json` = "§1 `candidates` 배열", `merchants.json` =
"§1 `merchants` 배열" — 파일 자체가 배열. dict인 것은 `eup_scores.json`("§1 `eup_ranking` +
`selected_eups`")뿐. T5/T2가 계약대로 순수 `[...]` 배열을 산출하면 `list["candidates"]`가
`TypeError`를 던져 처리되지 않은 500이 발생 — 계약된 응답 형태가 아님.

### 수정
`backend/app/routes/dashboard.py`의 `get_candidates()` 반환부에서 `candidates`/`merchants`를 로드한
값 그대로 사용하도록 변경 (`eup_scores`는 여전히 dict이므로 `eup_ranking`/`selected_eups` 키 접근 유지):
```diff
     return {
         "eup_ranking": eup_scores["eup_ranking"],
         "selected_eups": eup_scores["selected_eups"],
-        "candidates": candidates["candidates"],
-        "merchants": merchants["merchants"],
+        "candidates": candidates,
+        "merchants": merchants,
     }
```

### 검증 (임시 bare-array 픽스처 사용)
1. `data/processed/`에 임시 파일 3개 작성(커밋 대상 아님):
   - `candidates.json` = `[{"id":"CAND-901","eup":"사북읍","category":"카페","lat":37.22,"lng":128.81,"score":0.5}]`
   - `merchants.json` = `[{"name":"테스트","category":"카페","eup":"사북읍","address":"x","lat":37.22,"lng":128.81}]`
   - `eup_scores.json` = `{"eup_ranking":[{"rank":1,"eup":"사북읍","score":0.7,"low_usage":0.6,"decline":0.8}],"selected_eups":["사북읍"]}`

2. `docker compose up -d --build` → 정상 기동.

3. `/api/candidates` 확인:
```
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/candidates
200
$ curl -s localhost:8000/api/candidates
{"eup_ranking":[{"rank":1,"eup":"사북읍","score":0.7,"low_usage":0.6,"decline":0.8}],"selected_eups":["사북읍"],"candidates":[{"id":"CAND-901","eup":"사북읍","category":"카페","lat":37.22,"lng":128.81,"score":0.5}],"merchants":[{"name":"테스트","category":"카페","eup":"사북읍","address":"x","lat":37.22,"lng":128.81}]}
```
200, 4개 키(`eup_ranking`/`selected_eups`/`candidates`/`merchants`) 모두 올바른 형태(배열은 배열 그대로) 확인.

4. `/api/dashboard`는 `dashboard.json` 미생성 상태 그대로이므로 여전히 503 유지 확인:
```
$ curl -s -o /dev/null -w "%{http_code}\n" localhost:8000/api/dashboard
503
$ curl -s localhost:8000/api/dashboard
{"detail":"dashboard.json이 아직 생성되지 않았습니다"}
```

5. 임시 픽스처 3개 파일 삭제 후 확인:
```
$ rm data/processed/candidates.json data/processed/merchants.json data/processed/eup_scores.json
$ git status --short data/processed/
(출력 없음 — 깨끗함, 애초에 추적되지 않은 파일이라 흔적 없음)
```

6. `docker compose down` → 컨테이너·네트워크 제거, 포트 8000/8001 반납 완료.

### 커밋
`91719cd` — `fix: candidates·merchants bare-array 계약 준수 (05 §6)` (`feat/yutak-b1-static-serving`
브랜치에 추가 커밋, push 완료).
