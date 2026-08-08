import type { Region } from "@/types";

/**
 * 기상청 초단기실황(관측) — 방문객 위젯 "오늘의 추천"의 상황 문구 전용.
 *
 * ⚠ 서버 전용이다. `DATA_GO_KR_API_KEY`는 `NEXT_PUBLIC_` 접두사가 없어 브라우저 번들에
 *   인라인되지 않는다. `"use client"` 컴포넌트에서 import 하면 키가 undefined가 되고
 *   이 모듈이 클라이언트 번들로 끌려간다 — 서버 컴포넌트에서만 호출한다 (lib/api.ts 머리말과 같은 이유).
 *
 * 계약 (2026-08-08 실호출로 확인):
 *   GET https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst
 *   serviceKey / pageNo=1 / numOfRows=10 / dataType=JSON / base_date=YYYYMMDD /
 *   base_time=HH00 / nx / ny
 *   → response.body.items.item[] = {category, obsrValue} **8종**
 *     T1H 기온(°C) · RN1 1시간 강수(mm) · REH 습도(%) · PTY 강수형태 · UUU/VVV/VEC/WSD 바람
 *   → 자료가 아직 없는 시각이면 HTTP 200 + resultCode "03"(NO_DATA)이고 **body.items 자체가 없다**
 *   → 미등록·오류 키는 HTTP 403
 *
 * 정직성(심사 방어): 초단기실황에는 **하늘상태(SKY)가 없다** — "맑음"이라고 쓰면 데이터에 없는
 * 사실을 만드는 것이다. 강수 여부는 PTY로만 말하고, 비가 안 오면 기온만 쓴다.
 */

const ENDPOINT = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const TIMEOUT_MS = 2500; // 심사장 네트워크가 느려도 페이지 렌더를 붙잡지 않는다
const CACHE_SECONDS = 600;

/** 지역별 격자 — 각 지역 가맹점 실좌표 중심으로 계산해 실호출로 검증한 값 (2026-08-08). */
const WEATHER_SPOT: Record<Region, { nx: number; ny: number; label: string }> = {
  고한읍: { nx: 92, ny: 120, label: "고한" },
  사북읍: { nx: 92, ny: 120, label: "사북" }, // 고한과 같은 격자다 (5km 격자, 라벨만 다르다)
  정선군: { nx: 90, ny: 122, label: "정선" },
  태백시: { nx: 95, ny: 119, label: "태백" },
  영월군: { nx: 86, ny: 119, label: "영월" },
  삼척시: { nx: 96, ny: 120, label: "삼척 도계" }, // 삼척시 = 도계읍 한정 (05 §1)
};

/** 지역 미선택(전체)일 때 — 추천 정렬 기준과 같은 지점인 거점 격자를 쓴다 */
const DEFAULT_SPOT = { nx: 92, ny: 120, label: "하이원리조트 인근" };

/** PTY 코드 → 화면 문구. 0(없음)은 문구를 만들지 않는다 — "맑음"이라 단정할 근거가 없다 */
const PRECIPITATION: Record<number, string> = {
  1: "비",
  2: "비/눈",
  3: "눈",
  5: "빗방울",
  6: "빗방울·눈날림",
  7: "눈날림",
};

export interface Nowcast {
  /** 화면에 적을 지점 라벨 ("사북" / "하이원리조트 인근") */
  spotLabel: string;
  /** 기온(°C) T1H — 이 값이 없으면 Nowcast를 만들지 않는다 */
  tempC: number;
  /** 1시간 강수량(mm) RN1. 0이면 표기하지 않는다 */
  rainMm: number | null;
  humidityPct: number | null;
  /** 강수형태 코드 PTY (0=없음) */
  ptyCode: number | null;
  /** PTY 화면 문구. 0·미상이면 null */
  precipitationLabel: string | null;
  /** 관측 기준 시각 라벨 "18시" — 화면에 그대로 적어 신선도를 과장하지 않는다 */
  observedLabel: string;
}

interface Slot {
  baseDate: string;
  baseTime: string;
  hourLabel: string;
}

interface KmaItem {
  category: string;
  obsrValue: string;
}

interface KmaResponse {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: { items?: { item?: KmaItem[] } };
  };
}

/**
 * 조회할 base_date/base_time 후보 2개. 초단기실황은 **매시 정시 자료가 40분경 생성**되므로
 * `현재-45분`의 정시를 1순위로, 그 1시간 전을 2순위로 둔다(생성 지연 대비 — 2순위는 항상 있다).
 * KST 기준이다 — Docker·Vercel 서버는 UTC라 로컬 시각을 그대로 쓰면 9시간 어긋난다.
 * (+9h 이동한 시각의 UTC 필드가 곧 KST다 — lib/dataFreshness.ts와 같은 관용구)
 *
 * 실측(2026-08-08): 18:39 KST에 base_time=1800/1700/1600이 모두 NORMAL_SERVICE("00")였고,
 * 자료가 없는 시각은 HTTP 200 + resultCode "03"(NO_DATA)에 body.items가 아예 없었다.
 * 자정 직후에는 -45분 이동으로 날짜가 전날로 넘어가야 하는데, 아래처럼 이동한 시각에서
 * 연·월·일을 다시 읽으면 롤백이 저절로 된다.
 */
function baseSlots(now: Date): Slot[] {
  const shifted = new Date(now.getTime() + 9 * 3_600_000 - 45 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return [0, 1].map((back) => {
    const t = new Date(shifted.getTime() - back * 3_600_000);
    return {
      baseDate: `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`,
      baseTime: `${pad(t.getUTCHours())}00`,
      hourLabel: `${t.getUTCHours()}시`,
    };
  });
}

async function requestItems(
  key: string,
  spot: { nx: number; ny: number },
  slot: Slot,
  signal: AbortSignal,
): Promise<KmaItem[] | null> {
  // serviceKey는 반드시 URLSearchParams로 인코딩한다 — Decoding 키에 +·/·= 가 섞이면
  // 문자열 연결로는 403이 난다 (파이프라인 p2~p4와 같은 이유)
  const qs = new URLSearchParams({
    serviceKey: key,
    pageNo: "1",
    numOfRows: "10",
    dataType: "JSON",
    base_date: slot.baseDate,
    base_time: slot.baseTime,
    nx: String(spot.nx),
    ny: String(spot.ny),
  });
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, {
      // 10분 캐시 — `/widget?live=1`이 4초마다 서버 렌더를 돌린다(WidgetLiveRefresh).
      // 캐시가 없으면 데모 한 시간에 900회를 호출해 일일 트래픽을 태운다.
      // 라우트가 force-dynamic이어도 **명시한 revalidate는 살아 있다** —
      // next/dist/server/lib/patch-fetch.js의 noFetchConfigAndForceDynamic 조건이
      // `!currentFetchRevalidate`를 함께 보기 때문이다 (16.3.0에서 확인).
      next: { revalidate: CACHE_SECONDS },
      signal,   // 슬롯 전체가 공유하는 마감 — 호출부에서 한 번만 만든다
    });
    if (!res.ok) return null; // 403(미등록 키)·5xx
    const body = (await res.json()) as KmaResponse;
    if (body?.response?.header?.resultCode !== "00") return null; // "03" NO_DATA 등
    const item = body.response.body?.items?.item; // NO_DATA면 body 자체가 없다
    return Array.isArray(item) ? item : null;
  } catch {
    return null; // 타임아웃·네트워크·JSON이 아닌 본문(포털이 XML 오류를 내려주는 경우)
  }
}

/** 기상청 결측 표기(-99·-999)를 그대로 쓰면 화면에 "-99°C"가 나간다 */
function readValue(items: KmaItem[], category: string): number | null {
  const raw = items.find((i) => i.category === category)?.obsrValue;
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(n) && n > -90 ? n : null;
}

function toNowcast(items: KmaItem[], spotLabel: string, slot: Slot): Nowcast | null {
  const tempC = readValue(items, "T1H");
  if (tempC === null) return null; // 기온이 없으면 날씨 줄 자체를 만들지 않는다
  const rainMm = readValue(items, "RN1");
  const ptyCode = readValue(items, "PTY");
  return {
    spotLabel,
    tempC,
    // 0mm를 "0mm"라고 적으면 비가 오다 그친 것처럼 읽힌다 — 값이 있을 때만 표기한다
    rainMm: rainMm && rainMm > 0 ? rainMm : null,
    humidityPct: readValue(items, "REH"),
    ptyCode,
    precipitationLabel: ptyCode === null ? null : (PRECIPITATION[ptyCode] ?? null),
    observedLabel: slot.hourLabel,
  };
}

/**
 * 프로세스 내 메모 — Next Data Cache가 동작하지 않는 실행 모드에서도 호출량을 묶는다.
 * `?live=1` 데모를 몇 시간 켜 두면 일일 트래픽 한도를 태울 수 있어 이중으로 막는다.
 * 인스턴스마다 따로 사는 값이라 정확한 공유 캐시일 필요는 없다.
 *
 * **실패(null)도 담는다** — Next Data Cache는 200 응답만 저장하므로 403(미등록 키)도, 타임아웃도
 * 캐시 대상이 아니다. 실패를 안 담으면 기상청이 조용히 드롭되는 망에서 렌더마다 타임아웃 예산을
 * 처음부터 다시 지불하고, `/widget`은 force-dynamic이라 그 시간이 그대로 TTFB에 얹힌다.
 * 다만 실패 TTL은 성공보다 훨씬 짧게 둔다 — 일시 장애가 10분간 날씨 줄을 지우면 안 된다.
 *
 * 키는 격자(`nx,ny`)다 — 고한읍·사북읍·지역 미선택이 같은 격자(92,120)를 공유하므로 한 번만 부른다.
 * 대신 `spotLabel`은 격자가 아니라 **선택 지역**에서 오므로 캐시 적중 시 라벨만 갈아 끼운다
 * (안 그러면 사북읍 화면에 "지금 고한 …"이 뜬다).
 */
const memo = new Map<string, { at: number; value: Nowcast | null }>();
const FAILURE_CACHE_SECONDS = 60;

/** 실패는 전부 null이다 — 이 함수는 던지지 않는다 (호출부의 Promise.all을 깨지 않기 위함) */
export async function fetchNowcast(region?: Region): Promise<Nowcast | null> {
  const key = process.env.DATA_GO_KR_API_KEY?.trim();
  if (!key) return null; // 키 미설정 — 조용히 날씨 줄만 뺀다 (로그도 남기지 않는다)
  const spot = (region && WEATHER_SPOT[region]) ?? DEFAULT_SPOT;
  const memoKey = `${spot.nx},${spot.ny}`;
  const hit = memo.get(memoKey);
  if (hit) {
    const ttl = (hit.value ? CACHE_SECONDS : FAILURE_CACHE_SECONDS) * 1000;
    if (Date.now() - hit.at < ttl) {
      return hit.value && { ...hit.value, spotLabel: spot.label };
    }
  }
  // 슬롯마다 타임아웃을 새로 만들면 최악 대기가 슬롯 수만큼 곱해진다(2.5초 × 2 = 5초).
  // 하나를 공유해 함수 전체의 상한을 TIMEOUT_MS로 묶는다.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  for (const slot of baseSlots(new Date())) {
    const items = await requestItems(key, spot, slot, deadline);
    const nowcast = items && toNowcast(items, spot.label, slot);
    if (nowcast) {
      memo.set(memoKey, { at: Date.now(), value: nowcast });
      return nowcast;
    }
  }
  memo.set(memoKey, { at: Date.now(), value: null });
  return null;
}
