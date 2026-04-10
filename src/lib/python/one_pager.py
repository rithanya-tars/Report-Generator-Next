"""
one_pager.py
Generates a single-page HTML report and converts to PDF.
Reads locked_numbers.json, calls Claude for 3 insight sentences,
fills an HTML template, and saves report.html + report.pdf.
"""

import sys
import json
import os
import urllib.request
from pathlib import Path


def call_claude_api(system: str, user_message: str, api_key: str) -> str:
    """Call the Anthropic Messages API using urllib (no SDK dependency)."""
    payload = json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": 1024,
        "system": system,
        "messages": [{"role": "user", "content": user_message}],
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    texts = [
        block["text"]
        for block in data.get("content", [])
        if block.get("type") == "text"
    ]
    return "\n".join(texts).strip()


def get_insights(locked_numbers: dict, api_key: str, work_dir: Path) -> list[str]:
    """Ask Claude for exactly 3 short insight bullets from the locked numbers."""
    overview = locked_numbers.get("overview", {})
    device = locked_numbers.get("device_breakdown", {})
    gambits = locked_numbers.get("gambit_stats", {})

    # Use tars_brain.md as system prompt if available, otherwise default
    tars_brain_path = work_dir / "tars_brain.md"
    if tars_brain_path.exists():
        with open(tars_brain_path, "r", encoding="utf-8") as f:
            system = f.read()
    else:
        system = (
            "You are a business analyst. Given chatbot performance data, "
            "write exactly 3 short insight bullet points (1 sentence each, max 15 words). "
            "Use ONLY the exact numbers provided. Never calculate or derive new numbers. "
            "Return only the 3 bullets, one per line, no numbering."
        )

    # Inject client dossier if available
    account_context = ""
    dossier_path = work_dir / "client_dossier.md"
    if dossier_path.exists():
        with open(dossier_path, "r", encoding="utf-8") as f:
            dossier_content = f.read()
        account_context = (
            f"=== ACCOUNT CONTEXT ===\n{dossier_content}\n=== END ACCOUNT CONTEXT ===\n\n"
        )

    user_msg = f"""{account_context}=== PERFORMANCE DATA (use ONLY these exact numbers) ===
- Bot Visits: {overview.get('bot_visits', 0):,}
- Conversations: {overview.get('conversations', 0):,}
- Goal Completions: {overview.get('goal_completions', 0):,}
- Goals Achieved: {overview.get('goals_achieved_percent', 0)}%
- Unique Visits: {overview.get('unique_visits', 0):,}
- Unique Conversations: {overview.get('unique_conversations', 0):,}

Device breakdown: {json.dumps(device.get('breakdown', {}), indent=2)}

Top gambit stats: {json.dumps({k: v.get('total_interactions', 0) for k, v in list(gambits.items())[:3]}, indent=2)}

Write 3 short insight bullets."""

    print("  Asking Claude for insights...")
    response = call_claude_api(system, user_msg, api_key)
    lines = [
        line.strip().lstrip("•-*123456789. )")
        for line in response.strip().split("\n")
        if line.strip()
    ]
    # Ensure exactly 3
    while len(lines) < 3:
        lines.append("Data analysis in progress.")
    return lines[:3]


def fmt(n) -> str:
    """Format number with commas."""
    try:
        return f"{int(n):,}"
    except (ValueError, TypeError):
        return str(n)


def build_gambit_html(locked_numbers: dict) -> str:
    """Build the gambit bar items HTML."""
    gambits = locked_numbers.get("gambit_stats", {})
    if not gambits:
        return '<div style="color: #999; font-size: 12px;">No gambit data available.</div>'

    # Pick the gambit column with the most interactions
    first_col = max(gambits.values(), key=lambda g: g.get("total_interactions", 0))
    options = first_col.get("options", {})
    if not options:
        return '<div style="color: #999; font-size: 12px;">No selection data available.</div>'

    max_count = max((o["count"] for o in options.values()), default=1)
    items_html = []
    for name, data in list(options.items())[:8]:  # Top 8
        pct = round((data["count"] / max_count) * 100) if max_count else 0
        items_html.append(
            f'<div class="gambit-item">'
            f'  <div class="gambit-name" title="{name}">{name}</div>'
            f'  <div class="gambit-bar-wrap"><div class="gambit-bar" style="width: {pct}%;"></div></div>'
            f'  <div class="gambit-count">{fmt(data["count"])}</div>'
            f'</div>'
        )
    return "\n".join(items_html)


def build_trend_html(locked_numbers: dict) -> str:
    """Build the monthly trend table HTML, or empty string if single month."""
    trend = locked_numbers.get("trend", {})
    months = trend.get("months", [])
    if len(months) <= 1:
        return ""

    rows_html = []
    for m in months:
        rows_html.append(
            f'<tr>'
            f'  <td>{m["month_label"]}</td>'
            f'  <td>{fmt(m["bot_visits"])}</td>'
            f'  <td>{fmt(m["conversations"])}</td>'
            f'  <td>{fmt(m["goal_completions"])}</td>'
            f'  <td>{m["goals_achieved_percent"]}%</td>'
            f'</tr>'
        )

    return f'''
    <div class="section-title" style="margin-top: 4px;">Monthly Trend</div>
    <table class="trend-table">
      <tr>
        <th>Month</th><th>Bot Visits</th><th>Conversations</th><th>Goals</th><th>Goals %</th>
      </tr>
      {"".join(rows_html)}
    </table>
    '''


def build_device_pcts(locked_numbers: dict) -> tuple[str, str]:
    """Return (mobile_pct, desktop_pct) as strings."""
    device = locked_numbers.get("device_breakdown", {})
    breakdown = device.get("breakdown", {})
    total = device.get("total", 0)
    if not total:
        return ("50", "50")

    mobile_count = breakdown.get("Mobile", {}).get("count", 0)
    desktop_count = breakdown.get("Desktop", {}).get("count", 0)
    other = total - mobile_count - desktop_count

    # Merge other into desktop for display
    desktop_count += other
    mobile_pct = round((mobile_count / total) * 100) if total else 50
    desktop_pct = 100 - mobile_pct
    return (str(mobile_pct), str(desktop_pct))


def main():
    if len(sys.argv) < 2:
        print("Usage: python one_pager.py <work_directory>")
        sys.exit(1)

    work_dir = Path(sys.argv[1])

    # ── Read inputs ───────────────────────────────────────────────────────────
    locked_path = work_dir / "locked_numbers.json"
    if not locked_path.exists():
        print(f"Error: locked_numbers.json not found in {work_dir}")
        sys.exit(1)
    with open(locked_path, "r", encoding="utf-8") as f:
        locked_numbers = json.load(f)

    deck_input_path = work_dir / "deck_input.json"
    deck_input = {}
    if deck_input_path.exists():
        with open(deck_input_path, "r", encoding="utf-8") as f:
            deck_input = json.load(f)

    # ── Get Claude insights ───────────────────────────────────────────────────
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if api_key:
        insights = get_insights(locked_numbers, api_key, work_dir)
    else:
        print("  Warning: ANTHROPIC_API_KEY not set, using placeholder insights")
        insights = [
            "Bot performance data has been compiled.",
            "Review the metrics above for details.",
            "Contact TARS for optimization recommendations.",
        ]

    # ── Read HTML template ────────────────────────────────────────────────────
    template_path = Path(__file__).parent / "one_pager_template.html"
    if not template_path.exists():
        print(f"Error: Template not found at {template_path}")
        sys.exit(1)
    with open(template_path, "r", encoding="utf-8") as f:
        html = f.read()

    # ── Fill placeholders ─────────────────────────────────────────────────────
    overview = locked_numbers.get("overview", {})
    mobile_pct, desktop_pct = build_device_pcts(locked_numbers)

    # Calculate interaction rate from overview
    bot_visits = overview.get("bot_visits", 0)
    conversations = overview.get("conversations", 0)
    if bot_visits and conversations:
        interaction_rate = f"{round((conversations / bot_visits) * 100, 1)}%"
    else:
        interaction_rate = "0%"

    replacements = {
        "{{client_name}}": locked_numbers.get("client_name", "Client"),
        "{{period}}": overview.get("period_label", locked_numbers.get("target_month", "")),
        "{{bot_visits}}": fmt(overview.get("bot_visits", 0)),
        "{{conversations}}": fmt(overview.get("conversations", 0)),
        "{{interaction_rate}}": interaction_rate,
        "{{gambit_items}}": build_gambit_html(locked_numbers),
        "{{insight_1}}": insights[0],
        "{{insight_2}}": insights[1],
        "{{insight_3}}": insights[2],
        "{{mobile_pct}}": mobile_pct,
        "{{desktop_pct}}": desktop_pct,
        "{{trend_section}}": build_trend_html(locked_numbers),
    }

    for placeholder, value in replacements.items():
        html = html.replace(placeholder, str(value))

    # ── Save HTML ─────────────────────────────────────────────────────────────
    html_path = work_dir / "report.html"
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"  Saved report.html to {html_path}")

    # ── Try PDF conversion with pdfkit ────────────────────────────────────────
    try:
        import pdfkit
        pdf_path = str(work_dir / "report.pdf")
        pdfkit.from_file(str(html_path), pdf_path, options={
            "page-width": "280mm",
            "page-height": "160mm",
            "margin-top": "0",
            "margin-right": "0",
            "margin-bottom": "0",
            "margin-left": "0",
            "encoding": "UTF-8",
            "no-outline": None,
        })
        print(f"  Saved report.pdf to {pdf_path}")
    except Exception as e:
        print(f"  PDF conversion skipped ({e}) — HTML saved, Playwright will convert")

    print("One-pager generation complete.")


if __name__ == "__main__":
    main()
