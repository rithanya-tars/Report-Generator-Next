const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BOT_ID = "_oXUxA";
const BUILD_URL = `https://admin.hellotars.com/conv/${BOT_ID}/#/build/make`;
const OUTPUT_DIR = path.join(__dirname, "test-output");

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

  // Super Admin gate
  try {
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes("Super Admin")) {
      console.log("[GATE] Super Admin prompt detected — clicking Enter...");
      page.once("dialog", async (d) => await d.accept());
      const [newPage] = await Promise.all([
        context.waitForEvent("page", { timeout: 15000 }),
        page.click('a:has-text("Enter"), button:has-text("Enter")'),
      ]);
      await newPage.waitForLoadState("domcontentloaded");
      await newPage.waitForTimeout(3000);
      await page.close();
      page = newPage;
      await page.goto(BUILD_URL, { timeout: 60000 });
      await page.waitForTimeout(5000);
    }
  } catch (err) {
    console.log("[GATE] Gate handling error (non-fatal):", err.message);
  }

  // Wait for builder to fully render
  await page.waitForTimeout(5000);

  // First, dump what buttons exist to debug
  console.log("\n[2] Dumping ALL buttons with SVGs...");
  const allBtnInfo = await page.evaluate(() => {
    const results = [];
    const allBtns = document.querySelectorAll("button, [role='button'], [class*='IconButton']");
    for (const el of allBtns) {
      const svg = el.querySelector("svg");
      if (!svg) continue;
      const pathD = svg.querySelector("path")?.getAttribute("d")?.slice(0, 60) || "";
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      results.push({
        tag: el.tagName,
        class: el.className?.toString?.().slice(0, 120) || "",
        pathD,
        rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
        hasMoreVert: pathD.includes("M12 8c1.1"),
      });
    }
    return results;
  });

  for (let i = 0; i < allBtnInfo.length; i++) {
    const b = allBtnInfo[i];
    const marker = b.hasMoreVert ? " <<< MOREVERT" : "";
    console.log(`  [${i}] <${b.tag}> ${b.rect} path="${b.pathD}"${marker}`);
    console.log(`       class="${b.class}"`);
  }
  console.log(`  Total: ${allBtnInfo.length} buttons with SVGs`);

  // Also check: is the toolbar even visible?
  console.log("\n[3] Checking for toolbar area...");
  const toolbarInfo = await page.evaluate(() => {
    // Look for the "Main Flow" text
    const allEls = document.querySelectorAll("*");
    for (const el of allEls) {
      if (el.textContent?.includes("Main Flow") && el.children.length < 5) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          return {
            tag: el.tagName,
            class: el.className?.toString?.().slice(0, 100),
            text: el.textContent.trim().slice(0, 100),
            rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
          };
        }
      }
    }
    return null;
  });
  console.log("  Main Flow element:", toolbarInfo);

  // Take a screenshot for comparison
  const ss = path.join(OUTPUT_DIR, "export_json_debug.png");
  await page.screenshot({ path: ss, fullPage: true });
  console.log(`  Screenshot: ${ss}`);

  // Now try to find and click the MoreVert button with retry
  console.log("\n[4] Attempting to find and click MoreVert...");
  let clicked = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    clicked = await page.evaluate(() => {
      const candidates = document.querySelectorAll("button, [role='button'], [class*='IconButton']");
      for (const el of candidates) {
        const svg = el.querySelector("svg");
        if (!svg) continue;
        const paths = svg.querySelectorAll("path");
        for (const p of paths) {
          const d = p.getAttribute("d") || "";
          if (d.includes("M12 8c1.1")) {
            el.click();
            return { method: "morevert-svg", class: el.className?.toString?.().slice(0, 100) };
          }
        }
      }
      return null;
    });
    if (clicked) break;
    console.log(`  Attempt ${attempt + 1} failed, waiting 3s...`);
    await page.waitForTimeout(3000);
  }

  if (!clicked) {
    console.log("[ERROR] Could not find MoreVert button after 3 attempts!");
    // Try clicking by position as last resort
    console.log("  Trying click at approximate position (1230, 143)...");
    await page.mouse.click(1230, 143);
    clicked = { method: "position-click" };
  }

  console.log("  Clicked via:", clicked);
  await page.waitForTimeout(2000);

  // Screenshot after clicking
  const ss2 = path.join(OUTPUT_DIR, "after_morevert_click.png");
  await page.screenshot({ path: ss2, fullPage: true });
  console.log(`  Screenshot: ${ss2}`);

  // Check for menu items
  console.log("\n[5] Looking for menu items...");
  const menuItems = await page.evaluate(() => {
    const results = [];
    const selectors = [
      '[role="menuitem"]',
      '[role="menu"] *',
      '[class*="MuiMenuItem"]',
      '[class*="MuiPopover"] *',
      '[class*="MuiMenu"] li',
      '[class*="MuiList"] li',
      '[class*="MuiPaper"] li',
    ];
    const seen = new Set();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = el.textContent?.trim();
        if (!text || text.length > 100) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        results.push({
          tag: el.tagName.toLowerCase(),
          class: el.className?.toString?.().slice(0, 100) || "",
          text,
          rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
        });
      }
    }
    return results;
  });

  console.log(`  Found ${menuItems.length} items:`);
  for (const item of menuItems) {
    const marker = item.text.toLowerCase().includes("export") ? " <-- EXPORT!" : "";
    console.log(`  <${item.tag}> "${item.text}" ${item.rect}${marker}`);
  }

  console.log("\n[DONE]");
  await browser.close();
})();
