const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// Load .env.local
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const EMAIL = process.env.TARS_EMAIL;
const PASSWORD = process.env.TARS_PASSWORD;
const TARGET_URL = "https://admin.hellotars.com/conv/UlSbQQ/#/data/view";
const OUTPUT_DIR = path.join(__dirname, "test-output");

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error("Missing TARS_EMAIL or TARS_PASSWORD in .env.local");
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Step 1: Launch browser (headed) ---
  console.log("[1] Launching browser (headed)...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // --- Step 2: Login via email/password ---
  console.log("[2] Logging in with email/password...");
  await page.goto("https://app.hellotars.com/login", { timeout: 60000 });
  await page.waitForTimeout(5000);

  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]', { force: true });
  await page.waitForTimeout(10000);

  if (page.url().includes("login")) {
    console.error("[LOGIN FAILED] Still on login page:", page.url());
    await browser.close();
    process.exit(1);
  }
  console.log("[2] Logged in. Current URL:", page.url());

  // --- Step 3: Navigate to target ---
  console.log(`[3] Navigating to ${TARGET_URL}`);
  await page.goto(TARGET_URL, { timeout: 60000 });

  // --- Step 4: Wait 10 seconds, then screenshot ---
  console.log("[4] Waiting 10 seconds...");
  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "gate_before.png"), fullPage: true });
  console.log("[4] Screenshot saved: test-output/gate_before.png");

  // --- Step 5: Log ALL visible links and their text ---
  console.log("[5] Logging all visible links...");
  const links = await page.evaluate(() => {
    const results = [];
    for (const a of document.querySelectorAll("a")) {
      const rect = a.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        results.push({
          text: a.innerText.trim(),
          href: a.href,
          id: a.id || "",
          className: a.className || "",
        });
      }
    }
    return results;
  });

  console.log(`[5] Found ${links.length} visible link(s):`);
  for (const link of links) {
    console.log(`    text="${link.text}" href="${link.href}" id="${link.id}" class="${link.className}"`);
  }

  // --- Step 6: Try clicking the "Enter" link with force ---
  console.log('[6] Trying to click "Enter" link with force: true...');
  let clickSucceeded = false;
  try {
    await page.click('a:has-text("Enter")', { force: true, timeout: 5000 });
    clickSucceeded = true;
    console.log("[6] Click SUCCEEDED");
  } catch (err) {
    console.log("[6] Click FAILED:", err.message);
  }

  // --- Step 7: Log result ---
  console.log(`[7] Click succeeded: ${clickSucceeded}`);

  // --- Step 8: Wait 3 seconds ---
  console.log("[8] Waiting 3 seconds...");
  await page.waitForTimeout(3000);

  // --- Step 9: Screenshot after click ---
  await page.screenshot({ path: path.join(OUTPUT_DIR, "gate_after_click.png"), fullPage: true });
  console.log("[9] Screenshot saved: test-output/gate_after_click.png");

  // --- Step 10: Reload the page ---
  console.log("[10] Reloading page...");
  await page.reload({ timeout: 60000 });

  // --- Step 11: Wait 10 seconds ---
  console.log("[11] Waiting 10 seconds after reload...");
  await page.waitForTimeout(10000);

  // --- Step 12: Screenshot after reload ---
  await page.screenshot({ path: path.join(OUTPUT_DIR, "gate_after_reload.png"), fullPage: true });
  console.log("[12] Screenshot saved: test-output/gate_after_reload.png");

  // --- Step 13: Log button count on reloaded page ---
  const buttonCount = await page.evaluate(() => {
    const selectors = [
      "button",
      'a[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      '[role="button"]',
    ];
    const seen = new Set();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) seen.add(el);
      }
    }
    return seen.size;
  });
  console.log(`[13] Button count on reloaded page: ${buttonCount}`);

  // --- Step 14: Stay open for 60 seconds ---
  console.log("[14] Browser staying open for 60 seconds — observe manually...");
  await page.waitForTimeout(60000);

  console.log("[DONE] Closing browser.");
  await browser.close();
})();
