import { Browser } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { extractBotId } from "./fetchConversations";
import { handleSuperAdminGate } from "./helpers";

const METRIC_LABELS = [
  "Unique Bot Visits",
  "Bot Conversations",
  "Bot Goal Completions",
  "Bot Interaction Rate",
  "Goal Conversion Rate",
] as const;

interface AnalyticsOutput {
  bot_visits: string;
  conversations: string;
  goal_completions: string;
  interaction_rate: string;
  goal_conversion_rate: string;
  unique_visits: string;
  unique_conversations: string;
  unique_goal_completions: string;
  unique_interaction_rate: string;
  unique_goal_conversion_rate: string;
  date_range: string;
}

/**
 * Scrapes analytics data from the Tars 1.0 analyze page.
 *
 * Flow:
 *   1. Navigate to admin.hellotars.com/conv/{botId}/#/data/analyze
 *   2. Scrape the 5 overview metric cards
 *   3. Fallback: regex-extract from body text if card scraping fails
 *   4. Always take a screenshot for reference
 *   5. Save structured data as analytics.json
 */
export async function fetchAnalytics(
  browser: Browser,
  chatbotUrl: string,
  workDir: string,
  dateRange: { start: string; end: string } | null = null
): Promise<string> {
  const page = (await browser.contexts())[0]?.pages()[0];
  if (!page) throw new Error("No active page in browser context");

  const botId = extractBotId(chatbotUrl);

  await page.goto(
    `https://admin.hellotars.com/conv/${botId}/#/data/analyze`,
    { timeout: 60000 }
  );
  await handleSuperAdminGate(page, `https://admin.hellotars.com/conv/${botId}/#/data/analyze`);
  // SPA hash routing — wait for charts/widgets to render
  await page.waitForTimeout(5000);

  // ── Apply date range to match the CSV export ──
  // Analytics page uses Bootstrap DateRangePicker (daterangepicker.js) with
  // container div#reportrange. We set the range programmatically via the
  // jQuery plugin API, falling back to UI clicks if jQuery isn't available.
  if (dateRange) {
    console.log(`[fetchAnalytics] Applying date range: ${dateRange.start} – ${dateRange.end}`);
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    // Format as MM/DD/YYYY for daterangepicker
    const pad = (n: number) => String(n).padStart(2, "0");
    const startStr = `${pad(start.getMonth() + 1)}/${pad(start.getDate())}/${start.getFullYear()}`;
    const endStr = `${pad(end.getMonth() + 1)}/${pad(end.getDate())}/${end.getFullYear()}`;

    // Click div#reportrange to open the picker
    try {
      await page.click("div#reportrange", { timeout: 10000 });
      console.log("[fetchAnalytics] Opened #reportrange date picker");
    } catch {
      console.log("[fetchAnalytics] Warning: could not click #reportrange");
    }
    await page.waitForTimeout(1000);

    // Try programmatic approach first (jQuery daterangepicker API)
    const programmaticSuccess = await page.evaluate(
      ({ startDate, endDate }: { startDate: string; endDate: string }) => {
        const el = document.getElementById("reportrange");
        const jq = (window as unknown as Record<string, unknown>).$ as
          | ((sel: unknown) => { data: (key: string) => Record<string, unknown> | undefined; trigger: (evt: string, data: unknown) => void })
          | undefined;
        if (el && jq && typeof jq === "function") {
          const $el = jq(el);
          const picker = $el.data("daterangepicker") as
            | { setStartDate: (d: string) => void; setEndDate: (d: string) => void }
            | undefined;
          if (picker) {
            picker.setStartDate(startDate);
            picker.setEndDate(endDate);
            $el.trigger("apply.daterangepicker", picker);
            return true;
          }
        }
        return false;
      },
      { startDate: startStr, endDate: endStr }
    );

    if (programmaticSuccess) {
      console.log("[fetchAnalytics] Date range set programmatically via daterangepicker API");
    } else {
      console.log("[fetchAnalytics] Programmatic approach unavailable, falling back to UI clicks");

      // Check if this range matches "Last Month" — use preset if so
      const now = new Date();
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      const isLastMonth =
        start.getFullYear() === lastMonthDate.getFullYear() &&
        start.getMonth() === lastMonthDate.getMonth() &&
        start.getDate() === 1 &&
        end.getFullYear() === lastMonthEnd.getFullYear() &&
        end.getMonth() === lastMonthEnd.getMonth() &&
        end.getDate() === lastMonthEnd.getDate();

      if (isLastMonth) {
        console.log('[fetchAnalytics] Using "Last Month" preset');
        await page.click('text="Last Month"', { timeout: 5000 });
        await page.waitForTimeout(500);
      } else {
        // Click "Custom Range" to open calendar view
        try {
          await page.click('text="Custom Range"', { timeout: 5000 });
          await page.waitForTimeout(500);
        } catch {
          console.log("[fetchAnalytics] Could not click Custom Range preset");
        }

        // Navigate left calendar to start month and click start day
        const targetStartLabel = `${start.toLocaleString("en-US", { month: "long" })} ${start.getFullYear()}`;
        for (let i = 0; i < 24; i++) {
          const displayed = await page.locator(".daterangepicker .left .month").first().innerText().catch(() => "");
          if (displayed.includes(targetStartLabel)) break;
          await page.click(".daterangepicker .left .prev", { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
        // Click start date cell
        await page
          .locator(`.daterangepicker .left td.available:text-is("${start.getDate()}")`)
          .first()
          .click({ timeout: 5000 });
        await page.waitForTimeout(500);

        // Navigate right calendar to end month and click end day
        const targetEndLabel = `${end.toLocaleString("en-US", { month: "long" })} ${end.getFullYear()}`;
        for (let i = 0; i < 24; i++) {
          const displayed = await page.locator(".daterangepicker .right .month").first().innerText().catch(() => "");
          if (displayed.includes(targetEndLabel)) break;
          await page.click(".daterangepicker .right .next", { timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }
        // Click end date cell
        await page
          .locator(`.daterangepicker .right td.available:text-is("${end.getDate()}")`)
          .first()
          .click({ timeout: 5000 });
        await page.waitForTimeout(500);

        // Click Apply
        await page.click('.daterangepicker button.applyBtn, .daterangepicker button:has-text("Apply")', { timeout: 5000 });
      }
    }

    // Wait for metrics to update after date range change
    await page.waitForTimeout(3000);

    // Verify the date range was applied
    const spanText = await page.locator("div#reportrange span").innerText().catch(() => "");
    if (spanText) {
      console.log(`[fetchAnalytics] Date picker now shows: ${spanText}`);
    }
    console.log("[fetchAnalytics] Date range applied — waiting for data to refresh");
  }

  // Always take a screenshot for reference
  const screenshotPath = path.join(workDir, "analytics_screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[fetchAnalytics] Screenshot saved to ${screenshotPath}`);

  // Try to grab the date range displayed on the page
  const displayedDateRange = await page
    .evaluate(() => {
      const el = document.querySelector(
        '[class*="date-range"], [class*="dateRange"], [class*="period"], [class*="date_range"]'
      );
      return el?.textContent?.trim() ?? "";
    })
    .catch(() => "");

  // ── Step 1: Scrape metrics in default state (All Activity Data) ──
  console.log("[fetchAnalytics] Scraping All Activity Data (default state)...");
  const allActivityMetrics = await scrapeCurrentMetrics(page);

  // ── Step 2: Click toggle to switch to Unique Users Data ──
  console.log("[fetchAnalytics] Clicking toggle to switch to Unique Users Data...");
  await page.evaluate(() => {
    const checkbox = document.getElementById('all-unique-stats-checkbox');
    if (checkbox) checkbox.click();
  });
  await page.waitForTimeout(3000);

  // ── Step 3: Scrape metrics in toggled state (Unique Users Data) ──
  console.log("[fetchAnalytics] Scraping Unique Users Data...");
  const uniqueUsersMetrics = await scrapeCurrentMetrics(page);

  // ── Step 4: Click toggle back to restore original state ──
  console.log("[fetchAnalytics] Restoring toggle to original state...");
  await page.evaluate(() => {
    const checkbox = document.getElementById('all-unique-stats-checkbox');
    if (checkbox) checkbox.click();
  });
  await page.waitForTimeout(1000);

  // ── Step 5: Build output with all 10 values ──
  const analyticsData: AnalyticsOutput = {
    bot_visits: allActivityMetrics["Unique Bot Visits"] ?? "",
    conversations: allActivityMetrics["Bot Conversations"] ?? "",
    goal_completions: allActivityMetrics["Bot Goal Completions"] ?? "",
    interaction_rate: allActivityMetrics["Bot Interaction Rate"] ?? "",
    goal_conversion_rate: allActivityMetrics["Goal Conversion Rate"] ?? "",
    unique_visits: uniqueUsersMetrics["Unique Bot Visits"] ?? "",
    unique_conversations: uniqueUsersMetrics["Bot Conversations"] ?? "",
    unique_goal_completions: uniqueUsersMetrics["Bot Goal Completions"] ?? "",
    unique_interaction_rate: uniqueUsersMetrics["Bot Interaction Rate"] ?? "",
    unique_goal_conversion_rate: uniqueUsersMetrics["Goal Conversion Rate"] ?? "",
    date_range: displayedDateRange || "unknown",
  };

  const outputPath = path.join(workDir, "analytics.json");
  fs.writeFileSync(outputPath, JSON.stringify(analyticsData, null, 2));

  const filledCount = Object.values(analyticsData).filter((v) => v && v !== "unknown").length;
  console.log(
    `[fetchAnalytics] Saved ${filledCount} values to ${outputPath}`
  );
  return outputPath;
}

/**
 * Scrapes the 5 metric cards currently visible on the analytics page.
 * Uses card-label matching first, then falls back to regex on body text.
 */
async function scrapeCurrentMetrics(
  page: Awaited<ReturnType<Browser["newPage"]>>
): Promise<Record<string, string>> {
  let metrics: Record<string, string> = {};

  // ── Attempt 1: Scrape metric cards by label ──
  try {
    metrics = await page.evaluate((labels: readonly string[]) => {
      const result: Record<string, string> = {};

      for (const label of labels) {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) =>
              node.textContent?.trim() === label
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT,
          }
        );

        const textNode = walker.nextNode();
        if (!textNode?.parentElement) continue;

        let container = textNode.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!container.parentElement) break;
          container = container.parentElement;

          const text = container.textContent ?? "";
          const numbers = text.match(/[\d,]+(?:\.\d+)?%?/g);
          if (numbers) {
            for (const num of numbers) {
              if (!label.includes(num)) {
                result[label] = num;
                break;
              }
            }
          }
          if (result[label]) break;
        }
      }

      return result;
    }, METRIC_LABELS);
  } catch (err) {
    console.log("[fetchAnalytics] Card scraping failed, trying fallback");
  }

  // ── Attempt 2: Fallback — regex-extract from full body text ──
  if (Object.keys(metrics).length < METRIC_LABELS.length) {
    try {
      const bodyText = await page.evaluate(() => document.body.innerText);

      for (const label of METRIC_LABELS) {
        if (metrics[label]) continue;

        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `${escaped}[:\\s]+([\\d,]+(?:\\.\\d+)?%?)`,
          "i"
        );
        const match = bodyText.match(re);
        if (match) {
          metrics[label] = match[1];
        }
      }
    } catch (err) {
      console.log("[fetchAnalytics] Fallback text extraction also failed");
    }
  }

  return metrics;
}
