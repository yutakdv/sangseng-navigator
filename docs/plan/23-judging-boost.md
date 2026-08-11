# 23. 심사 보강 근거 문서 (v4.1 마무리 — Task D4)

이 문서는 "심사 보강으로 무엇을 왜 그렇게 만들었는가"의 정본이다. 평가 5항목 대응은
루트 [README.md](../../README.md) "📊 심사 항목별 확인 지점" 표가 화면 중심 정본이고, 아래 §1은
그 표를 그대로 옮기되 근거 파일 경로를 더 정확히 단다. §2~§4는 셀 부하·임팩트·프라이버시
설계의 산식·실값·한계를 코드와 산출물에서 직접 확인해 기록한다.

## 1. 평가 5항목 대응표

| 항목 | 무엇으로 보여주나 | 근거 파일 |
|---|---|---|
| 창의성 | 반전 장면 — 민감도를 올렸는데 처방이 공급 측으로 뒤집힌다 | `frontend/src/components/CellExplorer.tsx`(판정 로직, §2) |
| 창의성 | AI 반대 관점 — AI를 쓰되 통제한다는 증거 | `backend/app/services/cardgen.py`(`CARD_AI_SCHEMA.dissent`) · `backend/app/prompts.py` |
| 데이터활용성 | 공공데이터 6종 원천 · 10단계 파이프라인 · 가중치 95개 조합 민감도 분석 | `pipeline/p1_usage.py`~`p10_privacy.py` · `pipeline/p8_sensitivity.py` |
| 데이터활용성 | 소표본 보호(k=5) · 데이터셋 버전 manifest · 출처 칩 | `pipeline/p10_privacy.py`(§4) · `pipeline/tests/test_privacy.py` |
| 완성도 | LLM 인젝션 격리 · fail-closed 설계 · 자동 테스트 | `backend/app/prompts.py`(`<data>` 블록 격리) · `backend/tests/test_injection.py` |
| 완성도 | 8개 화면 · 로딩/404/에러 경계 · 실 API 전용(주소 누락 시 fail-fast) | `frontend/src/app/`(라우트 8개) · `frontend/src/lib/api.ts` |
| 활용가치 | 임팩트 헤드라인과 승인 워크플로 | `data/processed/dashboard.json`(`impact_meta`, §3) · `backend/app/routes/cards.py` |
| 활용가치 | 셀 부하 기반 투트랙 처방 분기 | `pipeline/p9_cell_load.py`(§2) · `frontend/src/components/CellExplorer.tsx` |
| 사회적가치 | 특별법상 지역경제 진흥 책무 · 개인사업자 역산 방지 | `pipeline/p10_privacy.py`(§4) · `privacy_meta` |

## 2. 셀 부하 산식·임계값 근거

- **산식**: 부하 지수 = 최근 3개월 평균 월 거래 건수 ÷ 셀 가맹점 수(`pipeline/p9_cell_load.py:4,18-19`,
  `WINDOW=3`은 같은 파일 15행). 기준월 2025-12 기준 집계 창은 2025-10~2025-12
  (`data/processed/cell_load.json`의 `window_months`). 평균 건수·부하 지수 모두 소수 1자리로
  반올림한다(`p9_cell_load.py:57,59`). 가맹점 5곳 미만 셀은 k-익명성 보호로 값을 비공개(`suppressed`) 처리한다.
- **원 계획 대비 변경 경위**: 원 계획은 결제 금액 기준 "한도 소진율"이었다. 그러나 하이원포인트
  사용현황 원본 CSV에 금액 컬럼이 없고 건수 컬럼만 있어(`p9_cell_load.py` 모듈 docstring), 건수 기반
  "가맹점 이용 부하(추정)"로 대체했다(v4.1 확정 결정 #1). 그래서 이 지표는 모든 화면에
  `추정치` 배지 + 산식 툴팁이 필수다(절대 규칙 7).
- **임계값 실값**(2025-12 기준월, `data/processed/cell_load.json`): 상위 구간 기준선(75분위) **34.0**,
  하위 구간 기준선(25분위) **14.2**. 값이 공개된 32개 셀(전체 34개 중 2개는 억제) 중 tier 분포는
  상위 8 · 중간 16 · 하위 8이다.
- **포화 감쇠 0.5 가정**: `frontend/src/components/CellExplorer.tsx:46`의 `DAMPING`(=0.5)과 44행의
  반전 기준선 `FLIP_GAP_PP`(=0.75%p)는 실측 탄력성이 아니라 팀이 정한 상수다. 화면이 그 사실을
  직접 밝힌다(같은 파일 24행 주석, 329행 본문). 판정 규칙: 부하 상위 구간 셀에서
  (포화되지 않은 셀의 전망 − 이 셀의 전망) ≥ 0.75%p면 처방을 공급 측(가맹점 확충)으로 돌린다.

## 3. 임팩트 계산 가정

- **화면에 쓰는 근거**(`data/processed/dashboard.json`의 `impact_meta`): 연간 지역 사용 건수
  507,628건, 연간 입장 연인원 2,478,656명. 지역 전환율(근사 지표) 1%p 개선 시 연간 추가 건수 =
  연인원 × 1% = **24,787건**(`per_pp_additional_uses`). `basis`는 `"count"`이고, `note`에
  "가정 기반 전망이며 실제와 다를 수 있음" 문구가 고정 포함된다.
- **금액 환산은 하지 않는다**(폐기된 경로). 강원랜드가 하이원포인트 발생액 총액을 공개한 적이
  없어 "1%p당 금액"을 계산할 분모 자체가 없다.
- **참고용 금액 기준 추세**(강원랜드 지속가능경영보고서 공식 공표치 — 화면에는 노출하지 않고
  발표 자료 전용): 2023년 328억 원(28.1%) → 2024년 355억 원(29.4%) → 2025년 415억 원
  (전년 대비 +16.8%, 역대 최대).
- 본 서비스의 "지역 전환율(근사 지표)"은 거래 건수 ÷ 입장 연인원의 **건수 기준** 지표이고,
  위 금액 기준 지표(분자=지역 사용금액)와는 산정 기준 자체가 다른 별개 지표다. 절대 규칙 2에
  따라 화면에서 두 지표를 나란히 비교 표기하지 않는다.

## 4. k=5 억제·반올림 설계와 한계

- **설계**(`pipeline/p10_privacy.py`): K=5(가맹점 5곳 미만인 지역×업종 셀은 건수 비공개),
  반올림 단위 100(`ROUND_UNIT`). 대상 파일 3종 — `usage_monthly.json`(셀 자체 억제),
  `usage_daily.json`(요일 축 셀 억제 + 행/열 마진 반올림), `dashboard.json`
  (`monthly_by_region`·`region_share`·`category_share` 중 영향받는 값만 반올림). 비율·순위·스코어는
  반올림 전 원값으로 계산해 확정치는 흔들지 않는다.
- 기준월 2025-12 기준 실제 억제 셀은 2곳이다: 영월군×카페(가맹점 2곳) · 영월군×편의점
  (가맹점 4곳)(`data/processed/cell_load.json`).
- **한계 — 완전 차단이 아니다**(`p10_privacy.py:15` `NOTE`에도 명시). 재리뷰가 차분 복원
  (다른 합계와의 차로 비공개 값을 역산하는 공격)을 직접 시도해 정량화했다. 월별 경로
  (`usage_monthly`/`dashboard`)는 100 단위 반올림 설계상 오차가 ±50건이다. 일별 경로
  (`usage_daily`)는 실측 결과 행 마진(영월군 요일 합 − 공개 셀 합) 경로 오차가 요일별 ±30~80건,
  열 마진("전체"의 억제 업종 − 나머지 5개 지역) 경로 오차가 최대 49건으로 나타나, 월별 설계와
  동등한 수준으로 판정됐다.
