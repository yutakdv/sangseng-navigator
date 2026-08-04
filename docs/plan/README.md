# 상생 나침반 MVP 구현 계획 (마스터 인덱스)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking. 태스크 문서: 06(파이프라인) → 07(백엔드/AI) → 08(프론트) → 09(배포) 순서가 기본이며,
> FE(08)는 mock 기반으로 처음부터 병렬 진행 가능하다.

**Goal:** 2인(유탁: BE/AI/파이프라인/AWS, 팀원: FE)이 "상생 나침반" MVP를 Phase 순서대로
구현하고 최소 비용으로 배포·시연한다 (FE=Vercel, BE=AWS).

**Architecture:** 데이터 파이프라인이 공공데이터를 정적 JSON으로 사전 계산 → FastAPI(Lambda,
API Gateway HTTP API)가 JSON 서빙 + Action Card 생성/승인(DynamoDB) + LLM 호출 →
Next.js(Vercel)가 화면 렌더. FE는 API 계약 기반 mock으로 BE와 독립 개발 후 env 하나로 실 API 전환.

**Tech Stack:** Next.js 16(App Router)+TS+Tailwind 3+Recharts+MapLibre GL(OpenFreeMap 타일, 키 불필요) /
Python 3.12+FastAPI+Mangum / pandas+PublicDataReader+Kakao REST 지오코딩(VWorld 폴백) /
DynamoDB(온디맨드) / OpenAI 또는 Claude(어댑터) / 배포: Vercel(FE) + AWS SAM→Lambda+API Gateway(BE)

## Global Constraints (모든 태스크에 적용)

- 화면·발표에 Gini/HHI 용어 노출 금지 — 외부 표시명은 "지역 소비 집중도"/"업종별 소비 분산도"
- "지역 전환율" 표시 화면에는 항상 `근사 지표` 배지 병기
- 모든 시뮬레이션 출력에 "가정 기반 전망(실측 아님)" 문구 고정 삽입
- AI는 제안만, 담당자 승인으로만 카드 확정. 원 Score 순위 항상 병기
- 국세청 파생지표는 진단 참고용, 처방은 하이원포인트 가맹점 확충으로 고정
- 1단계(읍 단위)와 2단계(반경 500m) 데이터를 한 수식에 섞지 않는다
- 시크릿은 .env/SAM 파라미터로만 관리, 커밋 금지 — **저장소는 제출 시 Public 전환**되므로
  커밋 이력에 키·개인정보(예: 기획서 PDF의 연락처)가 한 번도 남으면 안 된다 (12 문서 §4)
- FE↔BE 경계는 `05-api-contract.md`가 단일 진실 — 계약 변경 시 문서 먼저 수정
- main 직접 커밋 금지, `feat/*` 브랜치 + PR

## 모델·effort 운용 원칙 (바이브 코딩)

모든 개발은 **최소 Opus + effort high**로 진행하고, 초기 구축 단계부터 **복잡한 작업은 Fable 5 + xhigh**로 진행한다.

| 구분 | 대상 작업 |
|---|---|
| **Fable xhigh** (복잡 — 정합성이 깨지기 쉬움) | Phase 1 초기 구축(스캐폴딩 전체 골격 + SAM 템플릿 + 배포 왕복), P6 1·2단계 스코어링(계산식·단계 분리), P8 민감도 분석, B4 Action Card 생성(AI 입력 ①~⑥ 조립·프롬프트), B5 반사실 시뮬레이션, F4 지도(MapLibre·Safari 리스크) |
| **Opus high** (루틴) | P1~P4 수집·집계 스크립트, B1~B2 서빙·CRUD, B6 KPI·위젯, F2·F3·F5~F8 화면, 배포 반복, 문서 정리 |

판단 기준: 계산식·API 계약의 정합성이 깨지기 쉽거나 한 결정이 여러 모듈에 파급되는 작업이면 Fable xhigh. 매핑은 기본값이며 상황에 따라 상향 조정 가능(하향은 지양).

## 문서 읽는 순서

| # | 문서 | 언제 읽나 |
|---|---|---|
| 01 | [01-overview.md](01-overview.md) | 처음, 그리고 스코프 판단이 필요할 때 |
| 02 | [02-architecture.md](02-architecture.md) | 구조 결정 확인 (왜 Lambda인가, 왜 정적 JSON인가) |
| 03 | [03-repo-structure.md](03-repo-structure.md) | 스캐폴딩·협업 시작 전 |
| 04 | [04-env-and-data.md](04-env-and-data.md) | **개발 시작 전 필수 (★ 준비물)** |
| 05 | [05-api-contract.md](05-api-contract.md) | FE·BE 작업 전 필수 |
| 06 | [06-pipeline-tasks.md](06-pipeline-tasks.md) | Phase 2 유탁 작업 |
| 07 | [07-backend-ai-tasks.md](07-backend-ai-tasks.md) | Phase 3~5 유탁 작업 |
| 08 | [08-frontend-tasks.md](08-frontend-tasks.md) | Phase 1부터 FE 병렬 작업 |
| 09 | [09-deployment.md](09-deployment.md) | 배포 리허설(Phase 1) + 실배포(Phase 6) + 비용 |
| 10 | [10-timeline.md](10-timeline.md) | Phase 0~6 작업 순서·게이트 (일자 구분 없음) |
| 11 | [11-demo-and-qa.md](11-demo-and-qa.md) | 데모 클릭 스크립트·발표 구조·예상 질문 대응 (Phase 6) |
| 12 | [12-submission-compliance.md](12-submission-compliance.md) | **경진대회 제출 요건 대응** — Phase 0(레포 준비)·Phase 6(제출) 전 필수 |
| 13 | [13-design-guide.md](13-design-guide.md) | 목업(image-1/2) 기반 디자인 가이드 — FE 화면 작업 전 필수 |
| 14 | [14-execution-plan.md](14-execution-plan.md) | **잔여 개발 실행 런북 (T0~T18)** — 매 태스크 시작 전 여기서 절차 확인. Docker 테스트·AWS 최종 배포 전환 반영 |
| 15 | [15-plan-review.md](15-plan-review.md) | **개발 착수 전 최종 검토 결과 (2026-08-03)** — 착수 첫 커밋 수정분(배포 블로커 2건)·태스크별 계약 선수정 추적 (§8 시점표) |

## Phase 게이트 요약 (상세: 10 문서)

- **Phase 0:** API 승인·CSV·.env·Vercel 연결 완료 (블로커 해소)
- **Phase 1:** 스캐폴딩 + mock 렌더 + Docker 스모크 (배포는 개발 완료 후 최종 1회로 변경 — 09 §4)
- **Phase 2:** `python run_all.py` 한 번으로 `data/processed/` 전체 재현
- **Phase 3:** 허브·대시보드가 로컬 실 BE 데이터로 동작
- **Phase 4:** AI 카드 생성(실시간) + "Score 2위 → 1순위 제안" 조정 사례 시드 고정 재현
- **Phase 5:** 로컬 풀루프 완주 (생성→승인→완료→위젯 반영→인센티브)
- **Phase 6:** 배포 URL에서 데모 시나리오 30초 완주 ×10회
