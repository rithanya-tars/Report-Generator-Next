import { Browser } from "playwright";
import * as path from "path";
import * as fs from "fs";
import { extractBotId } from "./fetchConversations";

/**
 * Exports bot flow definition (con_data.json) by fetching the export API directly.
 */
export async function fetchConData(
  browser: Browser,
  chatbotUrl: string,
  workDir: string
): Promise<string> {
  const page = (await browser.contexts())[0]?.pages()[0];
  if (!page) throw new Error("No active page in browser context");

  const botId = extractBotId(chatbotUrl);

  // Scrape bot name from the page heading before fetching export data
  await page.goto(
    `https://admin.hellotars.com/conv/${botId}/#/data/view`,
    { timeout: 60000 }
  );
  await page.waitForTimeout(5000);

  const botName = await page.evaluate(() => {
    // Try common heading selectors where TARS shows the bot name
    const selectors = [
      'h1', 'h2', '.bot-name', '[class*="botName"]', '[class*="bot-name"]',
      '.conv-name', '[class*="convName"]', '[class*="conv-name"]',
      '.header-title', '[class*="headerTitle"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 1 && text.length < 100) {
        return text;
      }
    }
    // Fallback: look for text in the top nav/breadcrumb area
    const navEl = document.querySelector('nav, [class*="breadcrumb"], [class*="Breadcrumb"]');
    if (navEl?.textContent?.trim()) {
      return navEl.textContent.trim().split('\n')[0].trim();
    }
    return "";
  }).catch(() => "");

  if (botName) {
    console.log(`[fetchConData] Scraped bot name: "${botName}"`);
  } else {
    console.log("[fetchConData] Could not scrape bot name from page heading");
  }

  // Save bot_info.json with the scraped bot name
  const botInfoPath = path.join(workDir, "bot_info.json");
  fs.writeFileSync(botInfoPath, JSON.stringify({ bot_name: botName || "" }, null, 2), "utf-8");
  console.log(`[fetchConData] Saved bot_info.json`);

  // Fetch con_data JSON directly from the export API (cookies are already set)
  const jsonData = await page.evaluate(async (id) => {
    const res = await fetch(`/conv/${id}/export`);
    return await res.text();
  }, botId);

  // Validate it's valid JSON
  try {
    JSON.parse(jsonData);
  } catch {
    throw new Error("Fetched con_data is not valid JSON");
  }

  const outputPath = path.join(workDir, "con_data.json");
  fs.writeFileSync(outputPath, jsonData, "utf-8");

  console.log(
    `[fetchConData] Saved ${jsonData.length} chars to ${outputPath}`
  );
  return outputPath;
}
