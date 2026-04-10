#!/usr/bin/env python3
"""
Standalone analysis runner for testing outside the Next.js pipeline.

Usage:
  python scripts/analyze.py /path/to/workdir "Your analysis prompt"

Expects workdir to contain:
  - conversations.csv
  - con_data.json
"""

import sys
import json
import pandas as pd
from pathlib import Path


def build_gambit_map(con_data: dict) -> dict:
    """Extract gambit ID → label mapping from con_data.json."""
    mapping = {}

    if isinstance(con_data.get("gambits"), list):
        for g in con_data["gambits"]:
            gid = g.get("id") or g.get("gambitId", "")
            label = g.get("name") or g.get("label") or g.get("title", gid)
            mapping[gid] = label
    else:
        for key, val in con_data.items():
            if isinstance(val, dict) and any(
                k in val for k in ("name", "label", "title")
            ):
                mapping[key] = val.get("name") or val.get("label") or val.get("title", key)

    return mapping


def run_basic_analysis(workdir: str):
    """Run a default analysis when no custom script is generated."""
    workdir = Path(workdir)

    # Load data
    df = pd.read_csv(workdir / "conversations.csv")
    with open(workdir / "con_data.json") as f:
        con_data = json.load(f)

    gambit_map = build_gambit_map(con_data)

    # Basic metrics
    total_conversations = len(df)
    columns = list(df.columns)

    summary = {
        "total_conversations": total_conversations,
        "columns": columns,
        "gambit_count": len(gambit_map),
    }

    # Try to compute completion rate if relevant columns exist
    if "completed" in df.columns:
        completed = df["completed"].sum()
        summary["completed"] = int(completed)
        summary["completion_rate"] = round(completed / total_conversations * 100, 1) if total_conversations > 0 else 0

    # Chart data: if there's a gambit column, count per gambit
    chart_data = []
    gambit_col = next(
        (c for c in columns if "gambit" in c.lower()), None
    )
    if gambit_col:
        counts = df[gambit_col].value_counts().to_dict()
        chart_data = [
            {
                "gambit_id": gid,
                "label": gambit_map.get(str(gid), str(gid)),
                "count": int(count),
            }
            for gid, count in counts.items()
        ]

    insights = [
        f"Total of {total_conversations} conversations recorded.",
        f"Bot has {len(gambit_map)} configured gambits.",
    ]

    if "completion_rate" in summary:
        insights.append(
            f"Overall completion rate is {summary['completion_rate']}%."
        )

    # Write outputs
    with open(workdir / "analysis_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    with open(workdir / "chart_data.json", "w") as f:
        json.dump(chart_data, f, indent=2)

    with open(workdir / "insights.md", "w") as f:
        for insight in insights:
            f.write(f"- {insight}\n")

    print(f"Analysis complete. {len(insights)} insights generated.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python analyze.py <workdir> [prompt]")
        sys.exit(1)

    run_basic_analysis(sys.argv[1])
