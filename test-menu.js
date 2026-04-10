const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BOT_ID = "_oXUxA";
const BUILD_URL = `https://admin.hellotars.com/conv/${BOT_ID}/#/build/make`;
const OUTPUT_DIR = path.join(__dirname, "test-output");
const SCREENSHOT = path.join(OUTPUT_DIR, "menu_debug.png");

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

  // --- Find and describe ALL MuiIconButton-root buttons ---
  console.log("[2] Looking for MuiIconButton-root buttons...");
  const iconButtons = await page.$$('[class*="MuiIconButton-root"]');
  console.log(`    Found ${iconButtons.length} MuiIconButton-root buttons`);

  for (let i = 0; i < iconButtons.length; i++) {
    const info = await iconButtons[i].evaluate((el) => ({
      text: el.textContent?.trim(),
      class: el.className,
      ariaLabel: el.getAttribute("aria-label") || "",
      innerHTML: el.innerHTML.slice(0, 200),
      visible: el.getBoundingClientRect().width > 0,
    }));
    console.log(`    [${i}]`, info);
  }

  if (iconButtons.length === 0) {
    console.log("[ERROR] No MuiIconButton-root buttons found!");
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
    console.log(`    Saved fallback screenshot to ${SCREENSHOT}`);
    await browser.close();
    return;
  }

  // Find the three-dot (MoreVert) button - look for the one with MoreVert SVG path or "more" aria-label
  let targetButton = null;
  for (const btn of iconButtons) {
    const hasMoreVert = await btn.evaluate((el) => {
      const svg = el.querySelector("svg");
      if (!svg) return false;
      const pathD = svg.querySelector("path")?.getAttribute("d") || "";
      // MoreVert icon path starts with "M12 8c1.1" or contains three dots pattern
      // Also check aria-label
      const label = el.getAttribute("aria-label") || "";
      return (
        pathD.includes("M12 8c1.1") ||
        pathD.includes("M6 10c-1.1") ||
        label.toLowerCase().includes("more") ||
        el.textContent?.includes("more_vert")
      );
    });
    if (hasMoreVert) {
      targetButton = btn;
      break;
    }
  }

  // Fallback: try the second-to-last button if no MoreVert found, skip close buttons
  if (!targetButton) {
    console.log("    No MoreVert icon found, trying to find non-close button...");
    for (let i = iconButtons.length - 1; i >= 0; i--) {
      const isClose = await iconButtons[i].evaluate((el) => {
        const pathD = el.querySelector("svg path")?.getAttribute("d") || "";
        return pathD.includes("19 6.41"); // close icon path
      });
      if (!isClose) {
        targetButton = iconButtons[i];
        console.log(`    Using button [${i}] as fallback`);
        break;
      }
    }
  }

  if (!targetButton) {
    targetButton = iconButtons[iconButtons.length - 1];
    console.log("    All buttons look like close icons, using last one anyway");
  }

  const btnInfo = await targetButton.evaluate((el) => ({
    text: el.textContent?.trim(),
    class: el.className,
    ariaLabel: el.getAttribute("aria-label") || "",
    innerHTML: el.innerHTML.slice(0, 200),
  }));
  console.log(`    Clicking target button:`, btnInfo);

  await targetButton.click({ force: true });
  console.log("[3] Clicked! Waiting 2 seconds for dropdown...");
  await page.waitForTimeout(2000);

  // --- Screenshot the opened menu ---
  console.log("[4] Taking screenshot...");
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log(`    Saved to ${SCREENSHOT}`);

  // --- List ALL visible text in dropdown/menu area ---
  console.log("\n[5] Listing ALL visible text in dropdown/menu/popover areas:\n");
  const menuTexts = await page.evaluate(() => {
    const selectors = [
      '[role="menu"]',
      '[role="menuitem"]',
      '[role="listbox"]',
      '[role="option"]',
      '[class*="MuiMenu"]',
      '[class*="MuiPopover"]',
      '[class*="MuiList"]',
      '[class*="MuiMenuItem"]',
      '[class*="dropdown"]',
      '[class*="popover"]',
      '[class*="menu"]',
      ".MuiPaper-root",
    ];

    const results = [];
    const seen = new Set();

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const text = el.innerText?.trim();
        if (!text) continue;

        const key = `${sel}|${text.slice(0, 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          selector: sel,
          tag: el.tagName.toLowerCase(),
          class: el.className?.toString?.().slice(0, 120) || "",
          text: text.slice(0, 300),
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          pos: `(${Math.round(rect.x)}, ${Math.round(rect.y)})`,
        });
      }
    }
    return results;
  });

  if (menuTexts.length === 0) {
    console.log("  (No dropdown/menu/popover elements found!)");
  } else {
    menuTexts.forEach((m, i) => {
      console.log(`  [${i + 1}] ${m.selector}  <${m.tag}> ${m.size} @ ${m.pos}`);
      console.log(`      class: "${m.class}"`);
      console.log(`      text: "${m.text}"`);
      console.log();
    });
  }

  console.log(`\n    Total menu elements found: ${menuTexts.length}`);
  console.log(`\n[DONE] Check screenshot at ${SCREENSHOT}`);

  await browser.close();
})();
