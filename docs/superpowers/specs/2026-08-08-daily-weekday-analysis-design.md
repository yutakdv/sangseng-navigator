# ⑦ 일별·요일 분석 설계 — usage_daily 파이프라인 + 지역 드릴다운 확장 + AI 근거 주입 (A안)

> 2026-08-08 확정. 데모 피드백 ⑦("지역별·날짜별·요일별·날씨에 따른 사용 업종 분석 기반 AI 추천") 대응.
> 사용자 결정: A안(드릴다운 확장) 본선 / C안(방문객 위젯 요일 추천)·날씨 축은 후순위 스트레치.
> 날씨는 기존 `DATA_GO_KR_API_KEY`가 기상청 ASOS 서비스에 미등록(실호출 확인:
> SERVICE_KEY_IS_NOT_REGISTERED_ERROR)이라 활용신청 승인 후에만 진행한다.

## 데이터 근거 (실측)

`data/raw/highone_point_usage.csv`의 `가맹점 영업일자`가 2025-01-01~12-31 **365일 누락 없는
일 단위**이고 같은 행에 업종 18종×지역 6곳이 있다(5,831행). 요일 신호 실재: 전체 합계 기준
토요일이 월요일 대비 약 +19.5%(토>일>수>금>화>목>월). 기존 p1은 `.str[:7]`로 월 절삭만 했다.

## 산출물 1 — 파이프라인: `data/processed/usage_daily.json` (p1_usage.py 확장)

`usage_monthly.json`은 **변경하지 않는다**(simulate·P5~P8 소비 계약 유지). p1이 같은
DataFrame에서 일별 집계를 추가 산출한다.

```jsonc
{
  "source": "data/raw/highone_point_usage.csv",
  "period": { "start": "2025-01-01", "end": "2025-12-31", "days": 365 },
  "region_note": "<usage_monthly와 동일 문구>",
  "weekday_labels": ["월", "화", "수", "목", "금", "토", "일"],   // 인덱스 = pandas dayofweek
  "weekday_days": [52, 52, 53, ...],                              // 요일별 일수(평균 분모, 7개)
  // 요일×표시6분류 누적 건수. 지역 6곳 + "전체". 평균/지수화는 소비처가 계산한다.
  "weekday_category": { "영월군": { "카페": [7개 정수], ... }, ..., "전체": { ... } },
  // 지역별 일 단위 총건수 시계열(365쌍). 추이 라인·이동평균용.
  "daily_total": { "영월군": [["2025-01-01", 313], ...], ..., "전체": [...] }
}
```

- 요일 축은 **표시 6분류로 사전 롤업**한다(정본 `pipeline/category_map.py` HIGHONE_TO_DISPLAY).
  월 원장(18종 유지)과 달리 요일 축의 소비처(FE 패널·AI 근거)가 전부 6분류 단위라서다.
- 정수 누적만 싣는다 — 반올림·평균은 표시 계층에서. (`weekday_days`가 평균 분모)

**검증**: 일회성 독립 재계산 스크립트(스크래치패드)로 ① Σdaily_total(지역) =
usage_monthly 총합, ② Σweekday_category = 같은 총합, ③ weekday_days 합 = 365,
④ 표본 날짜 2~3개 원본 CSV 수기 대조.

## 산출물 2 — FE: 지역 드릴다운에 "요일·일별 패턴" 섹션

`{지역} 상세 분석` 그룹(dashboard/page.tsx, ②에서 신설)에 섹션 추가. 서버 컴포넌트 전용.

- `lib/api.ts`: `usageDaily()` — usage_monthly와 동일하게 **mock 사본 정적 import, BE 엔드포인트
  없음** (분기 배치 산출물, 양 모드 동일 — 05 §6에 기록).
- `lib/regionAnalysis.ts`: 순수 함수 추가 — 요일별 하루 평균(전체·업종별), 주중/주말 대비 배율,
  일별 추이(+7일 이동평균). 기존 함수들과 같은 스타일.
- 컴포넌트: `WeekdayPatternPanel` — ① 요일별 하루 평균 막대(최대 요일 강조), ② 업종×요일
  패턴(형태는 dataviz 스킬 기준으로 구현 시 확정 — 히트맵 또는 소표), ③ 일별 추이 라인
  (원자료 옅게 + 7일 이동평균), ④ 인사이트 한 줄("토요일 하루 평균 N건 — 주중 대비 +M%").
- 표기 규칙: 실측 **집계**라 "가정 기반 전망" 문구·`근사 지표` 배지 대상 아님(전환율·시뮬레이션
  아님). 지역 각주(정선군 잔여·삼척 도계읍)는 기존 `USAGE_REGION_FOOTNOTE` 재사용.
  차트 팔레트는 13 §5 고정값.

## 산출물 3 — BE: 카드 생성 AI 입력 ⑧ "타깃 요일 패턴(참고용)"

- `cardgen._build_inputs()`에 `8_타깃_요일_패턴(참고용)` 추가: `dataload.load("usage_daily")`에서
  타깃 eup×표시업종의 요일별 하루 평균(소수 1자리)·최대 요일·주중 대비 배율을 요약.
  risk_signal(⑦)과 동일하게 **파일 없으면 컷** — 실패 내성.
- `prompts.CARD_SYSTEM_PROMPT` 입력 목록에 8 추가 + 규칙: "참고용 — 방문 수요가 몰리는
  시점(요일) 관련 리스크·유의사항 서술에만 사용, 순위·대상 변경 근거로 쓰지 말 것,
  입력에 없는 수치를 만들지 말 것".
- 테스트: 기존 spy 패턴(test_simulate_does_not_hand_indices_to_the_llm과 동형)으로
  ① payload에 입력 ⑧ 포함, ② usage_daily 부재 시 생성이 죽지 않고 ⑧만 빠짐을 검증.

## mock 동기화·계약 기록

- `scripts/sync-mocks.sh` COPY 목록에 `usage_daily.json` 추가, `frontend/src/mocks/usage_daily.json` 커밋.
- `docs/plan/05-api-contract.md` §6 표에 행 추가 + 정적 import 결정 불릿(이 문서가 그 기록).
- `docs/plan/06-pipeline-tasks.md` P1 산출 목록에 한 줄 추가.

## 절대 규칙 점검

Gini/HHI 용어 무관·미노출 / 전환율 미표시(배지 불필요) / 관측 집계라 전망 문구 불필요 /
AI는 여전히 근거 제공·제안만(입력 ⑧은 참고용 명시) / 국세청 데이터 무관.

## 검증 계획 (완료 기준)

1. 파이프라인 독립 재계산 4항 전부 일치
2. `pytest backend/tests/` 전부 통과(신규 테스트 포함, DynamoDB Local 상대)
3. FE `tsc --noEmit`·`eslint`·`next build`·금칙어 검사 통과
4. Docker 풀루프: 드릴다운 요일 섹션 표시 + 카드 생성 시 AI 입력 ⑧ 포함 확인
