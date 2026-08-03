"""공용 상수·함수 — 계산식 정본은 docs/plan/06-pipeline-tasks.md."""
import math
from pathlib import Path

RAW_DIR = Path(__file__).parents[1] / "data" / "raw"
PROCESSED_DIR = Path(__file__).parents[1] / "data" / "processed"

REGIONS = ["고한읍", "사북읍", "정선군", "태백시", "영월군", "삼척시"]
SIGUNGUS = ["정선군", "태백시", "영월군", "삼척시"]  # 국세청 파생지표 대상 (P7)
SIDO_LITERAL = "강원특별자치도"  # 국세청 CSV 시도 컬럼 실측값 — "강원" 완전일치는 0행

# 관광동선 거점 — 강원랜드 카지노 실좌표 (정선군 사북읍 하이원길 265, OSM/공식 주소 대조).
# 기존 "하이원리조트 정문" 37.2049/128.8358 은 역지오코딩 결과 하이원 스키장 밸리 구역
# (곤돌라 하단 부근, 해발 825m)이고 정문이라는 근거가 없어 폐기했다 — 실제 카지노와 1.46km 차이.
# 앵커 교체 후 재산출에서 상위 5곳 명단·순서는 동일함을 확인(감사 실측 → 재실행으로 재확인).
ANCHOR = {"name": "강원랜드 카지노(하이원리조트)", "lat": 37.21164, "lng": 128.82168}
RADIUS_M = 500
EUP_WEIGHTS = {"v1": 0.5, "v2": 0.5}          # 1단계: 소비저조도·소비증감
CAND_WEIGHTS = {"w1": 1 / 3, "w2": 1 / 3, "w3": 1 / 3}  # 2단계: 업종공백도·관광동선근접도·기존가맹포화도


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def gini(counts):
    """지역 간 건수 분포 지니계수. 화면 노출 금지(내부 계산용) — 외부 표시는 0~100 지수."""
    n = len(counts)
    mean = sum(counts) / n
    if mean == 0:
        return 0.0
    return sum(abs(a - b) for a in counts for b in counts) / (2 * n * n * mean)


def gini_to_index(g, n=6):
    """0~100 정규화: gini 최대값 (1 - 1/n) 기준."""
    return round(g / (1 - 1 / n) * 100)


def grade(index):
    return "높음" if index >= 66 else ("보통" if index >= 33 else "낮음")


def hhi_dispersion_index(counts):
    """업종별 소비 분산도 = (1 - HHI) 0~100."""
    total = sum(counts)
    if total == 0:
        return 0
    hhi = sum((c / total) ** 2 for c in counts)
    return round((1 - hhi) * 100)
