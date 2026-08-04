"""P8: 가중치 민감도 분석 — 가중치 격자 전수 재계산 → sensitivity.json.

스펙 정본은 docs/plan/06-pipeline-tasks.md P8, 출력 계약은 05 §부록(`{combos, top3_stable_ratio, detail}`).
P6 산식을 다시 구현하지 않는다 — p6_scoring.stage1_eup_ranking/stage2_candidates 에 가중치만 주입한다.

격자 (06 P8 "v1 ∈ {0.3~0.7} × 2단계 각 0.2~0.47, 합=1"):
  1단계  v1 ∈ {0.3, 0.4, 0.5, 0.6, 0.7}, v2 = 1 − v1                             → 5개
  2단계  (w1, w2, w3) = (n1, n2, n3)/15, n_i ∈ {3,4,5,6,7}, Σn_i = 15           → 19개
         = 각 가중치 0.200~0.467, 격자 간격 1/15 ≈ 0.067, 합은 유리수로 정확히 1
  기본 가중치(0.5/0.5, 1/3·1/3·1/3)가 두 격자의 정확한 중심점 → 전수 5 × 19 = 95 조합

안정 판정: 그 조합의 Top3 후보 **identity 집합**이 기본 가중치 Top3와 같으면 안정
  (13 문서 대시보드 툴팁 정의 "상위 3개 후보가 유지된 비율" — 유지 = 세 후보가 그대로 Top3).
  순위까지 같은지는 더 엄격한 보조 지표로 detail[].order_match 에 함께 남긴다.
비교 키는 좌표까지 포함한다 ("푸드트럭" 같은 동명 이점포를 같은 후보로 세지 않기 위해) —
detail[].top3 에는 발표용으로 읽기 쉬운 "읍/표시업종/상호"만 남긴다.
"""
import io
import json
from contextlib import redirect_stdout
from itertools import product

from common import CAND_WEIGHTS, EUP_WEIGHTS, PROCESSED_DIR
from p6_scoring import stage1_eup_ranking, stage2_candidates

V1_GRID = [0.3, 0.4, 0.5, 0.6, 0.7]
CAND_DENOM = 15                      # 2단계 격자 분모 — 1/15 간격이라 합=1을 유리수로 정확히 만족
CAND_NUMERATORS = range(3, 8)        # 3/15=0.200 ~ 7/15≈0.467 (06 P8 "각 0.2~0.47")
TOP_N = 3


def cand_weight_grid() -> list[dict]:
    """2단계 가중치 격자 — 각 0.2~0.467, 합=1인 조합 전수."""
    return [
        {"w1": n1 / CAND_DENOM, "w2": n2 / CAND_DENOM, "w3": n3 / CAND_DENOM}
        for n1, n2, n3 in product(CAND_NUMERATORS, repeat=3)
        if n1 + n2 + n3 == CAND_DENOM
    ]


def label(c: dict) -> str:
    """발표·로그용 표기."""
    return f"{c['eup']}/{c['category']}/{c['name']}"


def identity(c: dict) -> str:
    """조합 간 비교용 유일 키 — 동명 이점포 구분을 위해 좌표까지 포함한다."""
    return f"{label(c)}@{c['lat']:.6f},{c['lng']:.6f}"


def run_combo(usage: dict, v1: float, cw: dict, memo: dict) -> tuple[list[dict], list[str]]:
    """(v1, cw) 조합으로 P6 재계산 → (candidates, 실제 사용한 읍). 동일 입력은 memo 재사용."""
    ranking = stage1_eup_ranking(usage, {"v1": v1, "v2": round(1 - v1, 10)})
    order = [r["eup"] for r in ranking]
    key = (tuple(order), cw["w1"], cw["w2"], cw["w3"])
    if key not in memo:
        memo[key] = stage2_candidates(order, weights=cw)
    return memo[key]


def verify(out: dict, base_keys: list[str]) -> None:
    """06 P8 검증 — combos 정합 / ratio ∈ [0,1] / 기본 가중치 조합이 격자에 있고 candidates.json 과 일치."""
    detail, grid = out["detail"], cand_weight_grid()
    assert out["combos"] == len(V1_GRID) * len(grid) == len(detail), "combos 불일치"
    assert 0.0 <= out["top3_stable_ratio"] <= 1.0, f"ratio 범위 밖: {out['top3_stable_ratio']}"
    defaults = [d for d in detail if d["is_default"]]
    assert len(defaults) == 1, f"기본 가중치 조합이 격자에 {len(defaults)}개 (1이어야 함)"
    assert defaults[0]["match"] and defaults[0]["order_match"], "기본 가중치 조합이 스스로와 불일치"
    for cw in grid:  # 격자 자체는 합=1이 정확해야 한다 (표기용 반올림 전)
        assert abs(sum(cw.values()) - 1) < 1e-12, f"2단계 격자 합 ≠ 1: {cw}"
    for d in detail:
        w = d["weights"]
        assert abs(w["v1"] + w["v2"] - 1) < 1e-9, f"1단계 가중치 합 ≠ 1: {w}"
        assert abs(w["w1"] + w["w2"] + w["w3"] - 1) < 5e-4, f"2단계 가중치 합 ≠ 1: {w}"  # 4자리 반올림 잔차

    saved = json.loads((PROCESSED_DIR / "candidates.json").read_text(encoding="utf-8"))
    saved_keys = [identity(c) for c in saved[:TOP_N]]
    assert base_keys == saved_keys, f"기본 조합 Top3 {base_keys} ≠ candidates.json 상위 3 {saved_keys}"
    print(f"  검증 OK: combos {out['combos']} / ratio ∈ [0,1] / 기본 조합 Top3 = candidates.json 상위 3")


def main() -> None:
    usage = json.loads((PROCESSED_DIR / "usage_monthly.json").read_text(encoding="utf-8"))
    grid = cand_weight_grid()
    print(f"P8 격자: 1단계 v1 {len(V1_GRID)}개 × 2단계 {len(grid)}개 "
          f"(각 {min(CAND_NUMERATORS) / CAND_DENOM:.3f}~{max(CAND_NUMERATORS) / CAND_DENOM:.3f}, "
          f"간격 {1 / CAND_DENOM:.3f}, 합=1) = {len(V1_GRID) * len(grid)} 조합")

    memo: dict = {}
    detail: list[dict] = []
    with redirect_stdout(io.StringIO()):  # P6 함수의 진행 로그는 조합마다 반복되므로 삼킨다
        base_cands, _ = run_combo(usage, EUP_WEIGHTS["v1"], CAND_WEIGHTS, memo)
        base_keys = [identity(c) for c in base_cands[:TOP_N]]
        base_labels = [label(c) for c in base_cands[:TOP_N]]
        for v1, cw in product(V1_GRID, grid):
            cands, used = run_combo(usage, v1, cw, memo)
            keys = [identity(c) for c in cands[:TOP_N]]
            is_default = (v1 == EUP_WEIGHTS["v1"]
                          and all(abs(cw[k] - CAND_WEIGHTS[k]) < 1e-9 for k in ("w1", "w2", "w3")))
            detail.append({
                "weights": {"v1": v1, "v2": round(1 - v1, 2),
                            **{k: round(cw[k], 4) for k in ("w1", "w2", "w3")}},
                "selected_eups": used,
                "top3": [label(c) for c in cands[:TOP_N]],
                "match": set(keys) == set(base_keys),          # 세 후보가 그대로 Top3 (안정 판정 기준)
                "order_match": keys == base_keys,              # 순위까지 동일 (보조·더 엄격)
                "is_default": is_default,
            })

    matched = sum(1 for d in detail if d["match"])
    out = {
        "combos": len(detail),
        "top3_stable_ratio": round(matched / len(detail), 4),
        "detail": detail,
    }
    path = PROCESSED_DIR / "sensitivity.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    ordered = sum(1 for d in detail if d["order_match"])
    print(f"P8 완료: {path}")
    print(f"  기본 가중치 Top3: {' / '.join(base_labels)}")
    print(f"  Top3 안정 비율 {out['top3_stable_ratio']:.2%} ({matched}/{len(detail)} 조합) "
          f"· 순위까지 동일 {ordered / len(detail):.2%} ({ordered}/{len(detail)}) "
          f"→ 대시보드 ranking_stability = {round(out['top3_stable_ratio'] * 100)}")
    for v1 in V1_GRID:
        rows = [d for d in detail if d["weights"]["v1"] == v1]
        hit = sum(1 for d in rows if d["match"])
        print(f"  v1={v1}: 안정 {hit}/{len(rows)} · 선정 읍 {rows[0]['selected_eups']}")
    unstable = [d for d in detail if not d["match"]]
    if unstable:
        print(f"  [불안정 {len(unstable)}조합] 가중치 → 바뀐 Top3")
        for d in unstable:
            w = d["weights"]
            print(f"    v1={w['v1']} w=({w['w1']:.3f},{w['w2']:.3f},{w['w3']:.3f}): "
                  f"{' / '.join(x for x in d['top3'] if x not in base_labels)} ← "
                  f"{' / '.join(x for x in base_labels if x not in d['top3'])}")
    swapped = [d for d in detail if d["match"] and not d["order_match"]]
    print(f"  [순위만 뒤바뀐 조합] {len(swapped)}개"
          + (f" (예: {swapped[0]['weights']} → {' / '.join(swapped[0]['top3'])})" if swapped else ""))
    verify(out, base_keys)


if __name__ == "__main__":
    main()
