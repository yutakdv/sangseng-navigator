# frontend — 상생 나침반

Next.js 16(App Router · TypeScript · React 18 · Tailwind 3). 배포는 **Vercel 네이티브**(정적 export 아님).

> Next 16에서 `params`·`searchParams`는 **Promise**다 — `await` 없이 접근하면 런타임 에러가 난다.
> `next lint`는 없어졌고 ESLint 9 flat config(`eslint.config.mjs`) + `eslint .`를 쓴다.

이 디렉토리는 **밑작업(스캐폴딩 + 데이터 계층 + 대시보드·방문객 위젯)** 까지 만들어 둔 상태다.
나머지 화면은 `docs/plan/08-frontend-tasks.md`의 태스크대로 FE 담당이 채운다.

| 태스크 | 화면 | 라우트 | 상태 |
|---|---|---|---|
| F1 | 스캐폴딩 · `lib/api.ts` · mock 저장소 | — | ✅ |
| F2 | 공통 컴포넌트(배지·KPI·상태칩·레이아웃·차트) | — | ✅ |
| F3 | Action Card 허브 | `/` | ⬜ 목록만 (승인 버튼·히어로·카드 생성 미구현) |
| F4 | 카드 상세 + 지도 + 시뮬레이션 | `/cards/[id]` | ⬜ 자리표시자 |
| F5 | 집중도 대시보드 | `/dashboard` | ✅ |
| F6 | 인센티브 정책 카드 | `/incentive` | ⬜ 자리표시자 |
| F7 | 방문객 위젯 | `/widget` | ✅ |
| F8 | 실행 상태 트래킹 | `/tracking` | ⬜ 자리표시자 |

## 실행

### Docker (권장 — 레포 루트에서)

```bash
docker compose up -d               # FE(3100) + BE(8000) + DynamoDB(8001) + 데모 카드 시드
docker compose logs -f frontend

FRONTEND_PORT=3200 docker compose up -d    # 3100번을 다른 용도로 써야 할 때
FRONTEND_API_BASE= docker compose up -d frontend   # FE만 mock 모드로 (BE 불필요)
```

`frontend/`를 바인드 마운트하므로 소스를 고치면 그대로 반영된다(HMR).
`package.json`을 고쳤을 때만 `docker compose build frontend`로 이미지를 다시 만든다.

### 로컬 Node

```bash
npm install
npm run dev        # http://localhost:3100
npm run build      # 빌드 검증 (Vercel과 같은 조건)
npm run lint       # eslint . (ESLint 9 flat config)
npm run check:banned   # 금칙어 검사 (13 §9)
```

## mock 모드 ↔ 실 API 전환

`NEXT_PUBLIC_API_BASE`가 **비어 있으면 mock 모드**다 — `src/mocks/`의 JSON과 `src/mocks/store.ts`가
응답을 대신하므로 BE 없이 전 화면이 뜬다. 값을 채우면 코드 수정 없이 실 API로 붙는다.

Docker에서는 **실 API 연동이 기본값**(`http://backend:8000`)이다. mock 모드로 보려면 비운다.

```bash
# 로컬 Node (컨테이너 밖)
echo 'NEXT_PUBLIC_API_BASE=http://localhost:8000' > .env.local && npm run dev

# Docker — mock 모드로 되돌리기
FRONTEND_API_BASE= docker compose up -d --force-recreate frontend
```

**주소가 두 가지인 이유**: 페이지가 서버 컴포넌트라 `fetch`가 브라우저가 아니라 **Next 서버에서**
일어난다. 컨테이너 안에서 도는 Next에게 `localhost:8000`은 자기 자신이라 `ECONNREFUSED`가 난다 —
컴포즈 네트워크 이름 `http://backend:8000`을 써야 한다. 배포(Vercel + API Gateway)에서는 공개
URL 하나라 이 구분이 사라진다.

데모 카드 3장은 compose의 `seed` 서비스가 매 기동마다 넣어 준다(DynamoDB Local이 `-inMemory`라
컨테이너가 재시작되면 테이블째 사라지기 때문). 수동으로 다시 넣으려면:

```bash
DYNAMO_ENDPOINT=http://localhost:8001 python backend/seed_demo.py --reset
```

## 구조

```
src/
├── app/                 # 라우트 (App Router)
│   ├── page.tsx                 ① Action Card 허브 (F3 — 목록만)
│   ├── cards/[id]/page.tsx      ② 카드 상세 (F4 — 자리표시자)
│   ├── dashboard/page.tsx       ③ 집중도 대시보드 (F5 ✅)
│   ├── incentive/page.tsx       ④ 인센티브 (F6 — 자리표시자)
│   ├── widget/page.tsx          ⑤ 방문객 위젯 (F7 ✅)
│   └── tracking/page.tsx        ⑥ 실행 상태 트래킹 (F8 — 자리표시자)
├── components/          # Badge·KpiCard·StatusChip·AdminShell·SideNav·Section·CategoryIcon
│   └── charts/          # LineTrend·BarRank·CategoryDonut·ScaleCompare ("use client")
├── lib/
│   ├── api.ts           # 단일 데이터 접근 계층 (mock ↔ 실 API)
│   ├── constants.ts     # 6지역·6업종 고정 순서, 차트 팔레트, 고지 문구
│   └── format.ts        # 숫자·퍼센트·증감 포맷 (null이면 "—")
├── mocks/               # 데이터 mock (아래 참조)
└── types/index.ts       # 05 계약 타입
```

### 서버 컴포넌트 기준으로 짰다

페이지는 전부 서버 컴포넌트이고, 브라우저 전용인 차트(`components/charts/*`)와 사이드바만
`"use client"`다. 덕분에 `merchants.json`(330KB)을 포함한 mock 전체가
**브라우저 번들에 실리지 않는다**.

> ⚠ 페이지를 `"use client"`로 바꾸고 `lib/api.ts`를 import 하면 mock JSON 전체가 클라이언트 번들로
> 딸려 온다. 클라이언트 인터랙션이 필요하면 **서버에서 데이터를 받아 props로 내려** 주는 편이 낫다.
> 위젯의 지역·업종 선택을 쿼리스트링(`/widget?region=영월군&category=카페`)으로 처리한 이유도 이것이다.

## mock 데이터

| 파일 | 출처 | 갱신 방법 |
|---|---|---|
| `dashboard.json` `candidates.json` `eup_scores.json` `merchants.json` `usage_monthly.json` `risk_signal.json` `sensitivity.json` | 파이프라인 실산출 | 레포 루트에서 `./scripts/sync-mocks.sh` |
| `cards.json` | 손으로 작성 — `backend/seed_demo.py`의 데모 3장과 같은 서사 | seed_demo가 바뀌면 함께 고친다 |
| `simulate.json` | 손으로 작성 — 영월군×음식점 실제 재계산 값(43→42, 0.0~0.1%p) | 파이프라인 재산출 시 대조 |

- **05 문서의 예시 JSON을 베껴 쓰지 않는다.** 예시는 스키마 설명용이라 지역·업종·수치가
  실산출(영월군 서사)과 다르다. 값의 원천은 `sync-mocks.sh` 하나다.
- `src/mocks/`는 정적 import 대상이라 **레포에 커밋한다** — 없으면 Vercel 빌드가 실패하고
  mock 모드 폴백도 성립하지 않는다.

### `mocks/store.ts` — mock 모드의 상태

카드 목록을 모듈 스코프 인메모리 배열로 들고, KPI(`deriveKpi`)와 위젯 추천(`deriveWidget`)을
이 배열에서 파생 계산한다. 백엔드 `routes/kpi.py`·`routes/widget.py`와 같은 규칙이라
**mock 모드에서도 "승인 → 트래킹 → 위젯 반영" 데모 루프가 그대로 돈다.**

배열은 Next 서버 프로세스 메모리에 있으므로 서버를 재시작하면 `cards.json` 초기 상태로 돌아간다.

## 지켜야 하는 표시 규칙 (심사 대응)

전부 `docs/plan/13-design-guide.md` §9 · 루트 `CLAUDE.md`의 절대 규칙이다. 컴포넌트를 쓰면 자동으로 지켜진다.

- **집중도 산식 용어를 UI에 노출하지 않는다.** 외부 표시는 "지역 소비 집중도"/"업종별 소비 분산도".
  `npm run check:banned`가 회귀를 막는다 (주석·import는 제외하고 검사).
- **`근사 지표` 배지** — "지역 전환율"이 보이는 모든 위치에 `<ProxyBadge note={conversion.proxy_note} />`.
  `proxy_note`는 요약·의역 없이 그대로 노출한다. 분모 라벨은 "입장객 수"가 아니라 **"입장 연인원(교대 합산)"**.
- **`가정 기반 전망`** — 시뮬레이션·예상 효과·페이백 시나리오 블록마다 `<AssumptionBadge />` + `<AssumptionNote />`.
- **정량 순위 병기** — AI가 순위를 조정해도 `Score N위 → AI 제안 M위` 형식으로 원 순위를 함께 노출.
- **후보 거리** — "직선 X km / 도로 Y km·Z분"을 함께 적고 "가장 가깝다"는 단정을 쓰지 않는다.
  `road_*`가 `null`이면 도로 항목만 `—`. 이 값으로 후보를 재정렬하지 않는다.
- **위젯 추천 순서** — BE가 거점 직선거리 오름차순으로 정렬해 주지만 거리 값은 응답에 없다.
  화면에 "가까운 순"이라고 적지 말고 `policy_note`만 그대로 노출한다 (05 §4).
- **`under2y_ratio`(운영 2년 미만 사업자 비중)** — 4개 시군 편차가 0.5%p뿐이라 지역 비교 근거가
  못 된다. '위험' 라벨·경고색·순위 정렬 없이 배경 정보로만 적는다 (05 §6).
- **가맹점은 "확보"가 아니라 "가맹 전환·우선 모집"** — 사업자가 신청하고 강원랜드가 심사하는 구조다.
- **페이백은 적립이 아니라 사용 단계 리워드**(발행액 증액 없음).
- 지어낸 수치·상태(영업중, 알림 3건, 위젯 이용자 수 등)를 화면에 만들지 않는다.
- 푸터의 출처 표기(공공데이터 + OpenStreetMap attribution)는 의무 사항이라 빼지 않는다.

## 남은 일 / 알려진 제약

- **F3·F4·F6·F8 화면** — 자리표시자에 "이미 연결된 데이터"와 "남은 작업"을 적어 뒀다.
- **지도** — 카드 상세(F4)는 MapLibre GL + OpenFreeMap을 사용하고, 방문객 위젯(F7)은 Kakao Maps JS를
  우선 사용한다. Kakao 키·도메인이 준비되지 않은 환경에서는 좌표 기반 지도형 fallback과 길찾기 링크를 보인다.
- **로딩·에러 상태** — F9 항목. Lambda 콜드스타트 1~3초를 "고장"으로 오인하지 않게
  스켈레톤 + 재시도 UI가 필요하다.
- **모바일 실기기 확인** — 390px 뷰포트 기준으로 짰지만(모바일 프레임·`overflow-x-auto` 표 래퍼·
  차트 `min-w-0`) iPhone Safari 실기기 확인은 F9/Phase 6 리허설 항목으로 남아 있다.
