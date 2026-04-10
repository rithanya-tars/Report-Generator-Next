import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { AnalysisResult } from "../analysis/runAnalysis";

export interface DeckInput {
  workDir: string;
  analysisResult: AnalysisResult;
  clientLogo: string | null;
  prompt: string;
}

/**
 * Generates a PowerPoint deck using the deterministic Python pipeline:
 *   1. Writes deck_input.json with locked numbers + asset paths
 *   2. Runs claude_analyst.py → calls Claude API → writes slide_plan.json
 *   3. Runs pptx_generator.py → reads slide_plan + locked_numbers → builds report.pptx
 */
export async function generateDeck(input: DeckInput): Promise<string> {
  const { workDir, analysisResult, clientLogo, prompt } = input;

  // Save client logo to disk if provided
  let logoPath: string | null = null;
  if (clientLogo) {
    logoPath = path.join(workDir, "client_logo.png");
    const base64Data = clientLogo.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(logoPath, Buffer.from(base64Data, "base64"));
  }

  // Write deck_input.json for the Python scripts to consume
  fs.writeFileSync(
    path.join(workDir, "deck_input.json"),
    JSON.stringify(
      {
        locked_numbers: analysisResult.lockedNumbers,
        logo_path: logoPath,
        prompt,
      },
      null,
      2
    ),
    "utf-8"
  );

  const pythonDir = path.resolve(process.cwd(), "src/lib/python");
  const analystScript = path.join(pythonDir, "claude_analyst.py");
  const pptxScript = path.join(pythonDir, "pptx_generator.py");

  // ── Step 1: Run claude_analyst.py → slide_plan.json ──
  console.log("[generateDeck] Running claude_analyst.py...");
  try {
    const output = execSync(`python "${analystScript}" "${workDir}"`, {
      timeout: 300000, // 5 min — Claude API call involved
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    console.log(`[generateDeck] claude_analyst.py output: ${output.toString()}`);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    throw new Error(
      `claude_analyst.py failed:\n${stderr}\n${stdout}`.trim()
    );
  }

  const slidePlanPath = path.join(workDir, "slide_plan.json");
  if (!fs.existsSync(slidePlanPath)) {
    throw new Error("claude_analyst.py ran but slide_plan.json was not created");
  }

  // ── Step 2: Run pptx_generator.py → report.pptx ──
  console.log("[generateDeck] Running pptx_generator.py...");
  try {
    const output = execSync(`python "${pptxScript}" "${workDir}"`, {
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    console.log(`[generateDeck] pptx_generator.py output: ${output.toString()}`);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    throw new Error(
      `pptx_generator.py failed:\n${stderr}\n${stdout}`.trim()
    );
  }

  const outputPath = path.join(workDir, "report.pptx");
  if (!fs.existsSync(outputPath)) {
    throw new Error("pptx_generator.py ran but report.pptx was not created");
  }

  console.log(`[generateDeck] Report saved to ${outputPath}`);
  return outputPath;
}
