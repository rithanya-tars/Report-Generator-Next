const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BOT_ID = "_oXUxA";
const DATA_URL = `https://admin.hellotars.com/conv/${BOT_ID}/#/data/view`;
const OUTPUT_DIR = path.join(__dirname, "test-output");
const SCREENSHOT = path.join(OUTPUT_DIR, "datepicker_page.png");

(async () => {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const auth = JSON.parse(fs.readFileSync("auth.json", "utf-8"));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  await context.addCookies(auth.cookies);

  let page = await context.newPage();
  console.log(`[1] Navigating to ${DATA_URL}`);
  await page.goto(DATA_URL, { timeout: 60000 });
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

      // Re-navigate to data view after gate
      await page.goto(DATA_URL, { timeout: 60000 });
      await page.waitForTimeout(3000);
    } else {
      console.log("[GATE] No Super Admin gate found, continuing...");
    }
  } catch (err) {
    console.log("[GATE] Gate handling error (non-fatal):", err.message);
  }

  // --- Wait 10 seconds for page to fully load ---
  console.log("[2] Waiting 10 seconds for page to fully settle...");
  await page.waitForTimeout(10000);

  // --- Screenshot ---
  console.log("[3] Taking screenshot...");
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log(`    Saved to ${SCREENSHOT}`);

  // --- List ALL interactive elements on the page ---
  console.log("\n[4] Listing ALL interactive elements on the page:\n");
  const elements = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Collect all potentially interactive elements
    const selectors = [
      "button",
      "a",
      "input",
      "select",
      "textarea",
      "[onclick]",
      "[role='button']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[tabindex]",
      "[class*='MuiButton']",
      "[class*='MuiIconButton']",
      "[class*='MuiTab']",
      "[class*='MuiChip']",
      "[class*='clickable']",
      "[class*='date']",
      "[class*='Date']",
      "[class*='picker']",
      "[class*='Picker']",
      "[class*='range']",
      "[class*='Range']",
      "[class*='calendar']",
      "[class*='Calendar']",
      "[class*='rdr']",
    ];

    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const rect = el.getBoundingClientRect();
        const key = el.tagName + "|" + el.className?.toString?.().slice(0, 80) + "|" + (el.textContent?.trim().slice(0, 30) || "");
        if (seen.has(key)) continue;
        seen.add(key);

        const text = (el.textContent?.trim() || "").slice(0, 50);
        const value = el.value || "";
        const placeholder = el.placeholder || "";

        results.push({
          tag: el.tagName.toLowerCase(),
          type: el.type || "",
          text: text,
          value: value.slice(0, 50),
          placeholder: placeholder.slice(0, 50),
          class: el.className?.toString?.().slice(0, 120) || "",
          id: el.id || "",
          role: el.getAttribute("role") || "",
          ariaLabel: el.getAttribute("aria-label") || "",
          href: el.href || "",
          visible: rect.width > 0 && rect.height > 0,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          selector: sel,
        });
      }
    }

    return results;
  });

  // Print all elements grouped by visibility
  const visible = elements.filter((e) => e.visible);
  const hidden = elements.filter((e) => !e.visible);

  console.log(`=== VISIBLE ELEMENTS (${visible.length}) ===\n`);
  visible.forEach((el, i) => {
    console.log(`  [${i}] <${el.tag}> ${el.size} | matched: ${el.selector}`);
    if (el.text) console.log(`       text: "${el.text}"`);
    if (el.value) console.log(`       value: "${el.value}"`);
    if (el.placeholder) console.log(`       placeholder: "${el.placeholder}"`);
    if (el.class) console.log(`       class: "${el.class}"`);
    if (el.id) console.log(`       id: "${el.id}"`);
    if (el.role) console.log(`       role: "${el.role}"`);
    if (el.ariaLabel) console.log(`       aria-label: "${el.ariaLabel}"`);
    if (el.href) console.log(`       href: "${el.href}"`);
    console.log();
  });

  console.log(`\n=== HIDDEN ELEMENTS (${hidden.length}) ===\n`);
  hidden.forEach((el, i) => {
    console.log(`  [${i}] <${el.tag}> | matched: ${el.selector}`);
    if (el.text) console.log(`       text: "${el.text}"`);
    if (el.class) console.log(`       class: "${el.class}"`);
    console.log();
  });

  // --- Specifically search for date-like text patterns ---
  console.log("\n[5] Searching for date-like text patterns (DD/MM/YY, YYYY-MM-DD, etc.):\n");
  const dateElements = await page.evaluate(() => {
    const datePatterns = [
      /\d{1,2}\/\d{1,2}\/\d{2,4}/,    // DD/MM/YY or MM/DD/YYYY
      /\d{4}-\d{2}-\d{2}/,              // YYYY-MM-DD
      /\d{1,2}-\d{1,2}-\d{2,4}/,        // DD-MM-YY
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i, // Month names
      /\bdate\b/i,                       // word "date"
      /\btoday\b/i,
      /\byesterday\b/i,
      /\blast\s+\d+\s+days?\b/i,
      /\blast\s+(?:week|month|year)\b/i,
    ];

    const results = [];
    const allElements = document.querySelectorAll("*");

    for (const el of allElements) {
      // Only check direct text content (not children)
      const directText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent.trim())
        .join(" ");

      if (!directText) continue;

      for (const pattern of datePatterns) {
        if (pattern.test(directText)) {
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName.toLowerCase(),
            text: directText.slice(0, 100),
            class: el.className?.toString?.().slice(0, 120) || "",
            pattern: pattern.toString(),
            visible: rect.width > 0 && rect.height > 0,
            size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            pos: `(${Math.round(rect.x)}, ${Math.round(rect.y)})`,
          });
          break; // One match per element is enough
        }
      }
    }
    return results;
  });

  if (dateElements.length === 0) {
    console.log("  (No elements with date-like text found!)");
  } else {
    dateElements.forEach((el, i) => {
      console.log(`  [${i}] <${el.tag}> ${el.visible ? "VISIBLE" : "HIDDEN"} ${el.size} @ ${el.pos}`);
      console.log(`       text: "${el.text}"`);
      console.log(`       class: "${el.class}"`);
      console.log(`       matched pattern: ${el.pattern}`);
      console.log();
    });
  }

  // --- Check for the specific selectors that failed ---
  console.log("\n[6] Testing the three fallback selectors that failed:\n");
  const fallbackTests = [
    { name: 'button:has-text(" - ")', selector: 'button' , filter: 'text contains " - "' },
    { name: 'button:has-text("/")', selector: 'button', filter: 'text contains "/"' },
    { name: '[data-test="ViewAndExportDataButtons"] button', selector: '[data-test="ViewAndExportDataButtons"] button', filter: null },
  ];

  // Test selector 1: buttons with " - "
  const dashButtons = await page.$$('button:has-text(" - ")');
  console.log(`  [1] button:has-text(" - ") => ${dashButtons.length} matches`);
  for (const btn of dashButtons) {
    const info = await btn.evaluate((el) => ({
      text: el.textContent?.trim().slice(0, 80),
      class: el.className?.toString?.().slice(0, 120),
      visible: el.getBoundingClientRect().width > 0,
    }));
    console.log(`       text="${info.text}" class="${info.class}" visible=${info.visible}`);
  }

  // Test selector 2: buttons with "/"
  const slashButtons = await page.$$('button:has-text("/")');
  console.log(`  [2] button:has-text("/") => ${slashButtons.length} matches`);
  for (const btn of slashButtons) {
    const info = await btn.evaluate((el) => ({
      text: el.textContent?.trim().slice(0, 80),
      class: el.className?.toString?.().slice(0, 120),
      visible: el.getBoundingClientRect().width > 0,
    }));
    console.log(`       text="${info.text}" class="${info.class}" visible=${info.visible}`);
  }

  // Test selector 3: data-test attribute
  const dataTestButtons = await page.$$('[data-test="ViewAndExportDataButtons"] button');
  console.log(`  [3] [data-test="ViewAndExportDataButtons"] button => ${dataTestButtons.length} matches`);
  for (const btn of dataTestButtons) {
    const info = await btn.evaluate((el) => ({
      text: el.textContent?.trim().slice(0, 80),
      class: el.className?.toString?.().slice(0, 120),
      visible: el.getBoundingClientRect().width > 0,
    }));
    console.log(`       text="${info.text}" class="${info.class}" visible=${info.visible}`);
  }

  // --- Also dump the page URL and title for sanity check ---
  console.log(`\n[7] Page state:`);
  console.log(`    URL: ${page.url()}`);
  console.log(`    Title: ${await page.title()}`);

  console.log(`\n[DONE] Check screenshot at ${SCREENSHOT}`);
  console.log(`       Total visible interactive elements: ${visible.length}`);
  console.log(`       Total hidden interactive elements: ${hidden.length}`);
  console.log(`       Total date-pattern elements: ${dateElements.length}`);

  await browser.close();
})();
