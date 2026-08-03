"""B1: 정적 데이터 서빙 — /api/dashboard, /api/candidates."""
from fastapi import APIRouter, HTTPException

from app import dataload

router = APIRouter()


@router.get("/dashboard")
def get_dashboard():
    try:
        return dataload.load("dashboard")
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="dashboard.json이 아직 생성되지 않았습니다")


@router.get("/candidates")
def get_candidates():
    try:
        eup_scores = dataload.load("eup_scores")
        candidates = dataload.load("candidates")
        merchants = dataload.load("merchants")
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="candidates 관련 산출 JSON이 아직 생성되지 않았습니다")
    return {
        "eup_ranking": eup_scores["eup_ranking"],
        "selected_eups": eup_scores["selected_eups"],
        "candidates": candidates,
        "merchants": merchants,
    }
