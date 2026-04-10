import { Page } from "playwright";

/**
 * Checks for the "Super Admin Mode" gate and clicks "Enter" if it appears.
 * Accepts the confirm() dialog that asks about jumping into Super Admin Mode,
 * waits for the jump_session redirect to complete, then navigates back to targetUrl.
 * Call this after every page.goto() in the scraping modules.
 */
export async function handleSuperAdminGate(page: Page, targetUrl?: string): Promise<void> {
  try {
    const enterLink = page.locator('a:has-text("Enter"), button:has-text("Enter")');
    const visible = await enterLink.first().isVisible({ timeout: 3000 }).catch(() => false);
    if (visible) {
      console.log("[SuperAdminGate] Detected — setting up dialog handler and clicking Enter...");

      // Set up dialog handler BEFORE clicking to auto-accept the confirm() dialog
      page.on('dialog', async (dialog) => {
        console.log("[SuperAdminGate] Dialog detected:", dialog.message());
        await dialog.accept();
      });

      // Click without force — let it trigger the confirm() naturally
      await enterLink.first().click();

      // Wait for the jump_session redirect to complete
      await page.waitForTimeout(5000);
      console.log("[SuperAdminGate] Jump session completed. Current URL:", page.url());

      // Navigate back to the target page if provided
      if (targetUrl) {
        console.log(`[SuperAdminGate] Navigating back to ${targetUrl}`);
        await page.goto(targetUrl, { timeout: 60000 });
        await page.waitForTimeout(5000);
        // Force reload to ensure SPA components mount after admin session switch
        await page.reload({ timeout: 60000 });
        await page.waitForTimeout(10000);
      }
    }
  } catch {
    // Gate not present — continue normally
  }
}
