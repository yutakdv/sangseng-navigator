# 03. 모노레포 구조와 협업 규칙

## 디렉토리 구조 (스캐폴딩 목표)

```
sangseng-navigator/
├── CLAUDE.md                  # 바이브 코딩 컨텍스트 (작성 완료)
├── README.md
├── .env.example               # ★ 복사해서 .env 생성
├── .gitignore
│
├── frontend/                  # ← FE 팀원 전담 영역
│   ├── package.json
│   ├── next.config.mjs        # Vercel 네이티브 배포 (정적 export 불필요)
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── page.tsx               # ① Action Card 허브 (첫 화면)
│       │   ├── cards/[id]/page.tsx    # ② 카드 상세 (지도+근거+시뮬레이션)
│       │   ├── dashboard/page.tsx     # ③ 집중도 대시보드
│       │   ├── incentive/page.tsx     # ④ 인센티브 정책 카드
│       │   ├── widget/page.tsx        # ⑤ 방문객 위젯 (모바일 뷰)
│       │   └── tracking/page.tsx      # ⑥ 실행 상태 트래킹
│       ├── components/                # KpiCard, Badge(근사지표/가정기반), CardItem, MapView ...
│       ├── lib/api.ts                 # 단일 데이터 접근 계층 (mock ↔ 실 API 전환)
│       └── mocks/                     # data/processed 실산출 → ./scripts/sync-mocks.sh 로 생성, 커밋 안 함
│                                       #   (cards/kpi/widget/simulate 등 스크립트 대상 외는 05 예시 구조 참조)
│
├── backend/                   # ← 유탁 전담 영역
│   ├── requirements.txt       # fastapi, mangum, boto3, python-dotenv, openai, anthropic (pandas 금지 — 07 문서)
│   ├── seed_demo.py           # 데모 시드/리셋 스크립트 (--reset 지원, 07 문서 B4)
│   ├── tests/test_smoke.py    # 배포 전 스모크 기준 (07 문서 B7)
│   └── app/
│       ├── main.py            # FastAPI 앱 + `handler = Mangum(app)`
│       ├── routes/            # dashboard.py, cards.py, widget.py, kpi.py
│       ├── services/          # scoring.py(재계산), cardgen.py(LLM 카드 생성), simulate.py
│       ├── llm.py             # generate_json(system, user, schema) — provider 분기 유일 지점
│       ├── prompts.py         # 시스템 프롬프트(발표 공개용 원문 유지)
│       ├── db.py              # DynamoDB CRUD (cards 테이블)
│       └── dataload.py        # processed JSON 로더 (Lambda: app/data/, 로컬: ../../data/processed/)
│
├── pipeline/                  # ← 유탁 전담 영역
│   ├── requirements.txt       # pandas, requests, PublicDataReader, python-dotenv, xmltodict
│   ├── common.py              # 상수(지역·거점·가중치)·haversine·gini 등 공용 함수 (06 문서)
│   ├── category_map.py        # 하이원 업종 ↔ 소진공 업종 대분류 매핑 표 (실데이터 확인 후 작성)
│   ├── run_all.py             # 전체 실행 진입점 (아래 스크립트 순차 호출)
│   ├── p1_usage.py            # 하이원포인트 사용현황 CSV → 월×지역×업종 집계
│   ├── p2_visitors.py         # 카지노 입장객 API → 월 합산 (전환율 분모)
│   ├── p3_merchants.py        # 가맹점 상세정보 API + Kakao 지오코딩
│   ├── p4_stores.py           # 소진공 상가정보 (반경 조회)
│   ├── p5_metrics.py          # 집중도·분산도·전환율 계산 → dashboard.json
│   ├── p6_scoring.py          # 1단계 읍 스코어 + 2단계 후보 스코어
│   ├── p7_risk.py             # 국세청 파생지표 (운영 2년 미만 비중)
│   └── p8_sensitivity.py      # 가중치 민감도 분석
│
├── data/
│   ├── raw/                   # ★ 원본 CSV 직접 다운로드 후 커밋 (04 문서)
│   │   └── api_cache/         # 오픈 API 원응답 캐시 (커밋함 — 재현성·호출 한도 보호, 06 문서)
│   │                          #   예외: geocode.json(Kakao 응답)은 커밋 제외 (12 문서 §4)
│   └── processed/             # 파이프라인 산출 JSON — 커밋함 (FE mock·BE 서빙 원천)
│
├── infra/
│   ├── template.yaml          # SAM: Lambda + HTTP API + DynamoDB
│   └── deploy-backend.sh      # data 복사 → sam build → sam deploy
│                              # (FE 배포는 Vercel — git push 자동, 별도 스크립트 없음)
│
└── docs/plan/                 # 이 계획 문서들
```

## 협업 규칙 (충돌 최소화)

1. **영역 분리**: FE 팀원은 `frontend/`만, 유탁은 나머지를 수정한다. 서로의 영역을 고쳐야 하면
   PR로. (유탁이 FE를 지원할 때도 브랜치+PR)
2. **경계는 계약 문서**: `05-api-contract.md`가 FE↔BE의 유일한 인터페이스. 응답 형태를 바꾸고
   싶으면 ①문서 수정 → ②`scripts/sync-mocks.sh` 재실행 → ③상대에게 공유 → ④코드 수정 순서.
3. **브랜치**: `main`(항상 데모 가능 상태 유지) ← `feat/<이름>-<주제>` PR.
   캠프 중 리뷰는 간단히(스모크 확인 후 셀프 머지 허용), 단 `main`이 깨지면 최우선 복구.
4. **mock 우선**: BE 미완성 기능은 FE가 mock으로 먼저 완성한다. mock 파일은
   `data/processed/` 산출물이 나오면 그것을 복사해 실데이터 mock으로 교체.
5. **데이터 갱신은 유탁만**: `data/processed/`는 파이프라인 실행 결과만 커밋 (`data:` 커밋 태그).
   손으로 수정 금지 — 수정할 게 있으면 파이프라인 코드를 고친다.

## 로컬 개발 흐름

```bash
# 최초 1회
git clone <repo> && cd sangseng-navigator
cp .env.example .env            # ★ 키 입력 (04 문서)
cd pipeline && python -m venv ../.venv && source ../.venv/bin/activate && pip install -r requirements.txt
cd ../backend && pip install -r requirements.txt
cd ../frontend && npm install

# 일상 루프
source .venv/bin/activate
cd pipeline && python run_all.py                      # 데이터 갱신 시에만

# BE + DynamoDB Local (Docker 테스트 환경 — 14 문서 T7, AWS 불필요)
docker compose up -d && curl localhost:8000/api/health
# (DynamoDB 없이 정적 서빙만 볼 때는 uvicorn 직접 실행도 가능:
#  cd backend && uvicorn app.main:app --reload --port 8000)

cd frontend && npm run dev                             # 별도 터미널

# FE에서 실 BE 붙이기: frontend/.env.local 에 NEXT_PUBLIC_API_BASE=http://localhost:8000
```

## 커밋 컨벤션

`feat:`(기능) `fix:`(수정) `data:`(processed 갱신) `infra:`(배포/IaC) `docs:`(문서) + 한국어 요약.
예) `feat: Action Card 허브 승인 버튼 연동`, `data: 1단계 읍 스코어 재계산(3개월 윈도우)`
