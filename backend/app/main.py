import os
from pathlib import Path

if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):      # 로컬에서만 .env 로드
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from app.routes import cards, dashboard, kpi, widget

app = FastAPI(title="상생 나침반 API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
for r in (dashboard.router, cards.router, widget.router, kpi.router):
    app.include_router(r, prefix="/api")


@app.get("/api/health")
def health():
    from app.dataload import loaded_ok
    return {"ok": True, "data_loaded": loaded_ok()}


handler = Mangum(app)   # Lambda 진입점
