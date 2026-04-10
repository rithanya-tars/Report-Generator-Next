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

  console.log("[1] Launching browser (headed)...");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await context.newPage();

  // --- Login via email/password ---
  console.log("[2] Logging in...");
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

  // --- Navigate to target ---
  console.log(`[3] Navigating to ${TARGET_URL}`);
  await page.goto(TARGET_URL, { timeout: 60000 });
  await page.waitForTimeout(3000);

  // --- Super Admin Gate ---
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes("Super Admin")) {
      console.log("[GATE] Super Admin prompt detected — clicking Enter...");
      page.once("dialog", async (d) => {
        console.log("[GATE] Accepting dialog:", d.message());
        await d.accept();
      });
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { timeout: 15000 }),
        page.click('a:has-text("Enter"), button:has-text("Enter")'),
      ]);
      await newPage.waitForLoadState("domcontentloaded");
      await newPage.waitForTimeout(3000);
      console.log("[GATE] New tab opened:", newPage.url());
      await page.close();
      page = newPage;

      // Re-navigate after gate
      await page.goto(TARGET_URL, { timeout: 60000 });
      await page.waitForTimeout(5000);
    } else {
      console.log("[GATE] No Super Admin gate found, continuing...");
    }
  } catch (err) {
    console.log("[GATE] Gate handling error (non-fatal):", err.message);
  }

  // --- Screenshot loop: every 5 seconds for 30 seconds ---
  console.log("[4] Starting screenshot loop (6 captures, 5s apart)...\n");

  for (let i = 1; i <= 6; i++) {
    if (i > 1) await page.waitForTimeout(5000);

    const screenshotPath = path.join(OUTPUT_DIR, `amen_${i}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Count buttons on the page
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

    const elapsed = i * 5;
    console.log(
      `  [amen_${i}.png] t=${elapsed}s — ${buttonCount} visible button(s) — ${page.url()}`
    );
  }

  console.log("\n[5] Done. Screenshots saved to test-output/amen_1.png through amen_6.png");
  console.log("    Browser left open — close it manually when done inspecting.");

  // Keep browser open so you can inspect
  await page.waitForTimeout(300000); // 5 min before auto-close
  await browser.close();
})();
