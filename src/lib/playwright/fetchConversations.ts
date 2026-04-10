import { Browser } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { handleSuperAdminGate } from "./helpers";

/**
 * Exports conversation data as CSV from Tars 1.0 admin panel.
 *
 * Flow:
 *   1. Navigate to admin.hellotars.com/conv/{botId}/#/data/view
 *   2. Click the page-level "EXPORT DATA" button
 *   3. In the modal: select "All conversations", toggle "Select all" gambits
 *   4. Click the modal's "EXPORT DATA" button to trigger download
 */
export async function fetchConversations(
  browser: Browser,
  chatbotUrl: string,
  workDir: string,
  dateRange: { start: string; end: string } | null = null
): Promise<string> {
  const page = (await browser.contexts())[0]?.pages()[0];
  if (!page) throw new Error("No active page in browser context");

  const botId = extractBotId(chatbotUrl);

  // Navigate to the data view page
  await page.goto(
    `https://admin.hellotars.com/conv/${botId}/#/data/view`,
    { timeout: 60000 }
  );
  await page.waitForTimeout(10000);
  await handleSuperAdminGate(page, `https://admin.hellotars.com/conv/${botId}/#/data/view`);
  // Wait for page content to actually render (up to 30 seconds)
  console.log("[fetchConversations] Waiting for page content to load...");
  let pageLoaded = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    const buttonCount = await page.locator('button').count();
    if (buttonCount > 2) {
      console.log("[fetchConversations] Page loaded — found " + buttonCount + " buttons after " + (i+1) + " seconds");
      pageLoaded = true;
      break;
    }
    if (i === 29) {
      console.log("[fetchConversations] Warning: page may not have fully loaded after 30 seconds");
    }
  }

  // If page didn't load, force reload and wait again
  if (!pageLoaded) {
    console.log("[fetchConversations] No buttons found — reloading page...");
    await page.reload({ timeout: 60000 });
    await page.waitForTimeout(5000);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const buttonCount = await page.locator('button').count();
      if (buttonCount > 2) {
        console.log("[fetchConversations] Page loaded after reload — found " + buttonCount + " buttons after " + (i+1) + " seconds");
        pageLoaded = true;
        break;
      }
    }
    if (!pageLoaded) {
      // Take screenshot for debugging and throw descriptive error
      await page.screenshot({ path: path.join(workDir, 'debug_page_empty.png'), fullPage: true });
      throw new Error("Page did not render any buttons after reload. See debug_page_empty.png for page state.");
    }
  }

  // ── Debug: log page state before date picker click ──
  console.log("[fetchConversations] Current URL:", page.url());
  await page.screenshot({ path: path.join(workDir, 'debug_before_datepicker.png') });
  const count1 = await page.locator('button:has-text(" - ")').count();
  const count2 = await page.locator('button:has-text("/")').count();
  const count3 = await page.locator('button').count();
  console.log("[fetchConversations] Selector matches: ' - '=" + count1 + ", '/'=" + count2 + ", total buttons=" + count3);

  // ── Select date range so EXPORT DATA becomes enabled ──
  // Open the date picker (outlined button showing "dd/mm/yy - dd/mm/yy")
  console.log("[fetchConversations] Clicking date picker button...");
  let datePickerClicked = false;

  // Try 1: match the " - " separator pattern (e.g. "27/03/26 - 27/03/26")
  try {
    const btn1 = page.locator('button:has-text(" - ")').first();
    await btn1.click({ force: true, timeout: 30000 });
    console.log('[fetchConversations] Date picker matched with selector: button:has-text(" - ")');
    datePickerClicked = true;
  } catch {
    console.log('[fetchConversations] Selector button:has-text(" - ") failed, trying fallback...');
  }

  // Try 2: match any button containing "/"
  if (!datePickerClicked) {
    try {
      const btn2 = page.locator('button:has-text("/")').first();
      await btn2.click({ force: true, timeout: 30000 });
      console.log('[fetchConversations] Date picker matched with selector: button:has-text("/")');
      datePickerClicked = true;
    } catch {
      console.log('[fetchConversations] Selector button:has-text("/") failed, trying fallback...');
    }
  }

  // Try 3: use the parent data-test attribute
  if (!datePickerClicked) {
    const btn3 = page.locator('[data-test="ViewAndExportDataButtons"] button').last();
    await btn3.click({ force: true, timeout: 30000 });
    console.log('[fetchConversations] Date picker matched with selector: [data-test="ViewAndExportDataButtons"] button');
  }

  await page.waitForTimeout(1000);

  // ── Debug: screenshot after date picker opens ──
  await page.screenshot({ path: path.join(workDir, 'debug_datepicker_open.png') });
  console.log("[fetchConversations] Date picker opened — screenshot saved to debug_datepicker_open.png");

  if (dateRange) {
    console.log(`[fetchConversations] Setting date range: ${dateRange.start} – ${dateRange.end}`);
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);

    // Check if this range matches "Last Month" — use the preset if so
    const now = new Date();
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of previous month
    const isLastMonth =
      start.getFullYear() === lastMonthDate.getFullYear() &&
      start.getMonth() === lastMonthDate.getMonth() &&
      start.getDate() === 1 &&
      end.getFullYear() === lastMonthEnd.getFullYear() &&
      end.getMonth() === lastMonthEnd.getMonth() &&
      end.getDate() === lastMonthEnd.getDate();

    if (isLastMonth) {
      console.log('[fetchConversations] Date range matches "Last Month" preset — using preset instead of manual navigation');
      await page.click('text="Last Month"', { timeout: 5000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(workDir, 'debug_after_lastmonth_preset.png') });
      console.log("[fetchConversations] Clicked Last Month preset — screenshot saved");
    } else {
      // Manual calendar navigation for non-preset ranges
      const monthNames = ["January","February","March","April","May","June",
        "July","August","September","October","November","December"];

      const startDay = start.getDate();
      const endDay = end.getDate();
      const startMonth = start.getMonth(); // 0-based
      const startYear = start.getFullYear();
      const endMonth = end.getMonth();
      const endYear = end.getFullYear();
      const sameMonth = startMonth === endMonth && startYear === endYear;

      // Helper: read the left calendar's displayed month/year from the dropdowns
      const getLeftMonthYear = async (): Promise<{ month: number; year: number }> => {
        return await page.evaluate(() => {
          const monthPickers = document.querySelectorAll('.rdrMonthAndYearPickers');
          const leftPicker = monthPickers[0];
          if (!leftPicker) throw new Error('No .rdrMonthAndYearPickers found');
          const monthSelect = leftPicker.querySelector<HTMLSelectElement>('.rdrMonthPicker select');
          const yearSelect = leftPicker.querySelector<HTMLSelectElement>('.rdrYearPicker select');
          if (!monthSelect || !yearSelect) {
            // Fallback: read text content
            const text = leftPicker.textContent || '';
            throw new Error('Cannot read dropdowns, text: ' + text);
          }
          return { month: parseInt(monthSelect.value), year: parseInt(yearSelect.value) };
        });
      };

      // Step 1: Read current left calendar month
      const current = await getLeftMonthYear();
      console.log(`[fetchConversations] Left calendar currently shows: ${monthNames[current.month]} ${current.year}`);
      console.log(`[fetchConversations] Target start: ${monthNames[startMonth]} ${startYear}, Target end: ${monthNames[endMonth]} ${endYear}`);

      // Step 2: Calculate how many back-clicks needed to reach start month on the left calendar
      const monthsBack = (current.year - startYear) * 12 + (current.month - startMonth);
      console.log(`[fetchConversations] Need to go back ${monthsBack} month(s)`);

      // Step 3: Click the prev arrow that many times
      for (let i = 0; i < monthsBack; i++) {
        console.log(`[fetchConversations] Clicking prev arrow (${i + 1}/${monthsBack})...`);
        await page.click('button.rdrPprevButton', { force: true, timeout: 3000 });
        await page.waitForTimeout(500);
        const after = await getLeftMonthYear();
        console.log(`[fetchConversations] Left calendar now shows: ${monthNames[after.month]} ${after.year}`);
      }

      await page.screenshot({ path: path.join(workDir, 'debug_calendar_navigated.png') });

      // Step 4: Click the start day in the LEFT calendar (index 0)
      // Use page.evaluate to find coordinates, then Playwright mouse.click for proper React synthetic events
      console.log(`[fetchConversations] Clicking start day ${startDay} in LEFT calendar...`);
      const startCoords = await page.evaluate((day) => {
        const months = document.querySelectorAll('.rdrMonth');
        const leftMonth = months[0];
        if (!leftMonth) throw new Error('No .rdrMonth elements found');
        const days = leftMonth.querySelectorAll('.rdrDay:not(.rdrDayPassive)');
        for (const d of days) {
          const num = d.querySelector('.rdrDayNumber span');
          if (num && num.textContent!.trim() === String(day)) {
            const rect = d.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        throw new Error('Start day ' + day + ' not found in left calendar');
      }, startDay);
      await page.mouse.click(startCoords.x, startCoords.y);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(workDir, 'debug_after_start_date.png') });
      console.log("[fetchConversations] Clicked start date — screenshot saved");

      // Step 5: Click the end day in the appropriate calendar panel
      // If same month → LEFT (index 0). If end month is start month + 1 → RIGHT (index 1).
      const endPanelIndex = sameMonth ? 0 : 1;
      const panelLabel = sameMonth ? "LEFT" : "RIGHT";
      console.log(`[fetchConversations] Clicking end day ${endDay} in ${panelLabel} calendar (panel index ${endPanelIndex})...`);
      const endCoords = await page.evaluate(({ day, panelIdx }) => {
        const months = document.querySelectorAll('.rdrMonth');
        const panel = months[panelIdx];
        if (!panel) throw new Error('Calendar panel index ' + panelIdx + ' not found');
        const days = panel.querySelectorAll('.rdrDay:not(.rdrDayPassive)');
        for (const d of days) {
          const num = d.querySelector('.rdrDayNumber span');
          if (num && num.textContent!.trim() === String(day)) {
            const rect = d.getBoundingClientRect();
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        throw new Error('End day ' + day + ' not found in panel ' + panelIdx);
      }, { day: endDay, panelIdx: endPanelIndex });
      await page.mouse.click(endCoords.x, endCoords.y);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(workDir, 'debug_after_end_date.png') });
      console.log("[fetchConversations] Clicked end date — screenshot saved");
    }
  } else {
    // No date range — click "Last Month" preset to get recent data
    console.log('[fetchConversations] No date range — clicking Last Month preset');
    await page.click('text="Last Month"', { timeout: 5000 });
    await page.waitForTimeout(500);
  }

  // Click APPLY to confirm the date selection
  console.log('[fetchConversations] Clicking APPLY... selector: button:has-text("APPLY")');
  await page.click('button:has-text("APPLY")', { timeout: 10000 });
  await page.waitForTimeout(3000);

  // ── Debug: check state after APPLY ──
  await page.screenshot({ path: path.join(workDir, 'debug_after_apply.png') });
  // Verify date picker button text changed from today's date
  const dateButtonText = await page.locator('button:has-text(" - ")').first().innerText().catch(() => "N/A");
  console.log("[fetchConversations] Date picker button text after APPLY:", dateButtonText);
  const isDisabled = await page.locator('button:has-text("EXPORT DATA")').first().isDisabled();
  console.log("[fetchConversations] EXPORT DATA disabled:", isDisabled);
  if (isDisabled) {
    const pageText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log("[fetchConversations] Page text:", pageText);
  }

  // Click the page-level "EXPORT DATA" button (teal button at top)
  console.log('[fetchConversations] Clicking EXPORT DATA... selector: button:has-text("EXPORT DATA")');
  await page.click('button:has-text("EXPORT DATA")', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // In the export modal: select "All conversations" radio
  console.log('[fetchConversations] Clicking All conversations... selector: label:has-text("All conversations")');
  await page.click('label:has-text("All conversations"), input[value="all"]', {
    timeout: 10000,
    force: true,
  });
  await page.waitForTimeout(500);

  // Toggle "Select all" gambits
  console.log('[fetchConversations] Clicking Select all gambits... selector: label:has-text("Select all")');
  await page.click(
    'label:has-text("Select all"), input[type="checkbox"]:near(:text("Select all"))',
    { timeout: 10000, force: true }
  );
  await page.waitForTimeout(500);

  // Set up download listener before clicking the modal export button
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });

  // Click the modal's "EXPORT DATA" button (second one on the page)
  console.log('[fetchConversations] Clicking modal EXPORT DATA... selector: button:has-text("EXPORT DATA") (last instance)');
  const exportButtons = page.locator('button:has-text("EXPORT DATA")');
  const count = await exportButtons.count();
  // The modal button is the last "EXPORT DATA" button on the page
  await exportButtons.nth(count - 1).click({ force: true });

  // Wait for download to complete
  const download = await downloadPromise;
  const outputPath = path.join(workDir, "conversations.csv");
  await download.saveAs(outputPath);

  // Verify file exists and has content
  const stats = fs.statSync(outputPath);
  if (stats.size === 0) {
    throw new Error("Downloaded conversations CSV is empty");
  }

  console.log(
    `[fetchConversations] Saved ${stats.size} bytes to ${outputPath}`
  );
  return outputPath;
}

/**
 * Extracts bot ID from various URL formats:
 *   - admin.hellotars.com/conv/{id}/#/...
 *   - app.hellotars.com/agents/{id}/...
 *   - agent.hellotars.com/conv/{id}
 *   - Raw ID like "AXX35f"
 */
export function extractBotId(url: string): string {
  // admin.hellotars.com/conv/{id} or agent.hellotars.com/conv/{id}
  const convMatch = url.match(/\/conv\/([a-zA-Z0-9_-]+)/);
  if (convMatch) return convMatch[1];

  // app.hellotars.com/agents/{id}
  const agentsMatch = url.match(/\/agents\/([a-zA-Z0-9_-]+)/);
  if (agentsMatch) return agentsMatch[1];

  // Raw ID (no slashes, just alphanumeric)
  if (/^[a-zA-Z0-9_-]+$/.test(url)) return url;

  throw new Error(`Cannot extract bot ID from: ${url}`);
}
