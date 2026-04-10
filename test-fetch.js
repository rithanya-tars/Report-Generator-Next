const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BOT_ID = "_oXUxA";
const OUTPUT_DIR = path.join(__dirname, "test-output");

async function handleSuperAdminGate(page, context, targetUrl) {
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (!bodyText.includes("Super Admin Mode")) return page;

    console.log("[GATE] Super Admin Mode prompt detected");

    page.once("dialog", async (dialog) => {
      console.log("[GATE] Accepting confirm dialog:", dialog.message());
      await dialog.accept();
    });

    const [newPage] = await Promise.all([
      context.waitForEvent("page", { timeout: 60000 }),
      page.click('a:has-text("Enter")'),
    ]);

    await newPage.waitForLoadState("domcontentloaded");
    await newPage.waitForTimeout(3000);
    console.log("[GATE] New tab opened, URL:", newPage.url());

    await page.close();

    await newPage.goto(targetUrl, { timeout: 60000 });
    await newPage.waitForTimeout(5000);
    console.log("[GATE] Navigated to target:", newPage.url());

    return newPage;
  } catch (err) {
    console.log("[GATE] Error handling gate:", err.message);
    return page;
  }
}

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("\n=== STEP 2: Exporting conversations CSV (headless: false) ===");
  const auth = JSON.parse(fs.readFileSync("auth.json", "utf-8"));
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await context.addCookies(auth.cookies);
  let page = await context.newPage();
  console.log("[OK] Browser launched, cookies loaded");

  try {
    const dataViewUrl = `https://admin.hellotars.com/conv/${BOT_ID}/#/data/view`;
    await page.goto(dataViewUrl, { timeout: 60000 });
    console.log("[OK] Navigated to data/view");
    await page.waitForTimeout(3000);
    page = await handleSuperAdminGate(page, context, dataViewUrl);

    // ── Open date picker ──
    console.log("\n[DATE] Opening date picker...");
    await page.click('button.MuiButton-outlined', { timeout: 10000 });
    await page.waitForTimeout(1500);
    console.log("[DATE] Date picker opened");

    // ── No dateRange path: click "Last Month" preset ──
    console.log('[DATE] Clicking "Last Month" preset...');
    await page.click('text="Last Month"', { timeout: 5000 });
    await page.waitForTimeout(500);
    console.log("[DATE] Selected Last Month");

    // ── Click APPLY ──
    console.log("[DATE] Clicking APPLY...");
    await page.click('button:has-text("APPLY")', { timeout: 10000 });
    console.log("[DATE] Clicked APPLY");
    await page.waitForTimeout(3000);

    // ── Screenshot after date range applied ──
    const postDateScreenshot = path.join(OUTPUT_DIR, "post_date_range.png");
    await page.screenshot({ path: postDateScreenshot, fullPage: true });
    console.log(`[OK] Post-date-range screenshot saved to ${postDateScreenshot}`);

    // Log EXPORT DATA button state
    const exportBtn = page.locator('button:has-text("EXPORT DATA")');
    const isDisabled = await exportBtn.getAttribute("disabled");
    const classes = await exportBtn.getAttribute("class");
    console.log(`[INFO] EXPORT DATA button — disabled=${isDisabled}, classes=${classes}`);

    // ── Click EXPORT DATA ──
    console.log("\n[ACTION] Clicking EXPORT DATA...");
    await page.click('button:has-text("EXPORT DATA")', { timeout: 15000 });
    console.log("[OK] Clicked EXPORT DATA");
    await page.waitForTimeout(2000);

    // Screenshot after export click (modal should be open)
    const exportScreenshot = path.join(OUTPUT_DIR, "after_export_click.png");
    await page.screenshot({ path: exportScreenshot, fullPage: true });
    console.log(`[OK] Post-export-click screenshot saved to ${exportScreenshot}`);

    console.log("\n=== STEP 2 COMPLETED ===");
  } catch (err) {
    console.error("\n[ERROR]", err.message);
  } finally {
    await browser.close();
    console.log("[OK] Browser closed");
  }
})();
