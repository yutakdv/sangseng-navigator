#!/usr/bin/env python3
"""지역 선택 지도 geometry 생성 — 실제 행정구역 GeoJSON → src/components/RegionalMap/mapData.ts

지도의 지리 정보는 **실제 행정구역 데이터**에서만 온다. 지역 모양을 추측해 그리지 않는다.

원천 데이터 (다운로드 URL을 인자로 받은 파일 경로 대신 쓸 수 있게 헤더에 박아 둔다):
  1) 시·군 경계 — southkorea/southkorea-maps, KOSTAT(통계청) 2018 시군구, WGS84
     https://raw.githubusercontent.com/southkorea/southkorea-maps/master/kostat/2018/json/skorea-municipalities-2018-geo.json
     (통계청 통계지리정보서비스 공개 경계 가공본 — 저장소 공개 데이터)
  2) 읍·면·동 경계 — vuski/admdongkor ver20250401, 행정안전부 행정동 기반, WGS84
     https://raw.githubusercontent.com/vuski/admdongkor/master/ver20250401/HangJeongDong_ver20250401.geojson
     (공공데이터 기반 공개 저장소 — 출처 표기 후 자유 이용)

추출 대상:
  시·군: 영월군 · 정선군 · 태백시 · 삼척시(옅은 배경 컨텍스트 전용)
  읍  : 정선군 고한읍 · 정선군 사북읍 · 삼척시 도계읍
  ⚠ 이 서비스의 "삼척시" 값은 시 전역이 아니라 하이원포인트 지역가맹 대상지역인
    **도계읍** 기준이다(REGION_TOOLTIP). 그래서 선택 영역은 도계읍 경계로 그리고,
    삼척시 전체 윤곽은 비대화형 배경으로만 깐다.

처리: 추출 → RDP 단순화(형태 유지) → 등장방형 투영(위도 보정) → viewBox 정규화
      → path d + 라벨용 centroid 산출. 소도서(최대 폴리곤 대비 면적 1% 미만)는
      일러스트 단순화 원칙으로 제거하고 그 사실을 산출물 주석에 남긴다.

실행:  python3 build_region_map.py <munis.json> <dong.geojson>
산출:  ../src/components/RegionalMap/mapData.ts (커밋 대상 — 런타임 지도 라이브러리 불필요)
"""

import json
import math
import sys
from pathlib import Path

VIEW_W = 860.0  # viewBox 너비 — 높이는 실제 위경도 비율에서 계산
PAD = 14.0      # 경계가 viewBox에 닿지 않게 두는 여백(px)
RDP_EPS = 1.1   # 단순화 허용 오차(투영 px) — 형태가 뭉개지지 않는 선에서 점을 줄인다
MIN_AREA_RATIO = 0.01  # 최대 폴리곤 대비 이 미만 면적(소도서 등)은 버린다

COUNTIES = ["영월군", "정선군", "태백시", "삼척시"]
TOWNS = {  # adm_nm 부분 문자열 → 산출 id
    "정선군 고한읍": "gohan",
    "정선군 사북읍": "sabuk",
    "삼척시 도계읍": "dogye",
}
COUNTY_IDS = {"영월군": "yeongwol", "정선군": "jeongseon", "태백시": "taebaek", "삼척시": "samcheok"}


def polygons_of(geom):
    """Polygon/MultiPolygon → [외곽 링, ...] (내부 링(구멍)은 이 지역들엔 없어 무시)"""
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def ring_area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def rdp(points, eps):
    """Ramer–Douglas–Peucker — 재귀 없이 스택으로 (링이 수천 점이라 재귀 한도 회피)"""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        far_i, far_d = -1, 0.0
        for i in range(a + 1, b):
            px, py = points[i]
            if norm < 1e-12:
                # 닫힌 링은 첫 점 == 끝 점이라 기준 선분이 퇴화한다 — 외적 거리는 이때
                # 모든 점에서 0이 되어 링 전체가 사라지므로, 점-점 거리로 대신 잰다
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dx * (ay - py) - dy * (ax - px)) / norm
            if d > far_d:
                far_i, far_d = i, d
        if far_d > eps:
            keep[far_i] = True
            stack.append((a, far_i))
            stack.append((far_i, b))
    return [p for p, k in zip(points, keep) if k]


def point_in_ring(x, y, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def dist_to_ring(x, y, ring):
    best = float("inf")
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        dx, dy = x2 - x1, y2 - y1
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / seg2))
        best = min(best, math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)))
    return best


def label_anchor(ring):
    """라벨 기준점 = 폴리곤 내부 최심점(pole of inaccessibility, 경계에서 가장 먼 내부 점).

    면적 무게중심(centroid)은 오목한(L자형) 행정구역에서 시각적 중앙을 벗어나거나
    폴리곤 밖으로 빠진다 — 실제로 영월군·태백시 라벨이 어긋났다. 최심점은 정의상
    항상 내부이고, 라벨 주변 여백이 가장 넓은 지점이라 지도 라벨 배치의 표준이다.
    구현: 거친 격자 탐색 → 최적점 주변을 격자 간격 반감하며 3회 정밀화 (오차 ≪ 1px).
    """
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    min_x, max_x, min_y, max_y = min(xs), max(xs), min(ys), max(ys)
    step = max(max_x - min_x, max_y - min_y) / 40.0
    best = (0.0, (min_x + max_x) / 2.0, (min_y + max_y) / 2.0)

    def scan(cx0, cy0, half, s):
        nonlocal best
        y = cy0 - half
        while y <= cy0 + half:
            x = cx0 - half
            while x <= cx0 + half:
                if point_in_ring(x, y, ring):
                    d = dist_to_ring(x, y, ring)
                    if d > best[0]:
                        best = (d, x, y)
                x += s
            y += s

    scan((min_x + max_x) / 2.0, (min_y + max_y) / 2.0, max(max_x - min_x, max_y - min_y) / 2.0, step)
    for _ in range(3):
        step /= 2.0
        scan(best[1], best[2], step * 4.0, step)
    return (best[1], best[2])


def main(munis_path, dong_path):
    munis = json.load(open(munis_path))
    dong = json.load(open(dong_path))

    shapes = {}  # id → {"name", "rings": [[(lon,lat)...]]}
    for f in munis["features"]:
        name = f["properties"].get("name", "")
        if name in COUNTIES and f["properties"].get("code", "").startswith("32"):  # 강원
            shapes[COUNTY_IDS[name]] = {"name": name, "rings": polygons_of(f["geometry"])}
    for f in dong["features"]:
        adm = f["properties"].get("adm_nm", "")
        for key, rid in TOWNS.items():
            if key in adm:
                shapes[rid] = {"name": adm.split()[-1], "rings": polygons_of(f["geometry"])}

    missing = ({"gohan", "sabuk", "dogye"} | set(COUNTY_IDS.values())) - set(shapes)
    if missing:
        sys.exit(f"필수 지역 누락: {missing} — 원천 데이터를 확인하라")

    # 소도서 제거 (삼척시 해안 등) — 지역마다 최대 폴리곤 대비 면적 1% 미만은 버린다
    dropped = 0
    for s in shapes.values():
        areas = [ring_area(r) for r in s["rings"]]
        biggest = max(areas)
        kept = [r for r, a in zip(s["rings"], areas) if a >= biggest * MIN_AREA_RATIO]
        dropped += len(s["rings"]) - len(kept)
        s["rings"] = kept

    # 등장방형 투영 (중위도 cos 보정) → viewBox 정규화
    all_pts = [p for s in shapes.values() for r in s["rings"] for p in r]
    lons = [p[0] for p in all_pts]
    lats = [p[1] for p in all_pts]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    k = math.cos(math.radians((min_lat + max_lat) / 2.0))
    span_x = (max_lon - min_lon) * k
    span_y = max_lat - min_lat
    scale = (VIEW_W - 2 * PAD) / span_x
    view_h = round(span_y * scale + 2 * PAD, 1)

    def project(lon, lat):
        return ((lon - min_lon) * k * scale + PAD, (max_lat - lat) * scale + PAD)

    out = {}
    for rid, s in shapes.items():
        proj_rings = [[project(lon, lat) for lon, lat in r] for r in s["rings"]]
        simplified = [rdp(r, RDP_EPS) for r in proj_rings]
        d_parts = []
        for r in simplified:
            coords = " L".join(f"{x:.1f} {y:.1f}" for x, y in r)
            d_parts.append(f"M{coords} Z")
        # 라벨 기준점은 최대 폴리곤의 내부 최심점 (label_anchor 주석 참고)
        big = max(simplified, key=ring_area)
        cx, cy = label_anchor(big)
        out[rid] = {
            "name": s["name"],
            "d": " ".join(d_parts),
            "cx": round(cx, 1),
            "cy": round(cy, 1),
            "points": sum(len(r) for r in simplified),
        }

    total_pts = sum(v["points"] for v in out.values())
    ts = []
    ts.append("// 이 파일은 frontend/scripts/build_region_map.py 가 생성한다 — 손으로 수정하지 말 것.")
    ts.append("//")
    ts.append("// 지리 정보 출처 (실제 행정구역 경계 — 임의로 그린 모양이 아니다):")
    ts.append("//   시·군: southkorea/southkorea-maps · KOSTAT(통계청) 2018 시군구 경계, WGS84")
    ts.append("//   읍   : vuski/admdongkor ver20250401 · 행정안전부 행정동 경계 기반, WGS84")
    ts.append("// 가공: RDP 단순화(투영 1.1px 허용 오차) + 등장방형 투영(위도 보정) + 소도서 제거")
    ts.append(f"//       (최대 폴리곤 대비 면적 1% 미만 {dropped}개 링 제거 — 일러스트 단순화 원칙)")
    ts.append(f"// 총 {total_pts}점 · 재생성: python3 frontend/scripts/build_region_map.py <시군구.json> <행정동.geojson>")
    ts.append("")
    ts.append(f"export const MAP_VIEWBOX = {{ width: {VIEW_W:.0f}, height: {view_h} }};")
    ts.append("")
    ts.append("/** 지역별 SVG 경로(d)와 라벨 기준점(최대 폴리곤 centroid) — viewBox 좌표계 */")
    ts.append("export const MAP_SHAPES: Record<string, { d: string; cx: number; cy: number }> = {")
    for rid in ["samcheok", "yeongwol", "jeongseon", "taebaek", "dogye", "gohan", "sabuk"]:
        v = out[rid]
        ts.append(f"  // {v['name']} ({v['points']}점)")
        ts.append(f"  {rid}: {{ d: \"{v['d']}\", cx: {v['cx']}, cy: {v['cy']} }},")
    ts.append("};")
    ts.append("")

    dest = Path(__file__).resolve().parent.parent / "src" / "components" / "RegionalMap" / "mapData.ts"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text("\n".join(ts), encoding="utf-8")
    print(f"완료: {dest}")
    for rid, v in out.items():
        print(f"  {rid:10s} {v['name']:6s} {v['points']:4d}점  centroid=({v['cx']}, {v['cy']})")
    print(f"  viewBox 860×{view_h} · 소도서 제거 {dropped}링 · 총 {total_pts}점")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("사용법: python3 build_region_map.py <시군구 geojson> <행정동 geojson>")
    main(sys.argv[1], sys.argv[2])
