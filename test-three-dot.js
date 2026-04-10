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
  await page.waitForTimeout(5000);

  // Super Admin gate (simplified)
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

  // Dump ALL clickable elements in the top-right toolbar area
  console.log("\n[2] Scanning ALL elements in top-right toolbar area...\n");
  const topRightElements = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll("button, [role='button'], [class*='IconButton'], [class*='icon'], span, a");
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      // Top 200px, right third of page, visible
      if (rect.top < 200 && rect.left > window.innerWidth * 0.65 && rect.width > 0 && rect.height > 0) {
        const svg = el.querySelector("svg");
        let svgPathD = "";
        if (svg) {
          svgPathD = svg.querySelector("path")?.getAttribute("d")?.slice(0, 80) || "";
        }
        results.push({
          tag: el.tagName.toLowerCase(),
          class: el.className?.toString?.().slice(0, 150) || "",
          text: el.textContent?.trim().slice(0, 50) || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          role: el.getAttribute("role") || "",
          svgPathD,
          rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
        });
      }
    }
    return results;
  });

  for (let i = 0; i < topRightElements.length; i++) {
    const el = topRightElements[i];
    console.log(`  [${i}] <${el.tag}> ${el.rect}`);
    console.log(`      class: "${el.class}"`);
    console.log(`      text: "${el.text}" | aria: "${el.ariaLabel}" | role: "${el.role}"`);
    if (el.svgPathD) console.log(`      svg path: "${el.svgPathD}"`);
    console.log();
  }

  console.log(`  Total elements found: ${topRightElements.length}`);

  // Now try to find and click the ⋮ specifically
  console.log("\n[3] Attempting to click the rightmost button in toolbar...");
  const clickResult = await page.evaluate(() => {
    const candidates = [];
    const allEls = document.querySelectorAll("button, [role='button'], [class*='IconButton']");
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.top < 200 && rect.left > window.innerWidth / 2 && rect.width > 0 && rect.height > 0) {
        candidates.push({ el, left: rect.left });
      }
    }
    candidates.sort((a, b) => b.left - a.left);
    if (candidates.length > 0) {
      const target = candidates[0];
      const info = {
        tag: target.el.tagName.toLowerCase(),
        class: target.el.className?.toString?.().slice(0, 150) || "",
        text: target.el.textContent?.trim().slice(0, 50) || "",
        innerHTML: target.el.innerHTML.slice(0, 200),
        left: Math.round(target.left),
      };
      target.el.click();
      return info;
    }
    return null;
  });

  console.log("  Clicked:", clickResult);
  await page.waitForTimeout(2000);

  // Take screenshot after click
  const screenshot1 = path.join(OUTPUT_DIR, "three_dot_after_click.png");
  await page.screenshot({ path: screenshot1, fullPage: true });
  console.log(`  Screenshot saved to ${screenshot1}`);

  // Check for Export JSON in any menu/popover
  console.log("\n[4] Looking for Export JSON in menus...");
  const menuItems = await page.evaluate(() => {
    const results = [];
    const allEls = document.querySelectorAll('[role="menuitem"], [class*="MuiMenuItem"], [class*="MuiPopover"] *, [class*="MuiMenu"] *, li');
    for (const el of allEls) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = el.textContent?.trim();
      if (text && text.length < 100) {
        results.push({
          tag: el.tagName.toLowerCase(),
          class: el.className?.toString?.().slice(0, 100) || "",
          text,
          rect: `${Math.round(rect.width)}x${Math.round(rect.height)} @ (${Math.round(rect.left)}, ${Math.round(rect.top)})`,
        });
      }
    }
    // Deduplicate by text
    const seen = new Set();
    return results.filter(r => {
      if (seen.has(r.text)) return false;
      seen.add(r.text);
      return true;
    });
  });

  for (const item of menuItems) {
    const marker = item.text.includes("Export") ? " <-- EXPORT!" : "";
    console.log(`  <${item.tag}> "${item.text}" ${item.rect}${marker}`);
  }

  console.log(`\n[DONE]`);
  await browser.close();
})();
