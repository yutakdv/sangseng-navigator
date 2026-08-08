import type { IconName } from "@/components/Icon";
import type { ProgressMetricKey } from "@/types";

/**
 * 추진 기록 관측 지표 메타 — 화면 쪽 단일 정의 (05 §2-1 · backend/app/services/progress_report.py METRIC_META).
 *
 * 같은 표가 리포트 카드·타임라인·입력 폼 세 곳에 각각 복제돼 있었고, 관측값 흐름(T-C)이
 * 네 번째 복제를 만들 참이라 앞의 둘을 여기로 모았다. 입력 폼(ProgressRecordForm.METRIC_FIELDS)은
 * placeholder·step·max 같은 입력 전용 속성이 붙어 있어 따로 두되, `digits`는 반드시 같은 값이어야 한다
 * (저장 확인 칩과 타임라인 표기가 어긋나면 같은 값이 다른 자리에서 다르게 보인다).
 *
 * `lowerIsBetter`는 BE METRIC_META와 같은 값이어야 한다 — 화면이 개선 방향을 반대로 말하면
 * 리포트의 `improvement` 부호와 어긋난다.
 */
export interface ProgressMetricMeta {
  key: ProgressMetricKey;
  /** 리포트 카드처럼 폭이 있는 자리 */
  label: string;
  /** 타임라인 셀처럼 좁은 자리 */
  shortLabel: string;
  icon: IconName;
  unit: string;
  /**
   * 변화량(Δ)에 붙는 단위 — 값 단위와 같을 수 없는 지표가 있어 따로 둔다.
   *
   * 지역 전환율은 값이 `%`지만 20.10%→21.40%의 차이는 1.30**%p**다. 값 단위를 그대로 쓰면
   * "▲1.30%"가 되어 실제(0.26%p)와 5배 다른 값을 말하게 된다. 절대 규칙 2로 배지까지 붙여
   * 방어하는 지표라 여기서 단위를 틀리면 안 된다.
   */
  deltaUnit: string;
  digits: number;
  lowerIsBetter: boolean;
}

/**
 * ⚠ 배열 순서는 기존 리포트 타일·타임라인 셀의 배치 순서 그대로다 — 바꾸면 두 화면의
 * 타일 배열이 조용히 달라진다.
 */
export const PROGRESS_METRICS: ProgressMetricMeta[] = [
  {
    key: "usage_count",
    label: "지역 사용 건수",
    shortLabel: "지역 사용",
    icon: "receipt",
    unit: "건",
    deltaUnit: "건",
    digits: 0,
    lowerIsBetter: false,
  },
  {
    key: "conversion_rate_pct",
    label: "지역 전환율",
    shortLabel: "지역 전환율",
    icon: "trend",
    unit: "%",
    deltaUnit: "%p",
    digits: 2,
    lowerIsBetter: false,
  },
  {
    key: "active_merchant_count",
    label: "활성 가맹점 수",
    shortLabel: "활성 가맹점",
    icon: "store",
    unit: "곳",
    deltaUnit: "곳",
    digits: 0,
    lowerIsBetter: false,
  },
  {
    key: "spend_krw",
    label: "지역 사용액",
    shortLabel: "지역 사용액",
    icon: "wallet",
    unit: "원",
    deltaUnit: "원",
    digits: 0,
    lowerIsBetter: false,
  },
  {
    key: "concentration_index",
    label: "지역 소비 집중도",
    shortLabel: "소비 집중도",
    icon: "scatter",
    unit: "점",
    deltaUnit: "점",
    digits: 2,
    lowerIsBetter: true,
  },
];

/** 절대 규칙 2 — 이 키가 화면에 보이면 반드시 `근사 지표` 배지(ProxyBadge)를 병기한다 */
export const PROXY_METRIC_KEY: ProgressMetricKey = "conversion_rate_pct";

export const metricMeta = (key: ProgressMetricKey): ProgressMetricMeta =>
  PROGRESS_METRICS.find((meta) => meta.key === key) ?? PROGRESS_METRICS[0];

export const formatMetric = (value: number, digits: number): string =>
  value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
