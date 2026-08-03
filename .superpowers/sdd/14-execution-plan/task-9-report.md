# Task 9 (T9) 보고서 — B2 DynamoDB CRUD + 카드 상태 API

## 변경 파일

- `backend/app/db.py` (신규) — 07 문서 Task B2 원문 그대로(`_clean`/`_to_ddb`/`now_iso`/`put_card`/
  `get_card`/`list_cards`/`next_card_id`). 브리프 지시대로 `_table =` 한 줄만 Docker 분기로 교체:
  ```python
  _kw = {"region_name": os.environ.get("AWS_REGION", "ap-northeast-2")}
  if os.environ.get("DYNAMO_ENDPOINT"):          # Docker/로컬 테스트 (T7)
      _kw["endpoint_url"] = os.environ["DYNAMO_ENDPOINT"]
  _table = boto3.resource("dynamodb", **_kw).Table(os.environ.get("CARDS_TABLE", "sangseng-cards"))
  ```
- `backend/app/routes/cards.py` — 스텁의 `router = APIRouter()` 구조 유지, 엔드포인트 4개 추가
  (generate/simulate는 T11 B4 몫이라 손대지 않음). `main.py`는 이미 이 라우터를 `/api` prefix로
  include하고 있어 미수정. `requirements.txt` 미수정(boto3 기존 포함).

구현한 규칙 (05 문서 §2·§7·§8):

| 엔드포인트 | 규칙 |
|---|---|
| `GET /api/cards` | 쿼리 `type`/`status` 선택 필터 → `{"cards": [...]}`, `created_at` 내림차순 정렬 |
| `GET /api/cards/{id}` | `{"card": ...}`, 없으면 `404 {"detail": "card not found"}` |
| `POST .../decision` | `pending`에서만 허용(아니면 409). 승인/반려/보류 모두 `decided_at`(KST ISO8601) 기록, `approved`면 `progress="검토중"` 자동. INCENTIVE를 approved할 때만 `selected_rate`(3\|5\|7) 필수 — 누락/범위 밖이면 `400 {"detail": "selected_rate(3|5|7)가 필요합니다"}`, EXPANSION에 온 `selected_rate`는 무시 |
| `POST .../progress` | `status=approved`에서만 허용(아니면 409), 허용값 4종 외는 400 |
| 공통 | 모든 변경을 `events`에 `{"at": now_iso(), "action": "approved" \| "progress:완료" ...}` append, 응답은 `{"card": Card}` |

## 검증 (Docker, 브리프 시나리오 전부)

### 1~2. 기동 + 테이블 생성
```
$ cp /Users/yutak/Desktop/sangseng-navigator/.env ./.env
$ docker compose up -d --build
 Container agent-a641969d99cd56d5f-dynamodb-1 Started
 Container agent-a641969d99cd56d5f-backend-1 Started
$ curl -s localhost:8000/api/health
{"ok":true,"data_loaded":false}          # dashboard.json 미생성 상태라 정상 (T8 보고서와 동일)

$ DYNAMO_ENDPOINT=http://localhost:8001 python backend/local_init.py
created: sangseng-cards
```

### 3. 목업 카드 삽입 (호스트에서 `db.py`의 `put_card` 경유)
EXPANSION `AC-901`(pending, `ai.original_ranking[].score`에 float 0.59/0.5725 포함) +
INCENTIVE `INC-901`(pending, scenarios 3종, `selected_rate: null`).
```
seeded: ['AC-901', 'INC-901']
round-trip score: 0.5725 float          # float → Decimal → float 왕복 정상
next_card_id('AC-'): AC-002
```

### 4. curl 시나리오 (모두 JSON, 500 없음)

```
### GET /api/cards (2장)
[HTTP 200]
{"cards":[{... "id":"INC-901","status":"pending" ...},{... "id":"AC-901","status":"pending" ...}]}

### GET /api/cards?type=EXPANSION (1장)
[HTTP 200]
{"cards":[{"decided_at":null,...,"ai":{...,"original_ranking":[{"rank":1,"score":0.59,"candidate":"고한읍 편의점"},{"rank":2,"score":0.5725,"candidate":"사북읍 카페"}],"adjusted":true},"type":"EXPANSION","target":{"category":"카페","eup":"사북읍"},"progress":null,"ai_rank":1,"id":"AC-901","score_rank":2,"status":"pending"}]}

### GET /api/cards?status=pending (2장)
[HTTP 200]   (INC-901, AC-901 둘 다 반환)

### GET /api/cards/AC-901 (200)
[HTTP 200]
{"card":{...,"id":"AC-901","status":"pending","progress":null,"decided_at":null}}

### POST /api/cards/AC-901/decision {"decision":"approved"}
[HTTP 200]
{"card":{...,"decided_at":"2026-08-03T17:23:10+09:00","progress":"검토중","id":"AC-901","status":"approved","events":[{"at":"2026-08-03T17:23:10+09:00","action":"approved"}]}}

### POST /api/cards/AC-901/progress {"progress":"완료"}
[HTTP 200]
{"card":{...,"progress":"완료","id":"AC-901","status":"approved","events":[{"action":"approved","at":"2026-08-03T17:23:10+09:00"},{"at":"2026-08-03T17:23:10+09:00","action":"progress:완료"}]}}

### POST /api/cards/AC-901/decision {"decision":"approved"} 재시도
[HTTP 409]
{"detail":"pending 카드만 결정할 수 있습니다 (현재 status=approved)"}

### POST /api/cards/INC-901/decision {"decision":"approved"}  (rate 누락)
[HTTP 400]
{"detail":"selected_rate(3|5|7)가 필요합니다"}

### POST /api/cards/INC-901/decision {"decision":"approved","selected_rate":5}
[HTTP 200]
{"card":{...,"decided_at":"2026-08-03T17:23:10+09:00","scenarios":[{"rate":3,...},{"rate":5,...},{"rate":7,...}],"type":"INCENTIVE","selected_rate":5,"progress":"검토중","id":"INC-901","status":"approved","events":[{"at":"2026-08-03T17:23:10+09:00","action":"approved"}]}}

### GET /api/cards/NOPE-001
[HTTP 404]
{"detail":"card not found"}
```

추가로 05 §8의 나머지 규칙도 확인(pending 카드 AC-902/AC-903 임시 삽입):
```
### EXPANSION rejected + selected_rate:7 (무시돼야 함)
[HTTP 200] {"id":"AC-902","status":"rejected","progress":null,"selected_rate":null,"decided_at":"2026-08-03T17:23:45+09:00","events":[{"at":"...","action":"rejected"}]}

### EXPANSION held
[HTTP 200] {"id":"AC-903","status":"held","progress":null,"selected_rate":null,"decided_at":"2026-08-03T17:23:45+09:00","events":[{"at":"...","action":"held"}]}

### rejected 카드에 progress
[HTTP 409] {"detail":"승인된 카드만 추진 상태를 변경할 수 있습니다 (현재 status=rejected)"}

### 잘못된 decision 값 {"decision":"maybe"}
[HTTP 400] {"detail":"decision은 approved|rejected|held 중 하나여야 합니다"}

### body 필드 누락 {}
[HTTP 422] {"detail":[{"type":"missing","loc":["body","decision"],"msg":"Field required",...}]}
```

백엔드 컨테이너 로그 전체를 `error|traceback|exception|500` 으로 grep — 매치 없음.
Decimal 직렬화로 인한 500은 한 건도 발생하지 않았다.

### 5. 정리
```
$ docker compose down
 Container agent-a641969d99cd56d5f-backend-1 Removed
 Container agent-a641969d99cd56d5f-dynamodb-1 Removed
 Network agent-a641969d99cd56d5f_default Removed
$ lsof -nP -iTCP:8000 -sTCP:LISTEN; lsof -nP -iTCP:8001 -sTCP:LISTEN
(출력 없음 — 포트 8000/8001 반납 완료)
```

## 셀프 리뷰

- `git status`에 `backend/app/db.py`(신규)·`backend/app/routes/cards.py`(수정) 2개만 — `.env`는
  gitignore로 미추적, 목업 삽입 스크립트는 레포 밖 스크래치패드에 작성해 커밋 대상 없음.
- 05 문서 §2 표·§7·§8을 코드와 1:1 대조 — 상태 전이(409)·`selected_rate`(400)·404 문구·
  `events` 형식·KST ISO8601 모두 일치. `decision`/`progress`의 허용값 검증은 pydantic `Literal`
  대신 수동 검사로 두어 브리프가 요구한 **400**(422 아님)이 나가게 했다.
- `db.py`는 07 원문 유지 — 07이 이후 태스크(B4의 `next_card_id` 등)에서 그대로 재사용되는 코드라
  임의 리팩터링하지 않았다.
- 목록 정렬(`created_at` 내림차순)은 05에 규정이 없으나 Scan 순서가 비결정적이라 추가했다.
  FE 목록 UI에서 순서가 흔들리는 것을 막는 용도이며 계약 위반은 아니다.

## 우려사항 (후속 태스크에서 확인 필요)

1. `_clean`이 `Decimal("1.0")`을 `int 1`로 되돌린다(07 원문 동작). `scenarios[].delta_pp`의
   `[1.0, 2.0]`이 응답에서 `[1,2]`로 나간다 — JSON 수치로는 동일하나, FE가 소수점 표기를
   기대한다면 표시 단계에서 포맷해야 한다.
2. `next_card_id`는 접두사 개수+1이므로, 이번 검증처럼 `AC-901` 같은 비순차 ID가 섞이면
   기존 ID와 충돌할 수 있다(검증 중 `AC-002` 반환 확인). 데모 데이터는 순차 생성만 쓰므로
   실사용 문제는 없지만, T11(B4)에서 목업 ID를 남기지 말 것.
3. `POST /api/cards/generate`·`simulate`는 이 태스크 범위 밖(T11)이라 미구현 — 현재 해당 경로는
   405/404가 난다.
