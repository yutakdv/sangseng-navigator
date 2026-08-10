import { Icon } from "@/components/Icon";

/**
 * 공공데이터 6종 카탈로그 — 값은 전부 **실제 원본·파이프라인에서 확인한 사실**이다.
 *
 * 각 항목의 근거:
 *   - 규모·인코딩·컬럼: `data/raw/`의 실제 헤더와 행 수, `data/raw/api_cache/*.json`의 total_count
 *   - 엔드포인트·수집 전략: `pipeline/p1~p7`의 명세 주석(실호출 검증 기록)
 *   - 산출물·사용 화면: `pipeline/run_all.py` → `data/processed/` → 각 화면의 api 호출
 * 화면에 적힌 컬럼명이 원본과 어긋나면 심사에서 가장 아픈 지적이 되므로, 여기 값을 고칠 때는
 * 반드시 원본 파일을 다시 열어 대조한다 — 기억이나 문서 요약으로 고치지 않는다.
 *
 * data.go.kr 상세 페이지 URL은 **실제로 확인된 2건에만** 건다. 나머지는 링크를 지어내는 대신
 * 검증된 API 엔드포인트를 그대로 노출한다 (없는 링크를 만드는 것보다 정확하다).
 */
type Dataset = {
  no: number;
  title: string;
  agency: string;
  /** CSV 파일데이터인지 오픈 API인지 */
  kind: "파일데이터 (CSV)" | "오픈 API";
  href?: string;
  endpoint?: string;
  /** 원본 규모 — 행 수·건수와 수집 시점 */
  scale: string;
  /** 실제로 읽는 컬럼·필드 (원본 표기 그대로) */
  fields: string;
  /** 파이프라인 스크립트 → 산출 파일 */
  pipeline: string;
  /** 이 데이터가 실제로 그려지는 화면 */
  screens: string;
  /** 어디까지 가공하는가 */
  depth: string;
  /** 해석·사용 제약 — 있을 때만 */
  caution?: string;
};

const DATASETS: Dataset[] = [
  {
    no: 1,
    title: "강원랜드 하이원포인트 사용현황",
    agency: "(주)강원랜드 · 공공데이터포털",
    kind: "파일데이터 (CSV)",
    href: "https://www.data.go.kr/data/15106402/fileData.do",
    scale: "5,832행(헤더 포함) · 2025-01~2025-12 일 단위 · CP949 인코딩",
    fields: "가맹점 영업일자 / 업종 / 고한읍·사북읍·정선군·태백시·영월군·삼척시 건수",
    pipeline: "p1_usage.py → usage_monthly.json · usage_daily.json",
    screens: "전체 지역 현황(진단 지표·추이·분포) · 지역 상세 분석 전체 · 셀 부하 탐색",
    depth: "집계 → 지수화(집중도·분산도) → 1단계 스코어 입력",
    caution:
      "금액 컬럼이 없다 — 모든 값이 거래 건수다. 예산·ROI를 산출하지 않는 이유가 여기에 있다.",
  },
  {
    no: 2,
    title: "하이원포인트 가맹점 상세정보",
    agency: "(주)강원랜드 · 공공데이터포털",
    kind: "오픈 API",
    href: "https://www.data.go.kr/data/15133571/openapi.do",
    endpoint: "apis.data.go.kr/B552525/pbdata/getStoreInfo",
    scale: "API 1,682건 전수 수집 (2026-08-04, totalCount까지 페이징 완주) → 산출물 1,679건",
    fields: "FRCS_REG_NO / FRCS_NM / FRCS_ADDR / PNT_USABLE_AMT",
    pipeline: "p3_merchants.py → merchants.json (주소 지오코딩 + 업종·읍 부여)",
    screens: "지역 배치 지도 · 방문객 위젯 추천 · 2단계 기존가맹포화도",
    depth: "수집 → 지오코딩 → 반경 500m 공간 계산 → 2단계 스코어 입력",
    caution:
      "수집 1,682건과 산출 1,679건의 차이 3건은 주소 지오코딩에 실패해 좌표를 얻지 못한 가맹점이다(석항마트·영주상회·윈펜션) — 지도와 거리 계산에 쓸 수 없어 제외했고, 조용히 버리지 않도록 실패 목록을 파일로 남긴다. 사업자등록번호(FRCS_BRNO)·전화번호(FRCS_TELNO)는 응답에 포함되지만 캐시 저장 단계에서 제외한다.",
  },
  {
    no: 3,
    title: "일자별 카지노 입장객 현황",
    agency: "(주)강원랜드 · 공공데이터포털",
    kind: "오픈 API",
    endpoint: "apis.data.go.kr/B552525/DailCustCntService/getDailCustCnt",
    scale: "2025-01~2025-12 · 1,095행 (365일 × 1·2·3부 교대)",
    fields: "BSN_DT / BSN_HR_CN(1·2·3부) / NATIVE_CNT / FRGNR_CNT",
    pipeline: "p2_visitors.py → usage_monthly.json의 visitors_monthly",
    screens: "지역 전환율의 분모 · 리조트 체류 규모 vs 지역 전환 건수",
    depth: "교대 합산 집계 → 비율의 분모",
    caution:
      "일 입장객 = Σ(내국인+외국인)을 1·2·3부까지 더한 값이라 실인원이 아니라 연인원이다. 이것이 지역 전환율을 근사 지표로 표기하는 직접적인 이유다.",
  },
  {
    no: 4,
    title: "소상공인시장진흥공단 상가(상권)정보",
    agency: "소상공인시장진흥공단 · 공공데이터포털",
    kind: "오픈 API",
    endpoint: "apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong",
    scale: "6개 지역 10,044건 · 기준월 2026-06 (지역 단위로 통째 수집 후 캐시)",
    fields: "상호 / 업종 대분류·중분류·소분류 / 위도 / 경도",
    pipeline: "p4_stores.py → stores_<지역>.json → p6_scoring.py → candidates.json",
    screens: "제안의 정량 근거 · 2단계 후보 스코어(업종공백도·기존가맹포화도)",
    depth: "수집 → haversine 반경 500m 계산 → 2단계 스코어 입력",
    caution:
      "후보마다 반경 조회를 반복하지 않고 지역 단위로 받아 로컬에서 거리 계산한다 — 호출 수를 줄이고 재현성을 지키기 위함이다.",
  },
  {
    no: 5,
    title: "국세청 사업자현황 (CSV 2종)",
    agency: "국세청 · 공공데이터포털",
    kind: "파일데이터 (CSV)",
    scale: "존속연수별 30,138행 + 100대 생활업종 24,434행 · UTF-8 BOM",
    fields: "업태별 / 시도 / 시군구 / 존속연수별(배타적 9구간) / (전체)당월",
    pipeline: "p7_risk.py → risk_signal.json (운영 2년 미만 사업자 비중)",
    screens: "전체 지역 현황 · 배경·주의 정보(접힘)",
    depth: "집계 → 배경 지표 (스코어에 넣지 않음)",
    caution:
      "헤더 문자열이 오염돼(괄호 미닫힘) 위치 기반 인덱스로 매핑한다. 4개 시군 편차가 0.5%p 수준이라 지역 비교·순위 근거로 쓰지 않으며, 처방 대상은 언제나 하이원포인트 가맹점 확충이다.",
  },
  {
    no: 6,
    title: "기상청 초단기실황",
    agency: "기상청 · 공공데이터포털",
    kind: "오픈 API",
    endpoint: "기상청_단기예보 조회서비스 · getUltraSrtNcst",
    scale: "실시간 1건 (파이프라인 산출물 아님 — 프론트 서버가 요청 시 호출)",
    fields: "현재 기온 · 강수 형태",
    pipeline: "산출물 없음 — 프론트 서버가 직접 호출",
    screens: "방문객 위젯 · 오늘의 추천",
    depth: "실시간 조회 → 문구 보조",
    caution:
      "받지 못해도 화면은 그대로 뜬다 — 추천 업종은 요일 실측 패턴으로만 정하고, 날씨는 곁들이는 문구일 뿐이라 실패 시 각주에서도 기상청을 뺀다.",
  },
];

export function DatasetCatalog() {
  return (
    <div className="flex flex-col gap-4">
      {DATASETS.map((ds) => (
        <article key={ds.no} className="u-panel px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-admin-primary-soft text-[13px] font-bold text-admin-primary">
              {ds.no}
            </span>
            <div className="min-w-0 flex-1 basis-64">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="u-h3">{ds.title}</h3>
                <span className="rounded-full bg-admin-surface-sunken px-2 py-0.5 text-[11px] font-semibold text-admin-text-muted">
                  {ds.kind}
                </span>
              </div>
              <p className="u-note mt-1">{ds.agency}</p>
            </div>
            {ds.href ? (
              <a
                href={ds.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-admin-primary underline-offset-4 hover:underline"
              >
                원본 페이지
                <Icon name="arrowUpRight" size={13} strokeWidth={2} />
              </a>
            ) : null}
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="원본 규모" value={ds.scale} />
            <Row label="실제 사용 필드" value={ds.fields} mono />
            <Row label="처리 · 산출물" value={ds.pipeline} mono />
            <Row label="사용 화면" value={ds.screens} />
            <Row label="활용 단계" value={ds.depth} />
            {ds.endpoint ? <Row label="엔드포인트" value={ds.endpoint} mono /> : null}
          </dl>

          {ds.caution ? (
            <p className="u-note mt-3 flex items-start gap-1.5 border-t border-admin-border pt-2.5">
              <Icon name="info" size={13} className="mt-0.5 shrink-0" />
              <span>{ds.caution}</span>
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-admin-text-muted">
        {label}
      </dt>
      <dd
        className={`mt-0.5 break-keep text-[13px] leading-[1.6] text-admin-text ${
          mono ? "break-all font-mono text-[12px]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
