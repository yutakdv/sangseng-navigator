# 08. 프론트엔드 태스크 (FE 팀원 · Phase 1부터 병렬 진행)

> 원칙: **BE를 기다리지 않는다.** `src/mocks/`를 채우고 화면부터 완성 →
> `NEXT_PUBLIC_API_BASE` 설정 한 줄로 실 API 전환.
> ⚠ **mock 값은 05 예시를 베끼지 말고 `./scripts/sync-mocks.sh`로 만든다** — 05의 예시 JSON은
> 스키마 설명용이라 지역·업종·수치가 실산출(영월군 서사)과 다르다. 베끼면 mock과 실서버가
> 서로 다른 이야기를 하게 된다. 05 예시는 **필드 형태를 볼 때만** 참조한다.
> **생성한 뒤 커밋한다(FE가 커밋)** — `src/mocks/`는 정적 import 대상이라 레포에 없으면 Vercel
> 빌드가 실패하고, `NEXT_PUBLIC_API_BASE` 미설정 시 mock 모드 폴백(12 문서 §5)도 성립하지 않는다.
> 데이터가 갱신되면 스크립트를 다시 실행해 커밋한다.
> 서비스 정체성은 "시각화"가 아니라 "의사결정 지원" — 첫 화면은 차트가 아니라 **Action Card 허브**다.
>
> **디자인 기준: `13-design-guide.md` 필독.** 시안 미확정 상태의 기준은 목업(레포 루트
> `image-1.png`/`image-2.png`)이며, 13 문서 §2의 교정표(지니계수 라벨 금지, 사용액→건수 등)를
> 반드시 따른다. 컬러 토큰·차트 팔레트·사이드바↔라우트 매핑·반응형 최소선도 13 문서가 정본.

## Task F1: 스캐폴딩 + 데이터 접근 계층

- [ ] `npx create-next-app@latest frontend` (App Router, TS, Tailwind, src 디렉토리)
- [ ] 배포는 **Vercel 네이티브**이므로 정적 export 설정 불필요 — 동적 라우트 `/cards/[id]` 그대로 사용
- [ ] 설치: `recharts`, `maplibre-gl` (지도는 `"use client"` 컴포넌트 + `next/dynamic`(ssr:false)로 로드,
      `maplibre-gl/dist/maplibre-gl.css` import 필수 — Leaflet은 사용하지 않는다, 사유는 02 문서 "지도 결정")
- [ ] 지도 스택은 화면마다 다르다 (02 문서 "지도 결정"):
      **카드 상세 `/cards/[id]`의 500m 반경 지도 = MapLibre + OpenFreeMap**(데모 필수, 키 불필요),
      **허브 히어로의 지역 진단 = `RegionTileMap` 지역 배치 개념도**(외부 SDK·키 없이 진단 서사만 표시),
      실제 위치 탐색이 필요한 카드 상세는 MapLibre를 사용한다.
- [ ] 데이터 접근 계층:

```ts
// src/lib/api.ts — 모든 화면은 이 파일만 통해 데이터를 얻는다
const BASE = process.env.NEXT_PUBLIC_API_BASE;

async function get<T>(path: string, mock: T): Promise<T> {
  if (!BASE) return mock;                       // mock 모드
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function post<T>(path: string, body: unknown, mock: T): Promise<T> {
  if (!BASE) return mock;                       // mock 모드: 호출부가 로컬 상태를 직접 갱신
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

import dashboardMock from "@/mocks/dashboard.json";
import cardsMock from "@/mocks/cards.json";
// ...
export const api = {
  dashboard: () => get("/api/dashboard", dashboardMock),
  cards: (q = "") => get(`/api/cards${q}`, cardsMock),
  // POST 계열은 mock 모드에서 로컬 상태만 변경 (낙관적 업데이트)
  decide: (id: string, decision: string) => post(`/api/cards/${id}/decision`, { decision }),
  // ...
};
```

- [ ] `src/mocks/` 채우기 — **정적 데이터는 레포 루트에서 `./scripts/sync-mocks.sh` 실행**
      (dashboard·candidates·eup_scores·merchants·usage_monthly·risk_signal·sensitivity가 실산출 값으로 생성된다).
      DynamoDB에서 오는 `cards`와 파생값 `kpi`·`widget`·`simulate` mock만 05 예시 **구조**를 보고 직접 만든다
      (`cards.json`은 데모 초기 상태 3장 = `backend/seed_demo.py`의 카드와 같은 서사로 맞출 것)
- [ ] **mock 상태 저장소** `src/mocks/store.ts`: mock 모드에서 POST(승인·상태 변경·카드 생성)가
      페이지를 오가도 유지되도록 카드 목록을 모듈 스코프 인메모리 배열로 관리
      (`cards.json`을 초기값으로 로드, `decide()`/`setProgress()`가 이 배열을 변경).
      KPI mock도 이 배열에서 파생 계산 — **mock 모드에서도 "승인→트래킹→위젯 반영" 데모 루프가 돌아가게** 하는 장치
- [ ] 차트·지도 컴포넌트는 전부 `"use client"` (Recharts·MapLibre 모두 브라우저 전용 —
      App Router 서버 컴포넌트에서 직접 import 금지)
- [ ] **검증:** `npm run dev` → mock으로 첫 페이지 렌더 + 승인 후 다른 페이지에서 상태 유지,
      `npm run build` 성공(빌드 오류 없음)

## Task F2: 공통 컴포넌트

- [ ] `Badge` — `근사 지표`(전환율 옆 상시), `가정 기반 전망`(시뮬레이션 출력 옆 상시), `신규`
- [ ] `KpiCard` — 라벨·값·부가설명. `StatusChip` — pending/approved/rejected/held + progress 4단계
- [ ] `CardItem` — 허브 목록용: 제목, 정량 순위→AI 조정 순위(`Score 2위 → AI 제안 1위` 강조 표기),
      신뢰도, 승인/반려/보류 버튼
- [ ] 레이아웃: 상단 고정 헤더에 **"이번 분기 지역 전환율 X% [근사 지표]"** 헤드라인 (전 화면 공통)
- [ ] 푸터에 데이터 출처 고정 표기: "데이터: 공공데이터포털(강원랜드·소상공인시장진흥공단)·국세청 |
      지도: © OpenStreetMap contributors, OpenFreeMap" (공공데이터 출처 표기 + OSM attribution 의무)
- [ ] **검증:** Storybook 없이 `/`에서 컴포넌트 조합 렌더 확인. Gini/HHI 문자열이 코드 UI 텍스트에 없는지 grep

## Task F3: ① Action Card 허브 (`/` 첫 화면) — 최우선

- [ ] 상단 헤드라인(전환율) + 승인 대기 카드 목록 (`type` 탭: 확충/인센티브)
- [ ] 카드마다: 정책목표·대상(읍×업종)·Score 순위→AI 조정·후보비교 요약·신뢰도·승인/반려/보류 버튼
- [ ] 승인 시 즉시 상태 반영(낙관적 업데이트) + 상세로 이동 링크
- [ ] "이번 분기 카드 생성" 버튼 → `POST /api/cards/generate` (mock 모드: 목업 카드 push)
- [ ] **409 응답 처리** — 전 후보가 추진중/완료면 BE가 `409 {"detail": "제안할 수 있는 신규 후보가
      없습니다 …"}`를 낸다 (05 §8). 현재 `lib/api.ts`의 `post()`는 모든 비2xx를 같은 Error로 뭉뚱그리므로,
      409만 구분해 **"이번 분기에 새로 제안할 후보가 없습니다"** 안내로 표시한다(에러 토스트 금지).
      심사위원이 카드를 모두 승인·완료시키면 실제로 도달하는 상태다
- [ ] **검증:** 데모 시나리오 첫 30초(허브→카드 확인→승인)가 마우스 3~4클릭 안에 끝남,
      후보를 전부 완료시킨 뒤 생성 버튼을 눌러도 에러 화면이 아니라 안내가 뜬다

## Task F4: ② 카드 상세 (`/cards/[id]` 동적 라우트 — 03 문서 구조와 동일)

- [ ] AI 조정 근거 전문: 후보비교 / 근거 리스트 / 리스크 / 원 Score 순위 표(항상 병기)
- [ ] 지도(`MapView` 컴포넌트, MapLibre GL): 가맹점 핀(merchants) + 후보 마커(candidates, 강조색)
      + 500m 반경 원 + 거점(강원랜드 카지노) 마커 — 라벨은 `ANCHOR.name` 그대로 쓴다
      ("정문"은 근거 없는 좌표라 폐기됨, 06 공통 상수)
- [ ] 후보 상세에 `road_distance_km`·`road_minutes` 병기 — "직선 X km / 도로 Y km·Z분"으로
      **두 값을 함께** 적고, "거점에서 가장 가깝다"는 단정은 쓰지 않는다.
      값이 `null`이면 도로 항목만 `—` 처리. 이 값으로 후보를 재정렬하지 않는다 (05 §1)

```tsx
// src/components/MapView.tsx — "use client", next/dynamic(ssr:false)으로 로드
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// 스타일: 키·도메인 등록 불필요 (OpenFreeMap). attribution(OSM) 기본 표시 유지
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// 마커: new maplibregl.Marker({ color }).setLngLat([lng, lat]).addTo(map)
// 500m 반경: 중심점 기준 64각형 GeoJSON polygon 생성 → map.addSource + fill 레이어(opacity 0.15)
function circlePolygon(lng: number, lat: number, radiusM = 500, points = 64) {
  const coords = Array.from({ length: points + 1 }, (_, i) => {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(angle)) / 111320;
    const dLng = (radiusM * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lng + dLng, lat + dLat];
  });
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [coords] } } as const;
}
```

- [ ] 1단계 근거: 읍 랭킹 바 차트 (eup_ranking)
- [ ] "이 후보가 가맹 전환하면?" 버튼 → `POST /simulate` → delta·narrative 표시 + `가정 기반 전망` 배지
      (가맹점은 사업자가 신청하고 강원랜드가 심사하는 구조라 "확보" 표현을 쓰지 않는다 — 05 §2)
- [ ] **검증:** 지도 핀·반경이 사북/고한 일대에 정상 표시, 시뮬레이션 응답 렌더.
      **Safari(맥·아이폰)에서 지도 렌더 확인 — 문제 시 02 문서 폴백(거리 표+정적 캡처)으로 즉시 전환**

## Task F5: ③ 집중도 대시보드 (`/dashboard`)

- [ ] KPI 카드 행: 집중도(등급 병기)·지역 전환율(근사 지표 배지)·증가율·채택률·실행 전환율·평균 승인 소요·지역 균형지수 (`/api/kpi` + `/api/dashboard` 병합)
- [ ] 월별 집중도 라인차트, 지역 비중(히트맵은 컷 후보 — 우선 가로 막대), **"리조트 체류 규모(굵은 막대) vs 지역 전환 건수(가는 막대)"** 비교 차트 (문제 스케일 각인용)
- [ ] **요인 카드** (13 §2-15가 확정한 산출 가능 지표만): 업종공백도 `gap`·동선근접도 `proximity`·
      포화도 `saturation`은 `/api/candidates`에서, 운영 2년 미만 사업자 비중 `under2y_ratio`는
      **`/api/risk-signal`**에서 받는다. `lib/api.ts`에 접근자 한 줄을 더해야 실 API 모드가 동작한다
      (mock은 `src/mocks/risk_signal.json`이 이미 있고 BE 응답과 같은 배열이다):

```ts
import riskSignalMock from "@/mocks/risk_signal.json";
// ...
riskSignal: (): Promise<RiskSignal[]> => get("/api/risk-signal", () => riskSignalMock as RiskSignal[]),
```

- [ ] `under2y_ratio` 표시는 **중립 표기 고정** — '위험' 라벨·경고색·지역 순위 정렬 금지
      (4개 시군 편차 0.5%p라 비교 근거가 못 된다 — 05 §1·§6, 13 §7)
- [ ] **검증:** mock→실 데이터 전환 시 축·단위 깨지지 않음 (음수/0 데이터 방어),
      요인 카드가 두 모드에서 같은 값을 낸다

## Task F6: ④ 인센티브 정책 카드 (`/incentive`)

- [ ] 페이백률 3/5/7% 시나리오 비교 표: 예상 전환율 개선폭·재원 부담 + `가정 기반 전망` 문구 고정
- [ ] "적립→외부사용→페이백→재사용" 순환 다이어그램 (정적 SVG로 충분)
- [ ] 승인/반려/보류 버튼 (EXPANSION 카드와 동일 플로우 재사용). 단 **승인 시 페이백률 선택 필수** —
      시나리오 표에서 라디오로 3/5/7% 중 하나를 고르고 `decision` body에 `selected_rate`로 전달
      (05 문서 §2 — 미선택 시 승인 버튼 비활성). "AI는 비교 제시, 확정은 담당자 선택" 서사의 화면 증거
- [ ] **검증:** 승인 → 트래킹 화면에 나타나고, 완료 처리 시 위젯에 페이백 배지 등장

## Task F7: ⑤ 방문객 위젯 (`/widget`, 모바일 뷰)

- [ ] 관심 지역(6개)·업종 선택 → 추천 카드 3개 (로그인 없음)
- [ ] `신규` 배지(완료 카드 가맹점 우선 노출) + LLM 문구 + 페이백 배지("지금 여기서 쓰면 X% 페이백")
- [ ] 추천 0건일 때 빈 상태 UI: "해당 조건의 가맹점이 아직 없어요 — 다른 지역·업종을 선택해 보세요"
      (05 문서 §8 — BE는 빈 배열 200 반환)
- [ ] 모바일 프레임 컨테이너(폭 390px 중앙 배치)로 "방문객 화면" 임을 시각적으로 구분
- [ ] **검증:** 카드 완료 전/후 추천 목록 차이가 눈에 보임 (데모 마지막 동선)

## Task F8: ⑥ 실행 상태 트래킹 (`/tracking`)

- [ ] 승인된 카드 목록 + 4단계 상태(검토중/추진중/보류/완료) 변경 UI (드롭다운 or 칸반 열)
- [ ] 상태 변경 → `POST /progress` → KPI 실행 전환율 갱신 확인
- [ ] **검증:** 완료로 변경 → 위젯 새로고침 시 `이번 분기 확충 업종` 배지 등장 (전체 루프 완주)

## Task F9: 실 API 전환 + 마감 (Phase 5)

- [ ] `frontend/.env.local`에 `NEXT_PUBLIC_API_BASE` 설정 → 전 화면 실 API로 동작 확인
- [ ] 로딩/에러 상태 최소 처리 (스피너/스켈레톤 + "데이터를 불러오지 못했습니다" + 재시도) —
      **Lambda 콜드스타트 1~3초를 심사위원이 "고장"으로 오인하지 않게 하는 장치** (12 문서 §5)
- [ ] 발표 화면 폴리시: 1920×1080 빔프로젝터 기준 폰트·대비 확인, 데모 순서대로 네비게이션 동선 최적화
- [ ] 탭·공유 메타: 루트 `layout.tsx` metadata에 title "상생 나침반"·description(12 문서 §3 한 줄
      소개 재사용)·OG 이미지(대표 스크린샷 재사용) + favicon 교체 — 무인 심사에서 기본
      "Create Next App" 타이틀·파비콘 노출 방지
- [ ] **모바일 최소선 확인 (제출 요건):** 390px 뷰포트에서 전 화면 가로 스크롤 없이 열람·조작
      가능 (13 문서 §8) — 심사 체크리스트 "휴대폰에서도 배포 URL이 열리는지"에 직결
- [ ] **검증:** PR 생성 → Vercel Preview URL에서 배포와 동일 조건 스모크 (Safari 포함),
      main 머지 → Production 반영 확인 + 휴대폰 실기기에서 배포 URL 1회 완주
