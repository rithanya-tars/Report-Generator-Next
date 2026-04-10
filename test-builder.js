const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BOT_ID = "_oXUxA";
const BUILD_URL = `https://admin.hellotars.com/conv/${BOT_ID}/#/build/make`;
const OUTPUT_DIR = path.join(__dirname, "test-output");
const SCREENSHOT = path.join(OUTPUT_DIR, "builder_debug.png");

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const auth = JSON.parse(fs.readFileSync("auth.json", "utf-8"));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await context.addCookies(auth.cookies);

  let page = await context.newPage();
  console.log(`[1] Navigating to ${BUILD_URL}`);
  await page.goto(BUILD_URL, { timeout: 60000 });
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

      // Re-navigate to build page after gate
      await page.goto(BUILD_URL, { timeout: 60000 });
      await page.waitForTimeout(5000);
    } else {
      console.log("[GATE] No Super Admin gate found, continuing...");
    }
  } catch (err) {
    console.log("[GATE] Gate handling error (non-fatal):", err.message);
  }

  // --- Screenshot ---
  console.log("[2] Taking screenshot...");
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log(`    Saved to ${SCREENSHOT}`);

  // --- List all clickable elements ---
  console.log("\n[3] Listing ALL clickable elements on page:\n");
  const elements = await page.evaluate(() => {
    const selectors = [
      "button",
      "a",
      '[role="button"]',
      '[role="menuitem"]',
      "input[type=button]",
      "input[type=submit]",
      "[onclick]",
      "[class*=menu]",
      "[class*=dot]",
      "[class*=more]",
      "[class*=ellipsis]",
      "i.fa",
      "i.material-icons",
      "svg",
    ];

    const seen = new Set();
    const results = [];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // skip hidden

        const key = `${el.tagName}|${el.className}|${el.textContent?.trim().slice(0, 60)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 80),
          class: el.className?.toString?.().slice(0, 100) || "",
          id: el.id || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          href: el.getAttribute("href") || "",
          role: el.getAttribute("role") || "",
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          pos: `(${Math.round(rect.x)}, ${Math.round(rect.y)})`,
        });
      }
    }
    return results;
  });

  elements.forEach((el, i) => {
    const label =
      el.text || el.ariaLabel || el.class || el.id || `<${el.tag}>`;
    console.log(
      `  [${String(i + 1).padStart(3)}] <${el.tag}> ${el.size} @ ${el.pos}` +
        `  "${label.slice(0, 60)}"` +
        (el.class ? `  class="${el.class.slice(0, 60)}"` : "") +
        (el.id ? `  id="${el.id}"` : "") +
        (el.href ? `  href="${el.href}"` : "")
    );
  });

  console.log(`\n    Total: ${elements.length} clickable elements found.`);
  console.log("\n[DONE] Check screenshot at test-output/builder_debug.png");

  await browser.close();
})();
