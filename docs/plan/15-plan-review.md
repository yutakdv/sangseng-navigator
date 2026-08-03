# 15. 개발 착수 전 최종 검토 (2026-08-03) — 결론·반영 사항 추적

> 개발 착수 직전에 docs/plan 01~14 전체와 기구현 코드(backend·pipeline·infra·data/processed)를
> 교차 검증한 기록. **결론: 이 계획대로 개발을 진행하면 원하는 결과물이 나온다** — 단,
> §3~§7의 반영 사항을 §8의 시점에 적용한다. 각 항목은 반영 커밋에서 체크박스를 닫아 추적하고,
> 계약 관련 항목은 원칙대로 **05 문서를 먼저 수정**한 뒤 코드에 반영한다 (README Global Constraints).

## 1. 검토 범위·방법·결론

| 구분 | 내용 |
|---|---|
| 대상 | docs/plan 15개 문서 전체 · backend/ · pipeline/ · infra/ 기구현 코드 · data/processed 산출물 · .gitignore·커밋 이력 |
| 방법 | ① 문서↔코드 원문 대조 ② 05 계약 예시 수치 전수 재계산 ③ LLM 어댑터 코드를 현행(2026-08-03) Anthropic·OpenAI API 문서와 대조 ④ 배포 스크립트·IAM 권한 시나리오 검토 ⑤ 제출 요건(12 문서) 매핑 점검 |
| 결론 | **진행 가능.** 아키텍처·계약·일정·제출 대응이 서로 정합. 단 §3 블로커 2건은 "배포 최종 1회(T17)" 구조상 당일 발견하면 복구 시간이 없으므로 **착수 첫 커밋에서 선수정** |

## 2. 검증 통과 항목 (변경 불필요 — 근거 기록)

| 영역 | 확인 내용 |
|---|---|
| 문서↔코드 정합 | backend 골격(`main.py`·`dataload.py`·routes)=07 원문 일치 · `pipeline/common.py`=06의 상수·계산식(REGIONS 6종, ANCHOR, EUP_WEIGHTS 0.5/0.5, CAND_WEIGHTS 각 1/3, gini→지수 변환, HHI 분산도) 일치 · `infra/template.yaml`=09 §1(HttpApi CORS, python3.12, Timeout 30, 512MB, DynamoDBCrudPolicy, 로그 7일) 일치 |
| 기산출물 | P1 `usage_monthly.json`(12개월×18업종)·P7 `risk_signal.json`(4개 시군구 14.6~15.1%)이 14 문서 "현재 상태" 기재값과 일치 (멀티에이전트 독립 재계산 검증 통과분) |
| 05 계약 예시의 내적 일관성 | 읍 Score 0.71=0.5×0.65+0.5×0.77 · 후보 Score 0.57=(1.0+0.7−0.0)/3 · 지역 전환율 3.2%≈12,450/385,200 · `region_share` 합=1.0 — FE가 mock으로 그대로 써도 안전 |
| LLM 어댑터(07 B3) 현행성 | `claude-sonnet-5`는 유효한 현행 모델 ID(가격 $3/$15, 인트로 $2/$10 — 02·09 기재와 일치) · 구조화 출력 `output_config={"format": {"type": "json_schema", ...}}` 형태 정확 · Sonnet 5에서 `thinking={"type": "disabled"}` 허용 확인 · OpenAI `response_format` json_schema strict 형태 정확 · `CARD_AI_SCHEMA`의 `additionalProperties: False` 정확 |
| 시크릿·제출 요건 | .gitignore가 `.env`·기획서 PDF 2종·`geocode.json`·`backend/app/data/` 커버 · 커밋 이력에 키 없음 · README가 12 문서 심사 요건 구조로 작성됨 |

## 3. 배포 블로커 2건 — 개발 착수 첫 커밋에서 수정 ⚠

배포가 개발 완료 후 최종 1회(09 §4)라 이 두 건은 T17 당일 발견 시 복구 시간이 없다.

### 3-1. `infra/deploy-backend.sh` — `sam deploy -t template.yaml`이 빌드 산출물을 무시

- [x] deploy 줄에서 `-t template.yaml` 제거 (build 줄은 유지)

현재 (14~15행):

```bash
sam build -t template.yaml
sam deploy -t template.yaml \      # ← 문제: 소스 템플릿 명시 → .aws-sam/build/ 무시
```

수정:

```bash
sam build -t template.yaml
sam deploy \                       # 인자 없으면 .aws-sam/build/template.yaml 사용
```

**메커니즘:** `sam deploy`에 `-t`로 소스 템플릿을 명시하면 `sam build`가 만든
`.aws-sam/build/`(pip 의존성 설치본)를 쓰지 않고 소스 템플릿의 `CodeUri: ../backend`를
그대로 압축해 올린다 → fastapi·mangum·openai 미포함 → 전 엔드포인트
`Unable to import module 'app.main'` 500 (09 트러블슈팅 메모에 이미 있는 바로 그 증상).
사전 검증(09 §4)은 `sam build`까지만 통과했고 `sam deploy`는 실행된 적이 없어 발견되지 않았다.
수정 후 로컬 확인법: `sam build` 후 `.aws-sam/build/ApiFunction/`에 `fastapi/` 디렉토리 존재 여부.

### 3-2. 14 문서 T17 Step 1 — 기재된 IAM 인라인 정책으로는 `sam deploy` 불가

- [x] 14 문서 T17 Step 1을 "한시 `AdministratorAccess` 부착(04 §5 후주와 동일) → 캠프 종료 후 회수"로 교체

현행 정책(`cloudformation:* / apigateway:* / dynamodb:*`)에 빠진 필수 권한:

- `iam:CreateRole`·`PutRolePolicy`·`AttachRolePolicy`·`PassRole`·`GetRole` — Lambda 실행 역할 생성 (SAM은 호출자 권한으로 역할을 만든다)
- `lambda:*` — 함수 생성·코드 배포
- `s3:*` — `--resolve-s3` 관리 버킷 생성·아티팩트 업로드
- `logs:*` — `ApiLogGroup` 리소스 생성

권장: 권한 나열 누락 리스크를 없애기 위해 04 §5 후주("캠프 기간 AdministratorAccess 무방")대로
한시 부착 후 회수. 부착 작업 자체도 `Yutak_trading`에 `iam:PutUserPolicy` 권한이 없으면
CLI로 불가하므로 **콘솔(관리자 권한) 경로**로 수행한다.

## 4. API 계약 공백 3건 — 해당 태스크 진입 시 05 문서 선수정

### 4-1. `merchants.json`에 `address` 필드 없음 — T2 진입 전

- [x] 05 §1 `merchants` 스키마와 §6 표에 `address` 추가 → T2(P3) 산출물이 채움

위젯 응답(05 §4)은 `address`를 내려주는데, 원천인 merchants 스키마(05 §1)는
`{name, category, eup, lat, lng}`뿐이라 B6이 채울 데이터가 없다. P3가 지오코딩 입력으로
주소를 어차피 수집하므로 산출물에 싣기만 하면 된다.

### 4-2. 업종 분류 3계층 매핑 정본 부재 — T3에서 확정

- [x] `pipeline/category_map.py`를 단일 정본으로 매핑 3종 확정 + 05에 표시명 롤업 규칙 1줄 명시
      (매핑 ③은 가맹점 API에 업종 필드가 없어 **상호명 키워드 규칙** `MERCHANT_NAME_RULES`로 확정 — T2)

실데이터 업종 18종(P1 산출 `usage_monthly.json`의 categories: 커피전문점·일반음식점업·슈퍼마켓·숙박업·소매업 등)
↔ 13 §5 표시 6분류(카페·음식점·편의점·숙박업·소매점·기타) ↔ 소진공 대분류(`indsLclsNm`)
↔ 가맹점 API 업종명(승인 후 실측)이 서로 리터럴 불일치. 확정할 매핑 3종:

1. 하이원 18종 → 표시 6분류 롤업 (T4 `category_share` 도넛, 차트 팔레트)
2. 표시 분류 ↔ 소진공 대분류 (2단계 후보 산출·`nearby_stores`)
3. 가맹점 API 업종명 → 표시 분류 (F7 위젯 업종 선택, 카드 `target.category`, B6 완료 카드↔가맹점 매칭)

### 4-3. INCENTIVE 카드 전체 예시 JSON 부재 — T4(05 계약 확장) 시

- [x] 05 §2에 INCENTIVE 완성 예시 1개 추가 (`ai` 필드 사용 여부 명시) — `ai`는 EXPANSION과
      동일 스키마 재사용, `original_ranking`만 null (T4)

현재 05 §2에는 `scenarios`/`selected_rate` 스니펫만 있고, LLM이 생성하는 시나리오 비교문·리스크가
`ai` 필드를 재사용하는지 미정. F6이 mock으로 먼저 개발되므로 FE·BE가 어긋나기 가장 쉬운 지점.

## 5. 구현 중 결정·반영 사항 (경미 — 해당 태스크에서 처리)

- [x] **T4·T13** 지역 균형지수 정의 명시 — 6개 지역 고정 분모면 데모 시점(승인 2장)에 ~33으로 목업(80)과 괴리. 05 §3에 정의를 확정하고 데모 멘트를 "카드가 쌓일수록 오르는 지표"로 잡는다 (T4에서 05 §3 확정)
- [x] **T4·T11** `avg_approval_hours` 집계 대상(approved만 vs 반려 포함) 1줄 정의 + 시드 카드 `created_at`은 과거 시각으로 (0.0h 표시 방지) — 정의는 05 §3에 확정(T4), 시드 `created_at` 과거 시각(2일 전 생성·1.5일 전 승인 = 12.0h)은 T11 `seed_demo.py`에서 반영 완료
- [ ] **T5** P6 min-max 정규화에 `min==max` 가드 (분모 0)
- [x] **T10** `generate_json()`에 timeout 인자 추가 — 05 §4 blurb의 5초 타임아웃을 현재 시그니처(`system, user, schema`)로는 지킬 수 없음
- [x] **T11** 시드의 "Score 2위→AI 1위" 카드는 LLM 호출 없이 **고정 JSON**으로 생성 (리허설·심사 리셋 시 서사 재현성 보장) — `seed_demo.py` 카드 B(영월군 소매점)로 반영 완료
- [x] **T12** B5 반사실 가정치의 분모 0 처리 — 공백 업종은 정의상 해당 지역 가맹점 0곳이라 "해당 업종 지역 건수÷가맹점 수"가 기본 케이스에서 0나눗셈. "전 지역 동일 업종 평균 건수" 등 대체 가정을 명시
- [x] **T7·T14** pytest·httpx는 `backend/requirements-dev.txt`로 분리 (Lambda 번들 오염 방지 — 07 의존성 원칙) — T14에서 확인 완료: requirements.txt만 설치한 venv에서 `import app.main` 성공(pytest·httpx2 미설치). TestClient의 HTTP 클라이언트는 starlette 1.3의 권장에 따라 `httpx` → `httpx2`
- [ ] **T18 전** 12 §1 상태 칸 갱신 — "현재 Private + 커밋 0개"는 stale (현재 상태의 정본은 14 문서)

## 6. 문서 참조 정정 (off-by-one) — 착수 첫 커밋에서 일괄

- [x] 아래 4곳의 "14 문서 T16" → **T17** (T7 Docker 태스크 삽입으로 넘버링이 밀림; T16=로컬 풀루프, T17=AWS 최종 배포)

| 위치 | 현재 문구 |
|---|---|
| 09 §4 (163행) | "상세 시퀀스: 14 문서 T16" |
| 09 §4 (169행) | "인라인 정책 부착 (14 문서 T16 Step 1)" |
| 10 문서 Phase 1 (36행) | "(09 §4, 14 문서 T16)" |
| CLAUDE.md 자주 쓰는 명령 | "(docs/plan/09 §4, 14 문서 T16)" |

## 7. 진행 방식 제안 — Vercel Import 조기화 (채택 시 14 문서 수정)

- [x] Vercel Import+첫 Deploy를 T17 Step 5에서 **F1 머지 직후**로 이동

근거: F9 검증이 요구하는 PR Preview URL 스모크가 현재 순서(T17에서 최초 Import)로는
개발 기간 내내 불가능. Import는 AWS와 무관하고 비용 0. `NEXT_PUBLIC_API_BASE` 미설정
배포가 mock 모드로 도는 것은 12 §5가 이미 비상 폴백으로 설계한 동작이라 리스크도 없다.
(10 문서 Phase 0의 "Import까지만" 보류를 해제하는 것 — T17 Step 5에는 env 설정과
Production 재배포만 남긴다.)

## 8. 반영 시점 요약

| 시점 | 항목 |
|---|---|
| **착수 첫 커밋** | §3-1 deploy 스크립트 · §3-2 T17 Step 1 문구 · §6 참조 정정 4곳 · (§7 채택 시 14 문서 수정) |
| T2 진입 전 | §4-1 merchants `address` (05 먼저) |
| T3 | §4-2 `category_map.py` 3계층 매핑 (05 먼저) |
| T4 | §4-3 INCENTIVE 예시 · §5 균형지수·`avg_approval_hours` 정의 (05 계약 확장 태스크에 포함) |
| T5 / T7 / T10 / T11 / T12 / T14 | §5 해당 항목 |
| F1 머지 직후 | §7 Vercel Import+첫 Deploy |
| T18 전 | §5 12 §1 상태 갱신 |

## 9. 잔존 리스크 (계획 변경 없음)

최대 외부 리스크는 data.go.kr 활용신청 승인(T0 게이트, T1~T3 의존) — 기존 계획의
목업 CSV 폴백(10 문서 리스크 표)이 유효하므로 추가 조치 없음. 지도(Safari)·LLM 스키마
위반·지오코딩 실패율 리스크도 기존 대응표를 그대로 유지한다.
