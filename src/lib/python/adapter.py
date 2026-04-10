"""
adapter.py
Bridges the web app's Playwright-scraped data to the deterministic Python pipeline.

Reads from a work directory:
  - conversations.csv   (raw conversation rows)
  - con_data.json       (bot structure with gambit varid labels)
  - analytics.json      (10 scraped metrics from fetchAnalytics.ts)

Produces:
  - locked_numbers.json (all numbers pre-calculated, ready for Claude + PPTX)
"""

import sys
import csv
import json
import re
from pathlib import Path

# Sibling imports
from data_processor import analyze_csv
from number_calculator import calculate_all_numbers


def parse_percent_string(value) -> float:
    """Parse a percentage string like '47.06%' or '0.00%' into a float like 47.06."""
    if isinstance(value, (int, float)):
        return float(value)
    if not value or not isinstance(value, str):
        return 0.0
    match = re.search(r"([\d.]+)", value)
    if match:
        return float(match.group(1))
    return 0.0


def parse_int_string(value) -> int:
    """Parse a numeric string like '1,234' or '51' into an int."""
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if not value or not isinstance(value, str):
        return 0
    cleaned = re.sub(r"[^\d]", "", value)
    return int(cleaned) if cleaned else 0


def convert_analytics_to_analyze(analytics: dict) -> dict:
    """Convert the 10-field analytics.json into the analyze.json format
    that number_calculator.calculate_all_numbers expects."""
    return {
        "bot_visits": parse_int_string(analytics.get("bot_visits")),
        "conversations": parse_int_string(analytics.get("conversations")),
        "goal_completions": parse_int_string(analytics.get("goal_completions")),
        "goals_achieved_percent": parse_percent_string(analytics.get("goal_conversion_rate")),
        "unique_visits": parse_int_string(analytics.get("unique_visits")),
        "unique_conversations": parse_int_string(analytics.get("unique_conversations")),
        "unique_goal_completions": parse_int_string(analytics.get("unique_goal_completions")),
        "unique_goals_achieved_percent": parse_percent_string(analytics.get("unique_goal_conversion_rate")),
        "period_label": analytics.get("date_range", ""),
    }


def extract_gambit_columns(con_data: dict) -> list[str]:
    """Extract gambit column names (varid values) from con_data.json.
    The gambits object has keys like '1', '2', etc. Each gambit's 'varid'
    is the column name in the CSV."""
    gambits = con_data.get("gambits", {})
    columns = []
    if isinstance(gambits, dict):
        for key in sorted(gambits.keys(), key=lambda k: int(k) if k.isdigit() else k):
            gambit = gambits[key]
            if isinstance(gambit, dict) and gambit.get("varid"):
                columns.append(gambit["varid"])
    return columns


def extract_client_name(con_data: dict, bot_info: dict) -> str:
    """Extract bot name from bot_info.json (scraped from page), falling back to con_data fields."""
    # Best source: bot name scraped from page heading
    scraped = bot_info.get("bot_name", "")
    if scraped and isinstance(scraped, str) and scraped.strip():
        return scraped.strip()

    # Fallback: try con_data fields (but NOT convid — that's the internal ID like "b_dGzz")
    for field in ("name", "bot_name", "title"):
        val = con_data.get(field)
        if val and isinstance(val, str):
            return val

    # Last resort: look in META gambit data for a name
    gambits = con_data.get("gambits", {})
    if isinstance(gambits, dict):
        for key, gambit in gambits.items():
            if isinstance(gambit, dict) and gambit.get("type") == "META":
                for field in ("name", "title", "label"):
                    val = gambit.get(field)
                    if val and isinstance(val, str):
                        return val

    return "client"


def build_period_label(request_info: dict, analytics: dict) -> str:
    """Build a human-readable period label from request_info or analytics date_range.
    E.g. 'February 2026' or 'Feb 1 - Feb 28, 2026'."""
    from datetime import datetime

    # Try request_info dateRange first (user's explicit selection)
    date_range = request_info.get("dateRange") or {}
    start_str = date_range.get("start", "")
    end_str = date_range.get("end", "")

    if start_str and end_str:
        try:
            start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            # If same month, show "February 2026"
            if start.month == end.month and start.year == end.year:
                return start.strftime("%B %Y")
            # Different months: "Feb 1 - Mar 15, 2026"
            if start.year == end.year:
                return f"{start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}"
            return f"{start.strftime('%b %d, %Y')} - {end.strftime('%b %d, %Y')}"
        except (ValueError, TypeError):
            pass

    # Fallback: use analytics date_range as-is
    analytics_range = analytics.get("date_range", "")
    if analytics_range and analytics_range != "unknown":
        return analytics_range

    return ""


def derive_target_month(analytics: dict, csv_rows: list[dict]) -> str:
    """Derive a YYYY-MM target month from analytics date_range or CSV dates."""
    # Try parsing from date_range (e.g. "Mar 1 - Mar 31, 2026")
    date_range = analytics.get("date_range", "")
    if date_range:
        # Look for year and month patterns
        year_match = re.search(r"20\d{2}", date_range)
        month_names = {
            "jan": "01", "feb": "02", "mar": "03", "apr": "04",
            "may": "05", "jun": "06", "jul": "07", "aug": "08",
            "sep": "09", "oct": "10", "nov": "11", "dec": "12",
        }
        for name, num in month_names.items():
            if name in date_range.lower():
                year = year_match.group(0) if year_match else "2026"
                return f"{year}-{num}"

    # Fallback: look at submitted_on dates in CSV
    for row in csv_rows[:10]:
        submitted = row.get("submitted_on", "")
        if submitted:
            # Try YYYY-MM-DD or DD/MM/YYYY or similar
            ym_match = re.search(r"(\d{4})-(\d{2})", submitted)
            if ym_match:
                return f"{ym_match.group(1)}-{ym_match.group(2)}"

    return "2026-01"


def main():
    if len(sys.argv) < 2:
        print("Usage: python adapter.py <work_directory>")
        sys.exit(1)

    work_dir = Path(sys.argv[1])
    if not work_dir.is_dir():
        print(f"Error: Work directory does not exist: {work_dir}")
        sys.exit(1)

    # ── Read conversations.csv ────────────────────────────────────────────────
    csv_path = work_dir / "conversations.csv"
    if not csv_path.exists():
        print(f"Error: conversations.csv not found in {work_dir}")
        sys.exit(1)

    csv_rows = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            csv_rows.append({k.strip(): v.strip() for k, v in row.items()})
    print(f"  Read {len(csv_rows)} rows from conversations.csv")

    # ── Read con_data.json ────────────────────────────────────────────────────
    con_data_path = work_dir / "con_data.json"
    if not con_data_path.exists():
        print(f"Error: con_data.json not found in {work_dir}")
        sys.exit(1)

    with open(con_data_path, "r", encoding="utf-8") as f:
        con_data = json.load(f)
    print(f"  Read con_data.json")

    # ── Read analytics.json ───────────────────────────────────────────────────
    analytics_path = work_dir / "analytics.json"
    if not analytics_path.exists():
        print(f"Error: analytics.json not found in {work_dir}")
        sys.exit(1)

    with open(analytics_path, "r", encoding="utf-8") as f:
        analytics = json.load(f)
    print(f"  Read analytics.json")

    # ── Read bot_info.json (optional — scraped bot name from page heading) ────
    bot_info_path = work_dir / "bot_info.json"
    bot_info = {}
    if bot_info_path.exists():
        with open(bot_info_path, "r", encoding="utf-8") as f:
            bot_info = json.load(f)
        print(f"  Read bot_info.json: bot_name={bot_info.get('bot_name', '')!r}")

    # ── Read request_info.json (optional — user inputs from frontend) ─────────
    request_info_path = work_dir / "request_info.json"
    request_info = {}
    if request_info_path.exists():
        with open(request_info_path, "r", encoding="utf-8") as f:
            request_info = json.load(f)
        print(f"  Read request_info.json: dateRange={request_info.get('dateRange')}")

    # ── Convert analytics → analyze format ────────────────────────────────────
    analyze = convert_analytics_to_analyze(analytics)

    # Override period_label with user's date range if available
    period_label = build_period_label(request_info, analytics)
    if period_label:
        analyze["period_label"] = period_label
        print(f"  Period label: {period_label}")
    print(f"  Converted analytics to analyze format: "
          f"{analyze['bot_visits']} visits, {analyze['conversations']} conversations")

    # ── Extract gambit columns from con_data ──────────────────────────────────
    gambit_columns = extract_gambit_columns(con_data)
    print(f"  Extracted {len(gambit_columns)} gambit columns from con_data.json")

    # ── Analyze CSV rows ──────────────────────────────────────────────────────
    csv_analysis = analyze_csv(csv_rows)
    print(f"  CSV analysis complete: {csv_analysis.get('total_rows', 0)} rows, "
          f"{len(csv_analysis.get('gambit_distributions', {}))} gambit distributions")

    # Override gambit_columns with the ones from con_data if available
    if gambit_columns:
        csv_analysis["gambit_columns"] = gambit_columns

    # ── Derive metadata ───────────────────────────────────────────────────────
    client_name = extract_client_name(con_data, bot_info)
    target_month = derive_target_month(analytics, csv_rows)
    print(f"  Client: {client_name}, Target month: {target_month}")

    # ── Assemble client_data dict ─────────────────────────────────────────────
    client_data = {
        "client_name": client_name,
        "target_month": target_month,
        "current_month": {
            "month": target_month,
            "analyze": analyze,
            "csv_analysis": csv_analysis,
            "has_raw_data": True,
        },
        "historical_months": [],
        "all_months_summary": [
            {
                "month": target_month,
                "period_label": analyze.get("period_label", target_month),
                "bot_visits": analyze.get("bot_visits"),
                "conversations": analyze.get("conversations"),
                "goal_completions": analyze.get("goal_completions"),
                "goals_achieved_percent": analyze.get("goals_achieved_percent"),
                "unique_visits": analyze.get("unique_visits"),
                "unique_conversations": analyze.get("unique_conversations"),
                "unique_goal_completions": analyze.get("unique_goal_completions"),
                "unique_goals_achieved_percent": analyze.get("unique_goals_achieved_percent"),
            }
        ],
        "assets": {},
        "client_config": {},
    }

    # ── Calculate all numbers ─────────────────────────────────────────────────
    locked_numbers = calculate_all_numbers(client_data)
    print(f"  Calculated locked numbers: {len(locked_numbers)} top-level keys")

    # Debug: show gambit_stats structure
    gambit_stats = locked_numbers.get("gambit_stats", {})
    print("Gambit stats keys:", list(gambit_stats.keys()))
    if gambit_stats:
        first_key = next(iter(gambit_stats))
        first_gambit = gambit_stats[first_key]
        top_options = sorted(
            first_gambit.get("options", {}).items(),
            key=lambda x: -x[1]["count"]
        )[:3]
        print(f"First gambit '{first_key}' top 3 options: {[(name, data['count']) for name, data in top_options]}")

    # ── Write locked_numbers.json ─────────────────────────────────────────────
    output_path = work_dir / "locked_numbers.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(locked_numbers, f, indent=2, ensure_ascii=False)

    print(f"Adapter complete. Locked numbers saved to {output_path}")


if __name__ == "__main__":
    main()
