import type { IconName } from "@/components/Icon";
import type { ProgressMeasurement, ProgressMetricKey, ProgressMetrics } from "@/types";

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
  /**
   * 값 단위의 **폴백**이다. 저장된 관측값에는 서버가 채운 `unit`이 함께 오고 그쪽이 정본이므로,
   * 관측값을 그릴 때는 반드시 `metricUnit()`을 거쳐 서버 값을 우선한다 —
   * 지표 정의(단위·근사 여부)의 정본은 서버 한 곳이고, 여기 값은 아직 관측이 없는 자리
   * (입력 폼의 단위 표시·기간 리포트 타일)에서만 쓰인다.
   */
  unit: string;
  /**
   * 변화량(Δ)에 붙는 단위 — 값 단위와 같을 수 없는 지표가 있어 따로 둔다.
   * **이 값은 서버가 내려보내지 않으므로 화면이 계속 정본을 가진다.**
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

/**
 * 기록 하나에서 관측값을 꺼낸다 — **구형 기록의 스칼라도 받는다.**
 *
 * 계약 개정으로 `metrics`의 값이 스칼라에서 객체(`{value, 측정 기간·출처·범위, 단위}`)가 됐고,
 * 서버도 과거 기록을 읽을 때 두 형태를 모두 받는다(`services/progress_report._metric_value`).
 * 화면만 객체를 단정하면 개정 이전 기록이 섞인 카드에서 타임라인이 통째로 죽는다.
 * 스칼라였던 기록에는 측정 메타가 애초에 없으므로 빈 값으로 두고, 화면은 없는 근거를 지어내지 않는다.
 */
export function measurementOf(
  metrics: ProgressMetrics | undefined | null,
  key: ProgressMetricKey,
): ProgressMeasurement | null {
  const raw = metrics?.[key] as ProgressMeasurement | number | null | undefined;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return {
      value: raw,
      measured_from: "",
      measured_to: "",
      source: "",
      scope: "",
      unit: metricMeta(key).unit,
      is_proxy: key === PROXY_METRIC_KEY,
    };
  }
  return raw;
}

/**
 * 관측값에 붙일 단위 — **서버 값이 있으면 그것을 쓴다.**
 *
 * 단위 정의가 서버와 화면 두 곳에 있으면 어느 쪽이 정본인지 흐려진다. 저장된 관측값에는
 * 서버가 지표 정의에서 채운 단위가 함께 오므로 그 값을 우선하고, 위 표는 값이 없을 때의
 * 폴백으로만 쓴다. **변화량 단위(`deltaUnit`)는 여기 해당하지 않는다** — 서버가 내려보내지
 * 않는 값이고, %와 %p를 뒤바꾸면 화면이 실제와 5배 다른 값을 말하게 된다.
 */
export const metricUnit = (
  key: ProgressMetricKey,
  observed?: Pick<ProgressMeasurement, "unit"> | null,
): string => observed?.unit?.trim() || metricMeta(key).unit;

/** 관측값이 근사 지표인지 — 서버 판정이 정본이고, 없으면 절대 규칙 2의 고정 키로 본다 */
export const metricIsProxy = (
  key: ProgressMetricKey,
  observed?: Pick<ProgressMeasurement, "is_proxy"> | null,
): boolean => observed?.is_proxy ?? key === PROXY_METRIC_KEY;

export const formatMetric = (value: number, digits: number): string =>
  value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
