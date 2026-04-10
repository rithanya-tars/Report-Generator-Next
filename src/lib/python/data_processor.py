"""
data_processor.py
Reads raw CSVs and analyze.json files for a client across all months.
Returns a clean structured dict ready to be sent to Claude.
"""

import json
import os
import csv
from collections import Counter, defaultdict
from pathlib import Path


def get_all_months(client_path: Path) -> list[str]:
    """Return sorted list of YYYY-MM month folders for a client."""
    months = []
    for item in client_path.iterdir():
        if item.is_dir() and len(item.name) == 7 and item.name[4] == "-":
            try:
                year, month = item.name.split("-")
                int(year), int(month)
                months.append(item.name)
            except ValueError:
                continue
    return sorted(months)


def load_analyze(month_path: Path) -> dict:
    """Load the analyze.json file for a month."""
    analyze_file = month_path / "analyze.json"
    if not analyze_file.exists():
        raise FileNotFoundError(
            f"Missing analyze.json in {month_path}\n"
            "Please create it using the template from the README."
        )
    with open(analyze_file, "r") as f:
        return json.load(f)


def load_raw_csv(month_path: Path) -> list[dict]:
    """Load raw_data.csv for a month. Returns list of row dicts."""
    csv_file = month_path / "raw_data.csv"
    if not csv_file.exists():
        return []
    rows = []
    with open(csv_file, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({k.strip(): v.strip() for k, v in row.items()})
    return rows


def analyze_csv(rows: list[dict], client_config: dict = None) -> dict:
    """
    Intelligently analyze CSV rows regardless of column structure.
    Detects gambit columns, device distribution, conversation patterns.
    """
    if not rows:
        return {}

    # Build navigation ignore list (case-insensitive)
    default_nav_values = [
        "Previous Menu", "Previous menu", "Main Menu", "Main menu",
        "-No Input-", "''-No Input-"
    ]
    if client_config and "navigation_values" in client_config:
        nav_values = client_config["navigation_values"]
    else:
        nav_values = default_nav_values
    nav_values_lower = {v.lower() for v in nav_values}

    all_columns = list(rows[0].keys())

    # Standard system columns we know about (lowercase for case-insensitive matching)
    system_cols = {
        "sn", "id", "submitted_on", "visit_url", "referrer_url",
        "user_ip", "user_device", "conversation_duration_ms",
        "prime_response", "partially_filled"
    }

    # Gambit columns = any column not in system cols (case-insensitive)
    gambit_cols = [c for c in all_columns if c.lower() not in system_cols]

    # Device distribution
    device_counts = Counter()
    for row in rows:
        device = row.get("user_device", "Unknown")
        if device:
            device_counts[device] += 1

    def is_navigation(val: str) -> bool:
        """Check if a value is a navigation action to ignore."""
        val_lower = val.lower()
        if val_lower in nav_values_lower:
            return True
        if val_lower.startswith("''-no input-"):
            return True
        return False

    # Gambit value distributions
    gambit_distributions = {}
    for col in gambit_cols:
        counter = Counter()
        for r in rows:
            raw = r.get(col)
            if not raw or raw in ("", "None"):
                continue
            # Split || delimited values, deduplicate within the cell, count each unique option once per row
            parts = set(p.strip() for p in raw.split("||"))
            for part in parts:
                if part and not is_navigation(part):
                    counter[part] += 1
        if counter:
            gambit_distributions[col] = dict(counter.most_common(10))

    # Conversation duration stats
    durations = []
    for row in rows:
        try:
            ms = int(row.get("Conversation_Duration_ms", 0))
            if ms > 0:
                durations.append(ms)
        except (ValueError, TypeError):
            pass

    duration_stats = {}
    if durations:
        duration_stats = {
            "avg_seconds": round(sum(durations) / len(durations) / 1000, 1),
            "min_seconds": round(min(durations) / 1000, 1),
            "max_seconds": round(max(durations) / 1000, 1),
        }

    # First gambit (entry point) analysis
    first_gambit_col = next((c for c in gambit_cols if "first" in c.lower() or "gambit" in c.lower()), None)
    entry_points = {}
    if first_gambit_col:
        vals = [r[first_gambit_col] for r in rows if r.get(first_gambit_col) and r[first_gambit_col] not in ("-No Input-", "")]
        entry_points = dict(Counter(vals).most_common())

    return {
        "total_rows": len(rows),
        "gambit_columns": gambit_cols,
        "device_distribution": dict(device_counts),
        "gambit_distributions": gambit_distributions,
        "duration_stats": duration_stats,
        "entry_points": entry_points,
    }


def load_client_data(data_root: str, client_name: str, target_month: str) -> dict:
    """
    Main function: loads all data for a client up to and including target_month.
    Returns structured dict with current month data + historical context.
    """
    client_path = Path(data_root) / client_name
    if not client_path.exists():
        raise FileNotFoundError(
            f"Client folder '{client_name}' not found in {data_root}\n"
            f"Expected path: {client_path}"
        )

    all_months = get_all_months(client_path)
    if not all_months:
        raise ValueError(f"No month folders found for client '{client_name}'")

    if target_month not in all_months:
        raise ValueError(
            f"Month '{target_month}' not found for client '{client_name}'.\n"
            f"Available months: {', '.join(all_months)}"
        )

    # Client config (optional per-client settings)
    client_config = {}
    config_file = client_path / "client_config.json"
    if config_file.exists():
        with open(config_file, "r") as f:
            client_config = json.load(f)

    # Load all months up to and including target
    months_to_load = [m for m in all_months if m <= target_month]

    monthly_data = []
    for month in months_to_load:
        month_path = client_path / month
        try:
            analyze = load_analyze(month_path)
        except FileNotFoundError as e:
            print(f"  [WARN] Warning: {e}")
            continue

        rows = load_raw_csv(month_path)
        csv_analysis = analyze_csv(rows, client_config)

        monthly_data.append({
            "month": month,
            "analyze": analyze,
            "csv_analysis": csv_analysis,
            "has_raw_data": len(rows) > 0,
        })

    # Assets
    assets_path = client_path / "assets"
    assets = {
        "client_logo": None,
        "tars_logo": None,
    }
    if assets_path.exists():
        for f in assets_path.iterdir():
            if "client" in f.name.lower() and f.suffix.lower() in (".png", ".jpg", ".jpeg"):
                assets["client_logo"] = str(f)
            elif "tars" in f.name.lower() and f.suffix.lower() in (".png", ".jpg", ".jpeg"):
                assets["tars_logo"] = str(f)

    current = next((m for m in monthly_data if m["month"] == target_month), None)
    historical = [m for m in monthly_data if m["month"] != target_month]

    return {
        "client_name": client_name,
        "target_month": target_month,
        "current_month": current,
        "historical_months": historical,
        "all_months_summary": [
            {
                "month": m["month"],
                "period_label": m["analyze"].get("period_label", m["month"]),
                "bot_visits": m["analyze"].get("bot_visits"),
                "conversations": m["analyze"].get("conversations"),
                "goal_completions": m["analyze"].get("goal_completions"),
                "goals_achieved_percent": m["analyze"].get("goals_achieved_percent"),
                "unique_visits": m["analyze"].get("unique_visits"),
                "unique_conversations": m["analyze"].get("unique_conversations"),
                "unique_goal_completions": m["analyze"].get("unique_goal_completions"),
                "unique_goals_achieved_percent": m["analyze"].get("unique_goals_achieved_percent"),
            }
            for m in monthly_data
        ],
        "assets": assets,
        "client_config": client_config,
    }
