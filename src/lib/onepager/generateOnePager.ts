import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { AnalysisResult } from "../analysis/runAnalysis";

export interface OnePagerInput {
  workDir: string;
  analysisResult: AnalysisResult;
  clientLogo: string | null;
  prompt: string;
}

/**
 * Generates a one-page PDF report:
 *   1. Writes deck_input.json with locked numbers + asset paths
 *   2. Runs one_pager.py → generates report.html (and report.pdf if pdfkit available)
 *   3. If no PDF was created, uses Playwright to render HTML → PDF
 */
export async function generateOnePager(input: OnePagerInput): Promise<string> {
  const { workDir, analysisResult, clientLogo } = input;

  // Save client logo to disk if provided
  let logoPath: string | null = null;
  if (clientLogo) {
    logoPath = path.join(workDir, "client_logo.png");
    const base64Data = clientLogo.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(logoPath, Buffer.from(base64Data, "base64"));
  }

  // Write deck_input.json for the Python script
  fs.writeFileSync(
    path.join(workDir, "deck_input.json"),
    JSON.stringify(
      {
        locked_numbers: analysisResult.lockedNumbers,
        logo_path: logoPath,
        prompt: input.prompt,
      },
      null,
      2
    ),
    "utf-8"
  );

  const onePagerScript = path.resolve(
    process.cwd(),
    "src/lib/python/one_pager.py"
  );

  // ── Run one_pager.py ──
  console.log("[generateOnePager] Running one_pager.py...");
  try {
    const output = execSync(`python "${onePagerScript}" "${workDir}"`, {
      timeout: 180000, // 3 min — includes Claude API call
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    console.log(`[generateOnePager] one_pager.py output: ${output.toString()}`);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    throw new Error(`one_pager.py failed:\n${stderr}\n${stdout}`.trim());
  }

  // ── Check for PDF output ──
  const pdfPath = path.join(workDir, "report.pdf");
  if (fs.existsSync(pdfPath)) {
    console.log(`[generateOnePager] PDF ready at ${pdfPath}`);
    return pdfPath;
  }

  // ── Fallback: use Playwright to render HTML → PDF ──
  const htmlPath = path.resolve(workDir, "report.html");
  if (!fs.existsSync(htmlPath)) {
    throw new Error("one_pager.py ran but neither report.pdf nor report.html was created");
  }

  console.log("[generateOnePager] Converting HTML to PDF via Playwright...");
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  await page.goto(fileUrl, {
    waitUntil: "load",
    timeout: 30000,
  });

  await page.pdf({
    path: pdfPath,
    width: "280mm",
    height: "160mm",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });

  await browser.close();

  console.log(`[generateOnePager] PDF saved to ${pdfPath}`);
  return pdfPath;
}
