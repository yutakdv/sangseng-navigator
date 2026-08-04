"""B1: 정적 데이터 서빙 — /api/dashboard, /api/candidates, /api/risk-signal."""
from fastapi import APIRouter, HTTPException

from app import dataload

router = APIRouter()


@router.get("/dashboard")
def get_dashboard():
    try:
        return dataload.load("dashboard")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="dashboard.json이 아직 생성되지 않았습니다") from exc


@router.get("/candidates")
def get_candidates():
    try:
        eup_scores = dataload.load("eup_scores")
        candidates = dataload.load("candidates")
        merchants = dataload.load("merchants")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503,
                            detail="candidates 관련 산출 JSON이 아직 생성되지 않았습니다") from exc
    return {
        "eup_ranking": eup_scores["eup_ranking"],
        "selected_eups": eup_scores["selected_eups"],
        "candidates": candidates,
        "merchants": merchants,
    }


@router.get("/risk-signal")
def get_risk_signal():
    """운영 2년 미만 사업자 비중 — 대시보드 요인 카드용 배경 지표 (05 §1, 13 §2-15).

    산출 JSON을 **그대로** 배열로 돌려준다 — `sync-mocks.sh`가 같은 파일을 FE mock으로 복사하므로
    mock 모드와 실 API 모드의 응답이 바이트 단위로 같아야 한다 (05 §6 mock 원천 단일화).

    처방 근거가 아니라 진단 참고용이다 (절대 규칙 6). 4개 시군 편차가 0.5%p뿐이라
    지역 비교·순위 정렬·'위험' 라벨에 쓰면 안 된다 — 표시 규칙은 05 §6·13 §7에 있다.
    """
    try:
        return dataload.load("risk_signal")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="risk_signal.json이 아직 생성되지 않았습니다") from exc
