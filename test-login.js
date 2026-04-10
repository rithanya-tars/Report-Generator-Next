const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const auth = JSON.parse(fs.readFileSync("auth.json", "utf-8"));

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  // Load cookies from auth.json
  await context.addCookies(auth.cookies);

  const page = await context.newPage();
  await page.goto("https://admin.hellotars.com/home/#/convbots", {
    timeout: 60000,
  });

  // Wait 5 seconds for any redirects or auth checks
  await page.waitForTimeout(5000);

  const url = page.url();
  if (url.includes("/login") || url.includes("/signin")) {
    console.log("SESSION EXPIRED — redirected to login page:", url);
  } else {
    console.log("SESSION VALID — current page:", url);
  }

  await browser.close();
})();
