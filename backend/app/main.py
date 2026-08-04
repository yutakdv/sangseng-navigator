import logging
import os
from pathlib import Path

if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):      # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from mangum import Mangum

from app.routes import cards, dashboard, kpi, widget

# 배포 URL 확정 후 09 문서 §5에서 좁힌다 — 코드 수정 없이 SAM 파라미터(환경변수)만 바꾸면 되게
# 쉼표 구분 목록으로 받는다. 미설정·빈 값이면 지금까지와 같은 전체 허용("*").
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()] or ["*"]

# 로깅: Lambda·로컬 양쪽에서 app 로거(LLM 실패 경고 등)가 보이도록 최소 설정만 한다.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
if not logging.getLogger().handlers:    # uvicorn·Lambda가 이미 붙인 핸들러는 덮지 않는다
    logging.basicConfig(level=LOG_LEVEL)
logging.getLogger("app").setLevel(LOG_LEVEL)

# health의 data_loaded 판정 대상 — risk_signal은 07 문서 B4 ⑥에서 "없으면 컷"인 선택 입력이라
# datasets에만 싣고 AND 판정에서는 뺀다.
REQUIRED_DATASETS = ("dashboard", "eup_scores", "candidates", "merchants")
OPTIONAL_DATASETS = ("risk_signal",)

app = FastAPI(title="상생 나침반 API")
# 미들웨어 순서 주의: Starlette는 **나중에 add한 것이 바깥**이다. CORS가 바깥이어야
# 에러 응답(예외 처리 결과)에도 CORS 헤더가 붙으므로 GZip을 먼저, CORS를 나중에 add한다.
app.add_middleware(GZipMiddleware, minimum_size=1000)   # /api/candidates 299KB → gzip 44KB (실측)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])
for r in (dashboard.router, cards.router, widget.router, kpi.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    """산출물별 로드 여부까지 보고 (05 문서 §5) — dashboard 하나만 보면 나머지 결손을 놓친다."""
    from app import dataload
    datasets = {}
    for name in REQUIRED_DATASETS + OPTIONAL_DATASETS:
        try:
            dataload.load(name)
            datasets[name] = True
        except FileNotFoundError:
            datasets[name] = False
    return {"ok": True,
            "data_loaded": all(datasets[n] for n in REQUIRED_DATASETS),
            "datasets": datasets}


handler = Mangum(app)   # Lambda 진입점
