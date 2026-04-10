"""
number_calculator.py
Calculates ALL numbers directly from raw CSV and analyze.json.
Numbers never go through Claude — 100% accurate, no hallucination possible.
Claude only receives a summary and is asked to write insights/text only.

Works dynamically for any client:
- Any number of rows
- Any gambit column names
- Any device types
"""

from collections import Counter
from pathlib import Path


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def safe_pct(part, total) -> str:
    """Return percentage string like '31%' or '0%' safely."""
    if not total:
        return "0%"
    return f"{round((part / total) * 100)}%"


def fmt(n) -> str:
    """Format number with commas: 1234 → '1,234'"""
    try:
        return f"{int(n):,}"
    except (ValueError, TypeError):
        return str(n)


def is_no_input(val: str) -> bool:
    """Check if a cell value means the user didn't interact."""
    if not val:
        return True
    v = val.strip().lower()
    return v in ("-no input-", "no input", "", "none", "-")


# ─── CORE CALCULATIONS ────────────────────────────────────────────────────────

def calculate_overview_stats(analyze: dict, csv_rows: list) -> dict:
    """
    Lock the top-level KPI numbers.
    Source: analyze.json (filled from Tars admin Analyze section)
    These are the headline numbers shown in big stat cards.
    """
    return {
        "bot_visits":                   analyze.get("bot_visits", 0),
        "conversations":                analyze.get("conversations", 0),
        "goal_completions":             analyze.get("goal_completions", 0),
        "goals_achieved_percent":       analyze.get("goals_achieved_percent", 0),
        "unique_visits":                analyze.get("unique_visits", 0),
        "unique_conversations":         analyze.get("unique_conversations", 0),
        "unique_goal_completions":      analyze.get("unique_goal_completions", 0),
        "unique_goals_achieved_percent": analyze.get("unique_goals_achieved_percent", 0),
        "period_label":                 analyze.get("period_label", ""),
    }


def calculate_device_breakdown(csv_rows: list) -> dict:
    """
    Calculate device split directly from CSV user_device column.
    Works for any device types — doesn't hardcode Desktop/Mobile.
    """
    if not csv_rows:
        return {}

    counts = Counter()
    for row in csv_rows:
        device = row.get("user_device", "").strip()
        if device and not is_no_input(device):
            # Normalize: "Mobile (Android)" and "Mobile (iPhone)" → "Mobile"
            if device.lower().startswith("mobile"):
                device = "Mobile"
            counts[device] += 1

    total = sum(counts.values())
    if not total:
        return {}

    return {
        "total": total,
        "breakdown": {
            device: {
                "count": count,
                "percent": safe_pct(count, total)
            }
            for device, count in counts.most_common()
        }
    }


def calculate_gambit_stats(csv_rows: list, gambit_col: str) -> dict:
    """
    Count how many times each option was chosen in a gambit column.
    Handles pipe-separated values like 'Option A || Option B'.
    Works for any column name, any option names.
    """
    if not csv_rows:
        return {}

    counts = Counter()
    total_interactions = 0

    for row in csv_rows:
        val = row.get(gambit_col, "").strip()
        if is_no_input(val):
            continue

        # Handle pipe-separated multiple selections
        options = [v.strip() for v in val.split("||")]
        for opt in options:
            if opt and not is_no_input(opt):
                counts[opt] += 1
                total_interactions += 1

    if not counts:
        return {}

    return {
        "column": gambit_col,
        "total_interactions": total_interactions,
        "options": {
            opt: {
                "count": count,
                "percent": safe_pct(count, total_interactions)
            }
            for opt, count in counts.most_common()
        }
    }


def calculate_all_gambits(csv_rows: list, gambit_cols: list) -> dict:
    """
    Calculate stats for all gambit columns.
    Only includes columns that have meaningful data.
    """
    results = {}
    for col in gambit_cols:
        stats = calculate_gambit_stats(csv_rows, col)
        if stats:
            results[col] = stats
    return results


def calculate_monthly_trend(all_months_data: list) -> dict:
    """
    Build the month-by-month comparison table.
    All numbers come from analyze.json — no Claude involved.
    """
    rows = []
    for m in all_months_data:
        analyze = m.get("analyze", {})
        label = analyze.get("period_label", m["month"])
        # Shorten label for table: "January 2026" → "Jan'26"
        short = m["month"]
        try:
            from datetime import datetime
            dt = datetime.strptime(m["month"], "%Y-%m")
            short = dt.strftime("%b'%y")
        except Exception:
            pass

        rows.append({
            "month_label":                  short,
            "bot_visits":                   analyze.get("bot_visits", 0),
            "conversations":                analyze.get("conversations", 0),
            "goal_completions":             analyze.get("goal_completions", 0),
            "goals_achieved_percent":       analyze.get("goals_achieved_percent", 0),
            "unique_visits":                analyze.get("unique_visits", 0),
            "unique_conversations":         analyze.get("unique_conversations", 0),
            "unique_goal_completions":      analyze.get("unique_goal_completions", 0),
            "unique_goals_achieved_percent": analyze.get("unique_goals_achieved_percent", 0),
        })

    return {"months": rows}


def calculate_duration_stats(csv_rows: list) -> dict:
    """Calculate average conversation duration from CSV."""
    durations = []
    for row in csv_rows:
        try:
            ms = int(row.get("Conversation_Duration_ms", 0) or
                     row.get("Duration (ms)", 0) or 0)
            if ms > 0:
                durations.append(ms)
        except (ValueError, TypeError):
            pass

    if not durations:
        return {}

    avg_sec = round(sum(durations) / len(durations) / 1000, 1)
    return {
        "avg_seconds": avg_sec,
        "avg_formatted": f"{int(avg_sec // 60)}m {int(avg_sec % 60)}s" if avg_sec >= 60 else f"{avg_sec}s",
        "sample_size": len(durations)
    }


# ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

def calculate_goal_completions_from_csv(csv_rows: list, client_config: dict) -> int:
    """
    Detect goal completions from CSV using goal_detection keywords.
    Scans the configured column AND any column whose name contains
    'Prime Response' (case-insensitive). A row counts as a match if
    any keyword is found in any of the scanned columns.
    """
    goal_detection = client_config.get("goal_detection", {})
    column = goal_detection.get("column", "")
    keywords = goal_detection.get("keywords", [])

    if not column or not keywords:
        return 0

    keywords_lower = [kw.lower() for kw in keywords]

    # Build set of columns to scan: configured column + any "Prime Response" columns
    scan_columns = set()
    scan_columns.add(column)
    if csv_rows:
        for col_name in csv_rows[0].keys():
            if "prime response" in col_name.lower():
                scan_columns.add(col_name)

    count = 0
    for row in csv_rows:
        for col in scan_columns:
            val = row.get(col, "").strip().lower()
            if any(kw in val for kw in keywords_lower):
                count += 1
                break  # count each row at most once
    return count


def calculate_all_numbers(client_data: dict) -> dict:
    """
    Master function — calculates ALL numbers for the report.
    Returns a locked_numbers dict that is passed directly to PPTX generator.
    Claude never sees or touches these numbers.

    Args:
        client_data: output from data_processor.load_client_data()

    Returns:
        locked_numbers: dict with all pre-calculated, verified numbers
    """
    current = client_data.get("current_month", {})
    all_months = client_data.get("all_months_summary", [])
    all_months_full = [client_data["current_month"]] + client_data.get("historical_months", [])
    all_months_full = sorted(
        [m for m in all_months_full if m],
        key=lambda x: x["month"]
    )

    client_config = client_data.get("client_config", {})

    analyze = current.get("analyze", {}) if current else {}
    csv_rows = []

    # Reconstruct csv rows from csv_analysis if available
    # (actual rows are loaded fresh below)
    csv_analysis = current.get("csv_analysis", {}) if current else {}
    gambit_cols = csv_analysis.get("gambit_columns", [])

    # ── Overview stats (from analyze.json) ────────────────────────────────────
    overview = calculate_overview_stats(analyze, csv_rows)

    # ── Smart goal detection ─────────────────────────────────────────────────
    # If dashboard tracks goals (goal_completions > 0), trust dashboard.
    # If not, fall back to keyword detection from CSV when goal_detection
    # is configured in client_config.
    dashboard_goals = analyze.get("goal_completions", 0)
    goal_detection_cfg = client_config.get("goal_detection", {})
    has_goal_detection = (
        goal_detection_cfg.get("column") and goal_detection_cfg.get("keywords")
    )

    if dashboard_goals and dashboard_goals > 0:
        # Dashboard has real goal data — use it as-is
        print(f"[OK] Using {dashboard_goals} goal completions from Tars dashboard")
    elif has_goal_detection:
        # Dashboard shows 0 — attempt keyword detection from CSV
        from pathlib import Path as _Path
        import csv as _csv_mod
        data_root_path = _Path(client_data.get("_data_root", "sample_data"))
        month_csv_path = (
            data_root_path / client_data["client_name"]
            / client_data["target_month"] / "raw_data.csv"
        )
        if month_csv_path.exists():
            with open(month_csv_path, "r", encoding="utf-8-sig") as f:
                reader = _csv_mod.DictReader(f)
                raw_rows = [
                    {k.strip(): v.strip() for k, v in row.items()}
                    for row in reader
                ]
            csv_goal_count = calculate_goal_completions_from_csv(
                raw_rows, client_config
            )
            if csv_goal_count > 0:
                overview["goal_completions"] = csv_goal_count
                conversations = overview.get("conversations", 0)
                if conversations:
                    overview["goals_achieved_percent"] = round(
                        (csv_goal_count / conversations) * 100, 1
                    )
                print(
                    f"[INFO] Goals not tracked in Tars dashboard"
                    f" — detected {csv_goal_count} completions"
                    f" via keyword detection"
                )

    # ── Monthly trend (from all analyze.json files) ────────────────────────────
    trend = calculate_monthly_trend(all_months_full)

    # ── Device breakdown (from CSV) ────────────────────────────────────────────
    device_raw = csv_analysis.get("device_distribution", {})
    total_devices = sum(device_raw.values()) if device_raw else 0

    # Normalize mobile variants
    normalized_devices = Counter()
    for device, count in device_raw.items():
        key = "Mobile" if device.lower().startswith("mobile") else device
        normalized_devices[key] += count

    device_breakdown = {
        "total": total_devices,
        "breakdown": {
            d: {
                "count": c,
                "percent": safe_pct(c, total_devices)
            }
            for d, c in normalized_devices.most_common()
        }
    } if normalized_devices else {}

    # ── Gambit stats (from CSV) ────────────────────────────────────────────────
    gambit_stats = {}
    for col, dist in csv_analysis.get("gambit_distributions", {}).items():
        total = sum(dist.values())
        gambit_stats[col] = {
            "column": col,
            "total_interactions": total,
            "options": {
                opt: {
                    "count": count,
                    "percent": safe_pct(count, total)
                }
                for opt, count in sorted(dist.items(), key=lambda x: -x[1])
            }
        }

    # ── Duration stats ─────────────────────────────────────────────────────────
    duration = csv_analysis.get("duration_stats", {})
    if duration:
        avg_sec = duration.get("avg_seconds", 0)
        duration["avg_formatted"] = (
            f"{int(avg_sec // 60)}m {int(avg_sec % 60)}s"
            if avg_sec >= 60 else f"{avg_sec}s"
        )

    # ── Formatted overview for slide cards ────────────────────────────────────
    formatted_stats = [
        {
            "label": "Bot Visits",
            "value": fmt(overview["bot_visits"]),
            "raw": overview["bot_visits"]
        },
        {
            "label": "Conversations",
            "value": fmt(overview["conversations"]),
            "raw": overview["conversations"]
        },
        {
            "label": "Goal Completions",
            "value": fmt(overview["goal_completions"]),
            "raw": overview["goal_completions"],
            "note": f"{overview['goals_achieved_percent']}% rate"
        },
        {
            "label": "Unique Visits",
            "value": fmt(overview["unique_visits"]),
            "raw": overview["unique_visits"]
        },
    ]

    # ── Formatted trend table for slides ──────────────────────────────────────
    trend_headers = [
        "Month", "Bot Visits", "Conversations", "Goals",
        "Goals %", "Unique Visits", "Unique Convos",
        "Unique Goals", "Unique Goals %"
    ]
    trend_rows = [
        [
            m["month_label"],
            fmt(m["bot_visits"]),
            fmt(m["conversations"]),
            fmt(m["goal_completions"]),
            f"{m['goals_achieved_percent']}%",
            fmt(m["unique_visits"]),
            fmt(m["unique_conversations"]),
            fmt(m["unique_goal_completions"]),
            f"{m['unique_goals_achieved_percent']}%",
        ]
        for m in trend["months"]
    ]

    # Chart data for trend slide
    chart_data = {
        "labels": [m["month_label"] for m in trend["months"]],
        "bot_visits": [m["bot_visits"] for m in trend["months"]],
        "conversations": [m["conversations"] for m in trend["months"]],
    }

    return {
        # Raw calculated numbers
        "overview":         overview,
        "device_breakdown": device_breakdown,
        "gambit_stats":     gambit_stats,
        "duration":         duration,
        "trend":            trend,

        # Pre-formatted for slides (ready to drop straight into PPTX)
        "formatted": {
            "stat_cards":    formatted_stats,
            "trend_headers": trend_headers,
            "trend_rows":    trend_rows,
            "chart_data":    chart_data,
            "period_label":  overview.get("period_label", ""),
        },

        # Metadata
        "client_name":   client_data["client_name"],
        "target_month":  client_data["target_month"],
        "gambit_columns": gambit_cols,
    }
