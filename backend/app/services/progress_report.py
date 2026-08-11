"""Pure calculations for observed progress records.

Every numeric result is derived from persisted operator observations. Missing
baselines remain ``None``; this module never substitutes scenario or mock data.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time
from statistics import median

from app.clock import KST


ALL_PROGRESS = (
    "후보 접촉·검토 시작",
    "적격성 확인",
    "가맹 심사",
    "검토중",
    "추진중",
    "보류",
    "완료",
)

METRIC_META = {
    "usage_count": {"delta_unit": "count", "lower_is_better": False, "relative": True},
    "conversion_rate_pct": {"delta_unit": "%p", "lower_is_better": False, "relative": False},
    "active_merchant_count": {"delta_unit": "count", "lower_is_better": False, "relative": True},
    "spend_krw": {"delta_unit": "KRW", "lower_is_better": False, "relative": True},
    "concentration_index": {"delta_unit": "point", "lower_is_better": True, "relative": False},
}


def _dt(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=KST)
    return parsed.astimezone(KST)


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _group_records(records: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        grouped[record["card_id"]].append(record)
    for rows in grouped.values():
        rows.sort(key=lambda row: (
            row["recorded_at"],
            row.get("_sort_key") or row["record_id"],
        ))
    return grouped


def _average_progress_pct(grouped: dict[str, list[dict]]) -> dict:
    values: list[float] = []
    for rows in grouped.values():
        observed = [row.get("progress_pct") for row in rows if row.get("progress_pct") is not None]
        if observed:
            values.append(float(observed[-1]))
    return {
        "value": _round(sum(values) / len(values), 1) if values else None,
        "sample_size": len(values),
    }


def _stale_summary(latest_by_card: dict[str, dict], end: date) -> dict:
    end_at = datetime.combine(end, time.max, tzinfo=KST)
    items: list[dict] = []
    for card_id, record in latest_by_card.items():
        if record.get("progress") == "완료":
            continue
        elapsed = max(0.0, (end_at - _dt(record["recorded_at"])).total_seconds())
        days = int(elapsed // 86400)
        if days < 14:
            continue
        snapshot = record.get("card_snapshot") or {}
        items.append({
            "card_id": card_id,
            "title": snapshot.get("title") or card_id,
            "progress": record.get("progress"),
            "last_recorded_at": record["recorded_at"],
            "days_since_update": days,
        })
    items.sort(key=lambda item: (-item["days_since_update"], item["card_id"]))
    return {"threshold_days": 14, "count": len(items), "items": items}


def _on_time(grouped: dict[str, list[dict]]) -> dict:
    on_time_count = 0
    sample_size = 0
    for rows in grouped.values():
        due: date | None = None
        completed: dict | None = None
        for row in rows:
            if row.get("due_at"):
                try:
                    due = date.fromisoformat(str(row["due_at"]))
                except ValueError:
                    due = None
            if row.get("progress") == "완료":
                completed = row
                break
        if completed is None or due is None:
            continue
        sample_size += 1
        if _dt(completed["recorded_at"]).date() <= due:
            on_time_count += 1
    return {
        "rate": round(on_time_count / sample_size, 4) if sample_size else None,
        "on_time_count": on_time_count,
        "sample_size": sample_size,
    }


def _stage_durations(grouped: dict[str, list[dict]]) -> list[dict]:
    durations: dict[tuple[str, str], list[float]] = defaultdict(list)
    for rows in grouped.values():
        if not rows:
            continue
        entered = rows[0]
        for row in rows[1:]:
            if row.get("progress") == entered.get("progress"):
                continue
            hours = (_dt(row["recorded_at"]) - _dt(entered["recorded_at"])).total_seconds() / 3600
            if hours > 0:
                durations[(entered.get("progress"), row.get("progress"))].append(hours)
            entered = row

    result = []
    for (from_progress, to_progress), values in sorted(durations.items()):
        result.append({
            "from_progress": from_progress,
            "to_progress": to_progress,
            "sample_size": len(values),
            "average_hours": _round(sum(values) / len(values), 2),
            "median_hours": _round(float(median(values)), 2),
        })
    return result


def _metric_value(raw) -> float | None:
    """관측값 1건에서 수치만 꺼낸다 — 저장 형태는 `{value, measured_from, …}` 객체다.

    05 §2 개정으로 `metrics`의 값이 스칼라에서 객체가 됐다. 객체를 그대로 `float()`에 넘기면
    리포트 전체가 500이 되므로 여기서 `value`만 읽는다. 개정 이전에 저장된 기록은 스칼라라
    두 형태를 모두 받는다 — 리포트는 과거 기록까지 거슬러 집계하는 화면이다.
    """
    if isinstance(raw, dict):
        raw = raw.get("value")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _metric_changes(grouped: dict[str, list[dict]]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for metric, meta in METRIC_META.items():
        pairs: list[tuple[float, float]] = []
        for rows in grouped.values():
            observed: list[float] = []
            for row in rows:
                value = _metric_value((row.get("metrics") or {}).get(metric))
                if value is not None:
                    observed.append(value)
            if len(observed) >= 2:
                pairs.append((observed[0], observed[-1]))

        if not pairs:
            result[metric] = {
                "baseline_average": None,
                "latest_average": None,
                "delta": None,
                "delta_unit": meta["delta_unit"],
                "relative_change_pct": None,
                "improvement": None,
                "lower_is_better": meta["lower_is_better"],
                "sample_size": 0,
            }
            continue

        baseline = sum(pair[0] for pair in pairs) / len(pairs)
        latest = sum(pair[1] for pair in pairs) / len(pairs)
        delta = latest - baseline
        relative = None
        if meta["relative"] and baseline != 0:
            relative = delta / abs(baseline) * 100
        improvement = -delta if meta["lower_is_better"] else delta
        result[metric] = {
            "baseline_average": _round(baseline),
            "latest_average": _round(latest),
            "delta": _round(delta),
            "delta_unit": meta["delta_unit"],
            "relative_change_pct": _round(relative),
            "improvement": _round(improvement),
            "lower_is_better": meta["lower_is_better"],
            "sample_size": len(pairs),
        }
    return result


def build_progress_report(
    *,
    approved_cards: list[dict],
    period_records: list[dict],
    latest_by_card: dict[str, dict],
    start: date,
    end: date,
) -> dict:
    """Build an inclusive KST period report from observed records only."""
    grouped = _group_records(period_records)
    status_distribution = {progress: 0 for progress in ALL_PROGRESS}
    for record in latest_by_card.values():
        progress = record.get("progress")
        if progress in status_distribution:
            status_distribution[progress] += 1

    recorded_card_count = len(latest_by_card)
    completed_count = status_distribution["완료"]
    return {
        "period": {
            "from": start.isoformat(),
            "to": end.isoformat(),
            "timezone": "Asia/Seoul",
            "days": (end - start).days + 1,
        },
        "record_count": len(period_records),
        "recorded_card_count": recorded_card_count,
        "cards_without_records": max(0, len(approved_cards) - recorded_card_count),
        "status_distribution": status_distribution,
        "completion": {
            "rate": round(completed_count / recorded_card_count, 4) if recorded_card_count else None,
            "completed_count": completed_count,
            "sample_size": recorded_card_count,
        },
        "average_progress_pct": _average_progress_pct(grouped),
        "stale": _stale_summary(latest_by_card, end),
        "on_time": _on_time(grouped),
        "stage_durations": _stage_durations(grouped),
        "metric_changes": _metric_changes(grouped),
    }
