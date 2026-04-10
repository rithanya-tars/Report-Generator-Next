"""
claude_analyst.py
Claude decides slide structure, titles, layout and writes short bullet-point insights.
All numbers are pre-calculated by number_calculator.py and passed via locked_numbers.
Claude must use ONLY the exact numbers provided — never calculate, derive, or modify them.
"""

import json
import os


SYSTEM_PROMPT = """You are an expert business analyst at Tars, a conversational AI platform.
You create monthly Business Review reports for clients showing chatbot performance.

Your job: Analyze the data provided and return a COMPLETE slide plan as JSON.

=== ABSOLUTE RULES ===
1. Use ONLY the exact numbers provided to you. NEVER calculate, derive, estimate, round,
   average, sum, subtract, or modify any numbers. If a number is "572", write "572" — not
   "~570", not "approximately 600", not "nearly 600". Copy numbers exactly as given.
2. Do NOT invent any numbers that are not in the data provided.
3. Do NOT perform any arithmetic on the numbers (no percentages, no differences, no totals).
   If you need a comparison like "increased by X", that number MUST already be in the data.
   Otherwise just say "increased" or "decreased" without inventing a delta.
4. Every insight must be a short bullet point (1 sentence max), not a paragraph.
5. Be honest — if data shows decline, say so with possible reasons.
6. Write in clear business English — clients are non-technical.
7. Return ONLY valid JSON, no markdown, no explanation outside the JSON.

SLIDE TYPES you can use (choose what makes sense for the data):
- "cover": Title slide with client name and period
- "overview_stats": Key metrics in big number cards
- "monthly_trend": Table + bar chart of visits/conversations across months
- "device_breakdown": Mobile vs desktop split
- "gambit_analysis": Detailed breakdown of specific gambit/button options chosen
- "insights_summary": Key takeaways in bullet form
- "next_steps": Recommendations for improvements
- "contact": Get in touch slide

OUTPUT FORMAT (strict JSON):
{
  "report_title": "Business Review - [Client] - [Period]",
  "period_label": "November 2025 to February 2026",
  "slides": [
    {
      "type": "cover",
      "title": "Business Review",
      "subtitle": "November 2025 to February 2026"
    },
    {
      "type": "overview_stats",
      "title": "Performance Overview",
      "period": "January 2026",
      "insights": [
        "Short bullet insight referencing exact numbers",
        "Another short bullet insight"
      ]
    },
    {
      "type": "monthly_trend",
      "title": "Visits & Conversations - Over the Months",
      "insights": [
        "Short bullet about the trend using exact numbers from the table"
      ]
    },
    {
      "type": "device_breakdown",
      "title": "Device Breakdown",
      "insights": [
        "Short bullet about device split using exact numbers"
      ]
    },
    {
      "type": "gambit_analysis",
      "title": "User Selections - [Column Name]",
      "gambit_column": "column_name_here",
      "insights": [
        "Short bullet about what users selected"
      ]
    },
    {
      "type": "insights_summary",
      "title": "Key Insights",
      "insights": [
        "Takeaway 1",
        "Takeaway 2",
        "Takeaway 3",
        "Takeaway 4"
      ]
    },
    {
      "type": "next_steps",
      "title": "Next Steps for Improvements",
      "items": [
        "Specific recommendation 1",
        "Specific recommendation 2",
        "Specific recommendation 3"
      ]
    },
    {
      "type": "contact",
      "email": "team@hellotars.com",
      "website": "www.hellotars.com",
      "social": "@hellotars.ai"
    }
  ]
}
"""


def build_prompt(client_data: dict, locked_numbers: dict, work_dir=None) -> str:
    """
    Build prompt with all verified numbers and multi-month historical data.
    Claude decides structure/titles/layout and writes short bullet insights.
    """
    overview = locked_numbers.get("overview", {})
    device = locked_numbers.get("device_breakdown", {})
    gambits = locked_numbers.get("gambit_stats", {})
    trend = locked_numbers.get("trend", {})
    duration = locked_numbers.get("duration", {})
    gambit_cols = locked_numbers.get("gambit_columns", [])

    # Build explicit gambit counts so Claude cannot recalculate
    gambit_explicit_lines = []
    for col, stats in gambits.items():
        options = stats.get("options", {})
        total = stats.get("total_interactions", 0)
        if not options:
            continue
        gambit_explicit_lines.append(f"\n--- {col} exact counts (total interactions: {total}) ---")
        for i, (opt, d) in enumerate(options.items(), 1):
            gambit_explicit_lines.append(
                f"  {i}. {opt} = {d['count']} total ({d['percent']})"
            )
    gambit_explicit_block = "\n".join(gambit_explicit_lines) if gambit_explicit_lines else "No gambit data available."

    # Include full historical data so Claude can compare months
    historical_months = client_data.get("historical_months", [])
    all_months_summary = client_data.get("all_months_summary", [])

    # Build historical details outside f-string to avoid brace escaping issues
    hist_details = [
        {"month": m.get("month"), "analyze": m.get("analyze", {})}
        for m in historical_months
    ]
    hist_json = json.dumps(hist_details, indent=2)

    # Client config context for Claude
    client_config = client_data.get("client_config", {})
    config_context = ""
    if client_config:
        bot_type = client_config.get("bot_type", "gambit")
        goal_def = client_config.get("goal_definition", "")
        key_columns = client_config.get("key_columns", [])
        context_note = client_config.get("context", "")
        config_lines = [f"BOT TYPE: {bot_type}"]
        if goal_def:
            config_lines.append(f"GOAL DEFINITION: {goal_def}")
        if key_columns:
            config_lines.append(f"KEY COLUMNS TO FOCUS ON: {', '.join(key_columns)}")
        if context_note:
            config_lines.append(f"CLIENT CONTEXT: {context_note}")
        config_context = "\n=== CLIENT CONFIGURATION ===\n" + "\n".join(config_lines) + "\n"

    # Inject client dossier if available
    account_context = ""
    if work_dir:
        from pathlib import Path
        dossier_path = Path(work_dir) / "client_dossier.md"
        if dossier_path.exists():
            with open(dossier_path, "r", encoding="utf-8") as f:
                dossier_content = f.read()
            account_context = (
                f"\n=== ACCOUNT CONTEXT ===\n{dossier_content}\n=== END ACCOUNT CONTEXT ===\n"
            )

    return f"""Analyze this Tars chatbot performance data and create a complete Business Review slide plan.

CLIENT: {client_data['client_name']}
TARGET MONTH: {client_data['target_month']}
{config_context}{account_context}

=== CRITICAL RULE ===
You must use ONLY the exact numbers below. NEVER calculate, derive, round, or modify them.
Copy numbers exactly as they appear. Do NOT compute differences, averages, or percentages yourself.
Write each insight as a short bullet point (1 sentence), not a paragraph.

=== VERIFIED NUMBERS (use these exactly — do not change) ===

OVERVIEW STATS (current month):
- Bot Visits: {overview.get('bot_visits', 0):,}
- Conversations: {overview.get('conversations', 0):,}
- Goal Completions: {overview.get('goal_completions', 0):,}
- Goals Achieved %: {overview.get('goals_achieved_percent', 0)}%
- Unique Visits: {overview.get('unique_visits', 0):,}
- Unique Conversations: {overview.get('unique_conversations', 0):,}
- Unique Goal Completions: {overview.get('unique_goal_completions', 0):,}
- Unique Goals Achieved %: {overview.get('unique_goals_achieved_percent', 0)}%
- Period: {overview.get('period_label', client_data['target_month'])}

MONTHLY TREND (all months — use for comparisons):
{json.dumps(trend.get('months', []), indent=2)}

ALL MONTHS SUMMARY:
{json.dumps(all_months_summary, indent=2)}

DEVICE BREAKDOWN:
{json.dumps(device.get('breakdown', {}), indent=2)}

GAMBIT / BUTTON SELECTIONS (EXACT COUNTS — READ CAREFULLY):
{gambit_explicit_block}

*** WARNING: THE ABOVE ARE THE ONLY NUMBERS YOU MAY USE FOR GAMBIT INSIGHTS. ***
*** Do not count rows. Do not calculate. Do not estimate. Do not use any other counts. ***
*** Copy these numbers EXACTLY into your gambit_analysis insights. ***

CONVERSATION DURATION:
{json.dumps(duration, indent=2)}

=== HISTORICAL MONTH DETAILS ===
{hist_json}

=== YOUR TASK ===
Based on the above data:
1. Decide which slides make sense (don't add slides if data doesn't support them)
2. Choose appropriate titles for each slide
3. Write short bullet-point insights (1 sentence each) referencing exact numbers from above
4. If there are gambit distributions, create gambit_analysis slides for the most interesting columns: {gambit_cols[:3]}
5. If there are multiple months, create a monthly_trend slide comparing them
6. Always include: cover, overview_stats, insights_summary, next_steps, contact
7. The period_label in cover should reflect ALL months in the data, not just current month

Return ONLY the JSON slide plan. No other text."""


def call_claude_api(system: str, user_message: str, api_key: str) -> str:
    """Call the Anthropic Messages API using urllib (no SDK dependency)."""
    import urllib.request

    payload = json.dumps({
        "model": "claude-sonnet-4-6",
        "max_tokens": 8192,
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

    with urllib.request.urlopen(req, timeout=240) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    texts = [
        block["text"]
        for block in data.get("content", [])
        if block.get("type") == "text"
    ]
    text = "\n".join(texts)
    if not text:
        raise ValueError("Empty response from Claude API")
    return text


def get_slide_plan(client_data: dict, locked_numbers: dict, debug: bool = False, work_dir=None) -> dict:
    """
    Call Claude API — Claude decides slide structure, titles, and writes insights.
    Numbers are already locked in locked_numbers dict and will be injected by pptx_generator.
    Claude must use ONLY the exact numbers provided.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY not found!\n"
            "Please set it in your .env file or environment:\n"
            "  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx"
        )

    print("  [BOT] Sending data to Claude for analysis...")

    # Use tars_brain.md as system prompt if available
    system_prompt = SYSTEM_PROMPT
    if work_dir:
        from pathlib import Path
        tars_brain_path = Path(work_dir) / "tars_brain.md"
        if tars_brain_path.exists():
            with open(tars_brain_path, "r", encoding="utf-8") as f:
                system_prompt = f.read()

    prompt = build_prompt(client_data, locked_numbers, work_dir=work_dir)
    response_text = call_claude_api(system_prompt, prompt, api_key).strip()

    if debug:
        with open("debug_claude_raw.txt", "w", encoding="utf-8") as f:
            f.write(response_text)
        print("  [DEBUG] Raw Claude response saved to: debug_claude_raw.txt")

    # Strip markdown code blocks if present
    if "```" in response_text:
        lines = response_text.split("\n")
        cleaned, inside = [], False
        for line in lines:
            if line.strip().startswith("```"):
                inside = not inside
                continue
            cleaned.append(line)
        response_text = "\n".join(cleaned).strip()

    # Extract JSON
    start = response_text.find("{")
    end = response_text.rfind("}") + 1
    if start != -1 and end > start:
        response_text = response_text[start:end]

    try:
        slide_plan = json.loads(response_text)
    except json.JSONDecodeError as e:
        if debug:
            with open("debug_parse_error.txt", "w", encoding="utf-8") as f:
                f.write(response_text)
        raise ValueError(
            f"Claude returned invalid JSON: {e}\n"
            f"Response preview:\n{response_text[:500]}\n"
            "Run with --debug flag to save the full response."
        )

    if debug:
        with open("debug_slide_plan.json", "w", encoding="utf-8") as f:
            json.dump(slide_plan, f, indent=2)
        print("  [DEBUG] Slide plan saved to: debug_slide_plan.json")

    print(f"  [OK] Claude generated {len(slide_plan.get('slides', []))} slides")
    return slide_plan


# ─── CLI ENTRY POINT ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    from pathlib import Path

    if len(sys.argv) < 2:
        print("Usage: python claude_analyst.py <work_directory>")
        sys.exit(1)

    work_dir = Path(sys.argv[1])
    debug = "--debug" in sys.argv

    # Read locked_numbers.json
    locked_path = work_dir / "locked_numbers.json"
    if not locked_path.exists():
        print(f"Error: locked_numbers.json not found in {work_dir}")
        sys.exit(1)
    with open(locked_path, "r", encoding="utf-8") as f:
        locked_numbers = json.load(f)

    # Build a minimal client_data from locked_numbers
    client_data = {
        "client_name": locked_numbers.get("client_name", "client"),
        "target_month": locked_numbers.get("target_month", ""),
        "historical_months": [],
        "all_months_summary": [{
            "month": locked_numbers.get("target_month", ""),
            "period_label": locked_numbers.get("overview", {}).get("period_label", ""),
            "bot_visits": locked_numbers.get("overview", {}).get("bot_visits"),
            "conversations": locked_numbers.get("overview", {}).get("conversations"),
            "goal_completions": locked_numbers.get("overview", {}).get("goal_completions"),
            "goals_achieved_percent": locked_numbers.get("overview", {}).get("goals_achieved_percent"),
            "unique_visits": locked_numbers.get("overview", {}).get("unique_visits"),
            "unique_conversations": locked_numbers.get("overview", {}).get("unique_conversations"),
            "unique_goal_completions": locked_numbers.get("overview", {}).get("unique_goal_completions"),
            "unique_goals_achieved_percent": locked_numbers.get("overview", {}).get("unique_goals_achieved_percent"),
        }],
        "client_config": {},
    }

    # Also read deck_input.json if available (for prompt context)
    deck_input_path = work_dir / "deck_input.json"
    if deck_input_path.exists():
        with open(deck_input_path, "r", encoding="utf-8") as f:
            deck_input = json.load(f)
        # Merge any extra locked_numbers from deck_input
        if "locked_numbers" in deck_input:
            locked_numbers.update(deck_input["locked_numbers"])

    slide_plan = get_slide_plan(client_data, locked_numbers, debug=debug, work_dir=str(work_dir))

    # Write slide_plan.json
    output_path = work_dir / "slide_plan.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(slide_plan, f, indent=2, ensure_ascii=False)
    print(f"  Slide plan saved to {output_path}")
