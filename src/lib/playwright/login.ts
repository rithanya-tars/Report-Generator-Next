import { chromium, Browser } from "playwright";
import * as path from "path";
import * as fs from "fs";

/**
 * Launches a headless browser with a valid Tars session.
 * Supports email/password login via TARS_EMAIL / TARS_PASSWORD env vars,
 * or falls back to saved session cookies from auth.json.
 */
export async function loginAndFetchData(): Promise<Browser> {
  const authPath = path.resolve(process.cwd(), "auth.json");
  const email = process.env.TARS_EMAIL;
  const password = process.env.TARS_PASSWORD;

  let browser: Browser;

  if (email && password) {
    // --- Email/password login ---
    browser = await chromium.launch({
      headless: false,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto("https://app.hellotars.com/login", { timeout: 60000 });
    await page.waitForTimeout(5000);

    await page.fill('input[type="email"], input[name="email"]', email);
    await page.fill('input[type="password"], input[name="password"]', password);
    await page.click('button[type="submit"]', { force: true });

    await page.waitForTimeout(10000);

    if (page.url().includes("login")) {
      await browser.close();
      throw new Error(
        "Login failed — check TARS_EMAIL and TARS_PASSWORD"
      );
    }

    await context.storageState({ path: authPath });
    console.log("[login] Logged in with email/password");
  } else {
    // --- Fallback: auth.json cookie login ---
    if (!fs.existsSync(authPath)) {
      throw new Error(
        "auth.json not found. Generate it with:\n  npx playwright open --save-storage=auth.json https://admin.hellotars.com"
      );
    }

    browser = await chromium.launch({
      headless: false,
    });
    const context = await browser.newContext({ storageState: authPath });
    const page = await context.newPage();

    await page.goto("https://admin.hellotars.com/home/#/convbots", {
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    if (currentUrl.includes("login") || currentUrl.includes("signin")) {
      await browser.close();
      throw new Error(
        "Session expired. Refresh cookies with:\n  npx playwright open --save-storage=auth.json https://admin.hellotars.com"
      );
    }
  }

  // Verify session works on admin panel
  const verifyContext = browser.contexts()[0];
  const verifyPage = verifyContext.pages()[0];
  await verifyPage.goto("https://admin.hellotars.com/home/#/convbots", {
    timeout: 60000,
  });
  await verifyPage.waitForTimeout(5000);

  return browser;
}
