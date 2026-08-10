import json
import logging
import os
from pathlib import Path

if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):      # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from mangum import Mangum

from app import security
from app.routes import cards, dashboard, kpi, progress, widget

# 배포 환경에서 미설정 CORS가 전체 허용으로 열리지 않게 한다. 로컬만 명시적인 localhost 기본값을
# 쓰고, Lambda는 SAM 파라미터로 전달된 오리진만 허용한다.
_origin_default = "" if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") else "http://localhost:3100,http://127.0.0.1:3100"
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", _origin_default).split(",") if o.strip()]
if "*" in ALLOWED_ORIGINS:
    raise RuntimeError("ALLOWED_ORIGINS='*' is not allowed; configure explicit frontend origins")

# 로깅: Lambda·로컬 양쪽에서 app 로거(LLM 실패 경고 등)가 보이도록 최소 설정만 한다.
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
if not logging.getLogger().handlers:    # uvicorn·Lambda가 이미 붙인 핸들러는 덮지 않는다
    logging.basicConfig(level=LOG_LEVEL)
logging.getLogger("app").setLevel(LOG_LEVEL)

# health의 data_loaded 판정 대상 — risk_signal은 07 문서 B4 ⑥에서 "없으면 컷"인 선택 입력이고
# manifest는 X-Dataset-Version 헤더용 부가 정보(A4)라, 둘 다 datasets에만 싣고 AND 판정에서는 뺀다.
REQUIRED_DATASETS = ("dashboard", "eup_scores", "candidates", "merchants")
OPTIONAL_DATASETS = ("risk_signal", "manifest")

app = FastAPI(title="상생 나침반 API")
# 미들웨어 순서 주의: Starlette는 **나중에 add한 것이 바깥**이다. CORS가 바깥이어야
# 에러 응답(예외 처리 결과)에도 CORS 헤더가 붙으므로 GZip을 먼저, CORS를 나중에 add한다.
app.add_middleware(GZipMiddleware, minimum_size=1000)   # /api/candidates 285KB → gzip 44KB (실측)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Dataset-Version"],   # 없으면 브라우저 JS가 이 헤더를 못 읽는다 (05 §5)
)


@app.middleware("http")
async def disable_api_cache(request: Request, call_next):
    """상태 변경 직후 dashboard/KPI/widget API가 브라우저·프록시에 남지 않게 한다."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.middleware("http")
async def dataset_version_header(request: Request, call_next):
    """모든 /api/* 응답에 X-Dataset-Version을 실어 화면이 어느 데이터셋으로 만들어졌는지 보여준다
    (05 §5, A4 — Task C1 출처 칩이 이 값을 화면에 표시한다).

    manifest.json이 없거나(구 데이터 환경) 손상됐을 때도 응답 자체는 정상 200이어야 하므로,
    health()가 같은 dataload.load() 호출에 대해 잡는 예외 범위(FileNotFoundError·JSONDecodeError)를
    그대로 따르고, manifest는 있지만 dataset_version 키가 없는 기형 파일까지 대비해 KeyError도 잡는다.
    """
    from app import dataload
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        try:
            response.headers["X-Dataset-Version"] = dataload.load("manifest")["dataset_version"]
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            pass  # manifest 미생성·손상 환경에서도 응답은 정상
    return response


for r in (dashboard.router, cards.router, progress.router, widget.router, kpi.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    """산출물별 로드 여부까지 보고 (05 문서 §5) — dashboard 하나만 보면 나머지 결손을 놓친다.

    JSONDecodeError까지 잡는 이유: 이 엔드포인트의 목적이 배포 후 data 복사 실패 진단인데,
    `cp`가 중간에 끊겨 "파일은 있고 내용이 잘린" 상태가 정확히 그 케이스다. 진단해야 할
    상황에서 health 자체가 500으로 죽으면 안 된다.
    """
    from app import dataload
    datasets = {}
    for name in REQUIRED_DATASETS + OPTIONAL_DATASETS:
        try:
            dataload.load(name)
            datasets[name] = True
        except (FileNotFoundError, json.JSONDecodeError):
            datasets[name] = False
    return {"ok": True,
            "demo_read_only": security.demo_read_only(),
            "data_loaded": all(datasets[n] for n in REQUIRED_DATASETS),
            "datasets": datasets}


handler = Mangum(app)   # Lambda 진입점
