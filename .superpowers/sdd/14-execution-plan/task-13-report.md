# Task 13 (T13) 보고서 — B6 KPI + 방문객 위젯 (`backend/app/routes/kpi.py`, `backend/app/routes/widget.py`)

## 생성·수정 파일

- `backend/app/routes/kpi.py` — `GET /api/kpi` (05 §3 스키마 그대로). 헬퍼 2개:
  `_elapsed_hours`(created_at→decided_at, KST ISO8601 파싱), `_balance_index`(REGIONS 6개 고정 분모).
  분모 0인 지표는 전부 `null` (0·NaN 금지 — 05 §8)
- `backend/app/routes/widget.py` — `GET /api/widget/recommend?region=&category=` (05 §4 스키마 그대로).
  헬퍼 4개: `_new_targets`(완료 EXPANSION 카드의 (읍,업종) 집합), `_payback`(완료 INCENTIVE의
  selected_rate), `_fallback_blurb`(규칙 기반 문구), `_blurbs`(LLM 1회 일괄 호출, timeout=5)
- `backend/requirements.txt`·`main.py` 수정 없음 (브리프 제약 준수). 신규 모듈·의존성 없음 —
  지니 산식은 `services/simulate.concentration_index`, 지역 목록은 `simulate.REGIONS` 재사용

## 계약 해석 (정본 대조 결과 — 리뷰 포인트)

1. **신규 배지 필드명은 `badge:"신규"`** — 브리프 본문은 `"is_new": true`로 적었으나 응답 계약 정본은
   05 §4이고 거기 예시 필드는 `badge`다(FE mock도 이 형태). 같은 개념이라 판단해 05를 따랐다.
   비신규는 `badge: null`.
2. **균형지수의 지니는 정규화판** — 브리프 지시("simulate.py의 백엔드 복제 산식과 동일 방식,
   재사용 가능하면 재사용")대로 `concentration_index`(지니 ÷ 최댓값(1−1/n) × 100)를 그대로 써서
   `regional_balance_index = round(100 − concentration_index(counts))`로 구현했다. 파이프라인의
   "지역 소비 집중도"와 동일 스케일이라 두 지표가 같은 자로 읽힌다.
   05 §3 예시의 `80`은 산출값이 아니라 예시 숫자다(문서도 "데모 초반의 낮은 값은 정상"이라 명시).
3. **균형지수 대상**: `status=approved` + `type=EXPANSION` + `target.eup ∈ REGIONS`인 카드만.
   해당 카드 0장이면 `null`(승인 카드가 INCENTIVE뿐이면 분포가 전부 0 → 분모 0이므로 null).
4. **avg_approval_hours 대상**: `decided_at`이 있는 **모든** 카드(approved+rejected+held) — 05 §3 정의.
5. **payback은 항목마다 동일** — 페이백은 전 지역 공통 적용이라 05 §4 예시처럼 각 추천 항목에 붙인다.
   완료 INCENTIVE가 여럿이면 `decided_at`이 가장 최근인 카드의 `selected_rate`를 쓴다.

## 검증 (Docker, 7단계 전부 실행)

`.env` 복사 → `docker compose up -d --build` → `local_init.py`(`created: sangseng-cards`).
B4 generate는 아직 미구현이라 목업 카드는 DDB에 직접 put하고, 상태 전이는 T9 엔드포인트 curl로 진행.

### 1. 카드 0장 (기준선)

```
GET /api/kpi
{"adoption_rate":null,"execution_rate":null,"avg_approval_hours":null,"regional_balance_index":null,
 "counts":{"total":0,"pending":0,"approved":0,"rejected":0,"held":0,"done":0}}

GET /api/widget/recommend?region=사북읍   → 650 우화정(음식점) / 가족사랑(음식점) / 감탄카페(카페)
                                            badge 전부 null, payback 전부 null
```

### 2. 완료 EXPANSION 카드 반영 — **추천 순서 변화(데모 핵심)**

`AC-901`(사북읍×카페) put → `POST /decision {"decision":"approved"}` → `POST /progress {"progress":"완료"}`

| 순위 | 완료 전 (`?region=사북읍`) | 완료 후 (`?region=사북읍`) |
|---|---|---|
| 1 | 650 우화정 (음식점, badge null) | **감탄카페 (카페, badge 신규)** |
| 2 | 가족사랑 (음식점, badge null) | **블루버드28 (카페, badge 신규)** |
| 3 | 감탄카페 (카페, badge null) | **옥상카페 (카페, badge 신규)** |

카드 타깃 (사북읍×카페)에 매칭되는 가맹점 5곳이 최상단으로 올라오고 나머지는 원본 순서를 유지한다
(안정 정렬). blurb 예: "사북읍에 새로 생긴 감탄카페에서 여유로운 시간을 가져보세요."

### 3. 완료 INCENTIVE 카드 → payback

`INC-901` put → `decision {"decision":"approved","selected_rate":5}` → `progress 완료` →
추천 3건 모두 `"payback":{"rate":5,"label":"지금 여기서 쓰면 5% 페이백"}` 확인.

### 4. KPI 재호출 + 수동 계산 대조

카드 4장 상태: `AC-901`(EXPANSION 사북읍, approved/완료), `INC-901`(INCENTIVE, approved/완료),
`AC-902`(EXPANSION 고한읍, approved/검토중), `AC-903`(EXPANSION 태백시, **rejected**).

```
{"adoption_rate":0.75,"execution_rate":0.67,"avg_approval_hours":2.8,"regional_balance_index":20,
 "counts":{"total":4,"pending":0,"approved":3,"rejected":1,"held":0,"done":2}}
```

| 지표 | 수동 계산 | 응답 |
|---|---|---|
| adoption_rate | 승인 3 / 전체 4 = 0.75 | 0.75 ✅ |
| execution_rate | (추진중 0 + 완료 2) / 승인 3 = 0.667 | 0.67 ✅ |
| avg_approval_hours | AC-901 3:00:08 + INC-901 1:00:00 + AC-902 5:00:07 + AC-903 2:00:06 = 11.0058h ÷ **4장**(반려 포함) = 2.7515 | 2.8 ✅ |
| regional_balance_index | 승인 EXPANSION 분포 [고한1, 사북1, 정선0, 태백0, 영월0, 삼척0] → 지니 16/24 = 0.6667 → 정규화 0.6667/(1−1/6) = 0.8 → 100−80 | 20 ✅ |

반려 카드(태백시)는 균형지수 분포에서 제외되고 avg_approval_hours에는 포함되는 것을 같은 응답에서 확인.
승인 EXPANSION이 1장(사북읍)뿐일 때는 `regional_balance_index: 0`(완전 편중), 2개 지역이 되자 20으로
상승 — 05 §3의 "여러 지역에 쌓일수록 상승" 동작 확인.

### 5. LLM 실패 경로 (fallback)

worktree `.env` 사본에서 `OPENAI_API_KEY=`(빈 값)으로 `--force-recreate` 재기동 후:

```
?region=사북읍 (완료 카드 매칭)  → "사북읍에 새로 생긴 카페 하이원포인트 가맹점이에요"   (응답 0.17s)
?region=태백시&category=카페     → "태백시의 카페 하이원포인트 가맹점이에요"            (05 §8 문구 그대로)
```

### 6. 엣지 케이스

```
?region=영월군&category=숙박업 (0건) → 200 {"recommendations":[],"policy_note":"확충 완료된 신규 가맹점을 우선 추천합니다"}
merchants.json 부재(로더 대체)        → 503 {"detail":"merchants.json이 아직 생성되지 않았습니다"}
```

`/api/kpi`·`/api/widget/recommend` 응답 본문에 `gini`·`hhi` 문자열 0건(대소문자 무시 grep) —
절대 규칙 1 준수.

### 7. 뒷정리

`.env` 사본 삭제 → `docker compose down`(컨테이너·네트워크 제거 확인) → `git status`는 구현 파일 2건만.

## 우려사항·인계 사항

1. **신규 배지가 기존 가맹점에 붙는다** — 07 B6 정본 규칙이 "완료 카드 타깃(읍×업종)과 매칭되는
   가맹점에 배지"라서, 사북읍×카페 카드 1장이 완료되면 그 조합의 기존 5곳이 모두 "신규"로 표시된다
   (05 §4도 "데모: 목업 1~2건 허용"으로 이 느슨함을 전제). 실제 신규 지점 레코드가 없기 때문인데,
   심사에서 "이 가게가 정말 신규냐"는 질문이 나올 수 있다. 정확히 1~2건만 신규로 보이게 하려면
   T11 시드에서 카드 타깃을 **가맹점이 0곳인 공백 조합**으로 잡고 완료 시 목업 가맹점 1건을
   merchants에 얹는 방식이 필요하다 — T11 담당자 확인 필요.
2. **blurb 표현 강도** — A-4 프롬프트(정본, 수정 금지)만으로는 gpt-4o-mini가 "새로운 핫플",
   "멋진 풍경" 같은 없는 사실을 덧붙이는 경우가 있어, user payload의 "작성 지침"에
   "이름·지역·업종 외의 사실(분위기·풍경·메뉴·인기도)은 지어내지 말 것"을 추가했다
   (cards.py simulate와 동일 패턴 — 프롬프트 원문은 그대로 둠). 이후 출력은 담백해졌으나
   "여유로운 시간을 가져보세요" 수준의 일반 표현은 남는다.
3. **위젯 LLM 호출은 목록당 1회** — 3곳을 각각 호출하면 timeout 5초 × 3 + 재시도로 지연이 누적돼,
   3곳을 한 번에 생성하고 개수가 모자라면 그 인덱스만 규칙 문구로 채우게 했다.
   `llm.generate_json`의 1회 재시도 때문에 최악 지연은 약 10초(= 5초 × 2회)다.
4. **B7 스모크 테스트(T?)에서 KPI/위젯을 마지막 링크로 넣을 것** — 이번 검증은 전부 수동 curl이라
   회귀 방지 장치가 없다. `test_smoke.py`의 순서(health→…→kpi→widget)에 위 4번 표의
   수동 계산 대조를 그대로 assert로 옮기면 계산 정의가 박제된다.
