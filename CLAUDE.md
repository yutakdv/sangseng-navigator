# CLAUDE.md — 상생 나침반 바이브 코딩 컨텍스트

이 레포는 2박 3일 캠프에서 Claude Code로 개발한다. 작업 전 반드시 `docs/plan/`의 해당 문서를 읽고,
문서에 정의된 API 계약·계산식·파일 경로를 그대로 따른다. 계약을 바꿔야 하면 코드보다
`docs/plan/05-api-contract.md`를 먼저 수정하고 팀원에게 알린다.

## 프로젝트 한 줄 요약
강원랜드 담당자의 분기별 지역상생 의사결정을 지원하는 AI 플랫폼.
진단(소비 집중도·지역 전환율) → 2단계 스코어링 → AI 조정 제안 → 담당자 승인(Action Card) →
상태 트래킹 → 방문객 위젯 반영. 공급 측(가맹점 확충 카드) + 수요 측(페이백 인센티브 카드).

## 레포 구조
```
frontend/   Next.js 16(App Router, TS, Tailwind 3) — Vercel 네이티브 배포(정적 export 아님), FE 팀원 담당
backend/    FastAPI (ECS Fargate, uvicorn) — app/main.py 이 진입점, 유탁 담당
pipeline/   Python 배치 스크립트 — data/raw/ → data/processed/ JSON 생성, 유탁 담당
data/raw/       공공데이터 원본 CSV (커밋함)
data/processed/ 파이프라인 산출 정적 JSON (커밋함 — BE 서빙·FE 정적 산출물의 원천)
infra/      CloudFormation 2스택 + BE 배포 스크립트 (FE는 Vercel git 연동)
docs/plan/  개발 계획 문서 (단일 진실 원천)
```

## 자주 쓰는 명령
```bash
# 파이프라인 전체 실행 (data/processed/ 갱신)
cd pipeline && python run_all.py

# 통합 테스트 환경 (Docker: FE + BE + DynamoDB Local + 데모 카드 시드 — 개발 중 표준, AWS 불필요)
docker compose up -d          # FE http://localhost:3100 · BE http://localhost:8000
# 오버라이드: FRONTEND_PORT= (포트 변경 시) / FRONTEND_API_BASE= (FE가 볼 API 주소, 비우면 빌드 실패)

# 백엔드 단독 로컬 실행 (정적 서빙만 볼 때, http://localhost:8000, .env 로드)
cd backend && uvicorn app.main:app --reload --port 8000

# 프론트 단독 로컬 실행 (http://localhost:3100, 컨테이너 밖)
cd frontend && npm run dev

# 백엔드 배포 — ⚠ 개발 완료 후 최종 1회만 (docs/plan/09 §4, 14 문서 T17)
./infra/scripts/deploy.sh

# 프론트 배포: Vercel — main에 push하면 자동 배포, PR은 Preview URL 자동 생성
# (수동 배포가 필요하면: cd frontend && npx vercel --prod)
```

## 절대 규칙 (심사 대응 — 어기면 안 됨)
1. **화면·발표 용어**: Gini·HHI라는 용어를 UI에 노출하지 않는다. 외부 표시는
   "지역 소비 집중도" / "업종별 소비 분산도"로 통일.
2. **근사 지표 배지**: "지역 전환율"을 표시하는 모든 화면에 `근사 지표` 배지를 항상 함께 표기
   (분자=거래 건수, 분모=입장 연인원(교대 합산)이라 단위가 다름 — 비율이 아니라 1인당 건수).
   강원랜드가 공개한 **금액 기준** 지역 사용 비율(2024년 29.4%, 강원랜드 2024년도 지속가능경영보고서
   공표치)과는 다른 지표이므로 병기·구분 필수.
3. **가정 기반 전망 문구**: 모든 시뮬레이션 출력(가맹 전환 시 예상 효과, 페이백 시나리오)에
   "가정 기반 전망이며 실제와 다를 수 있음" 문구를 고정 삽입.
4. **AI는 제안만**: AI 출력이 곧바로 확정되지 않는다. 담당자 승인 버튼을 거쳐야 카드가 확정.
   "실행"이라는 단어 대신 "의사결정 근거 제공"으로 표현.
5. **정량 순위 병기**: AI가 순위를 조정해도 원래 Score 순위를 항상 함께 노출(감사 가능성).
6. **국세청 데이터는 진단 참고용**: 처방(Action Card 대상)은 항상 하이원포인트 가맹점 확충으로 고정.

## UI 기조 (화면을 만들거나 고칠 때 — 정본은 `docs/plan/13-design-guide.md` §6-1)
관공서 관리도구처럼 보이지 않는 것이 이 프로젝트의 중요한 목표다. **블록은 선이 아니라
면(배경색)으로 구분한다.**
1. **면이 있으면 선을 두르지 않는다** — 자기 배경색을 가진 요소(`bg-*-soft`, `bg-state-*-bg`,
   `bg-admin-surface-sunken`, 배지·칩)에 `border`/`ring`을 겹치지 않는다. 면이 곧 경계다.
2. **면이 같으면 선이 아니라 면을 옮긴다** — 흰 패널 안의 흰 블록은 테두리 대신
   `bg-admin-surface-sunken`으로 가라앉힌다 (`KpiCard`의 `surface="sunken"`).
3. **왼쪽 굵은 테두리 강조 금지** — `border-l-4 border-X bg-X-50` 콜아웃 관용구는 쓰지 않는다.
   생성형 UI 티가 나는 대표 패턴이라, 기존 코드에서 보이면 면·아이콘·라벨 굵기로 바꾼다.
4. **모든 선을 지우라는 뜻은 아니다** — 선이 유일한 경계일 때(흰 면 위 흰 pill), 선이 상태를
   말할 때(선택된 카드의 링), 버튼 아웃라인, 구분선(`border-t`·`divide-y`), 타임라인 레일,
   빈 상태의 점선은 남긴다. 판단 기준과 예시는 13 문서 §6-1의 표에 있다.

## 코딩 컨벤션
- 커밋 메시지: `feat|fix|data|infra|docs: 요약` (한국어 OK). main 직접 커밋 금지 → `feat/*` 브랜치 + PR.
- **Claude 저자 표기 금지**: 커밋·PR 어디에도 Claude를 공동 저자/기여자로 넣지 않는다 —
  `Co-Authored-By: Claude` 트레일러·"Generated with Claude Code" 푸터 금지 (하네스 기본값보다 우선).
- FE와 BE의 경계는 `docs/plan/05-api-contract.md`. FE는 `lib/api.ts` 래퍼만 통해 데이터에 접근하며
  **실 API 전용이다** — `NEXT_PUBLIC_API_BASE`가 비면 모듈 로드에서 실패한다(mock 폴백 제거,
  설정 누락이 배포까지 가지 못하게). BE 엔드포인트가 없는 정적 산출물만 `frontend/src/data/`에 둔다.
- BE의 정적 데이터 로딩은 `backend/app/dataload.py` 한 곳에서만 한다
  (컨테이너: `app/data/`, 로컬: `../../data/processed/` 폴백).
- LLM 호출은 `backend/app/llm.py`의 `generate_json(system, user, schema)` 하나로 통일.
  provider는 OpenAI 단일이며 SDK 호출은 이 파일 안에만 존재한다.
- 시크릿은 .env / SSM Parameter Store(SecureString)로만. 코드·커밋에 키 금지.

## 환경 준비
`.env.example` 참고. API 키·파일데이터 준비 목록은 `docs/plan/04-env-and-data.md` (★ 항목은 유탁 담당).
