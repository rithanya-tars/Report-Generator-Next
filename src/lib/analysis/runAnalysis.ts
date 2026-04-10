import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

export interface AnalysisInput {
  workDir: string;
  prompt: string;
  dateRange: { start: string; end: string } | null;
}

export interface AnalysisResult {
  lockedNumbers: any;
  insights: string[];
}

/**
 * Runs the deterministic Python adapter pipeline:
 *   1. Executes adapter.py which reads conversations.csv, con_data.json, analytics.json
 *   2. Produces locked_numbers.json with all pre-calculated numbers
 *   3. Returns the locked numbers for use in PPT generation
 *
 * No Claude involved — all numbers are deterministic.
 */
export async function runAnalysis(input: AnalysisInput): Promise<AnalysisResult> {
  const { workDir } = input;

  const adapterScript = path.resolve(process.cwd(), "src/lib/python/adapter.py");

  if (!fs.existsSync(adapterScript)) {
    throw new Error(`Adapter script not found: ${adapterScript}`);
  }

  console.log(`[runAnalysis] Running adapter.py on ${workDir}`);

  try {
    const output = execSync(`python "${adapterScript}" "${workDir}"`, {
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    console.log(`[runAnalysis] adapter.py output: ${output.toString()}`);
  } catch (err: any) {
    const stderr = err.stderr?.toString() || "";
    const stdout = err.stdout?.toString() || "";
    throw new Error(
      `adapter.py failed:\n${stderr}\n${stdout}`.trim()
    );
  }

  const lockedNumbersPath = path.join(workDir, "locked_numbers.json");
  if (!fs.existsSync(lockedNumbersPath)) {
    throw new Error("adapter.py ran but locked_numbers.json was not created");
  }

  const lockedNumbers = JSON.parse(
    fs.readFileSync(lockedNumbersPath, "utf-8")
  );

  console.log(
    `[runAnalysis] Locked numbers loaded with ${Object.keys(lockedNumbers).length} top-level keys`
  );

  return {
    lockedNumbers,
    insights: [], // Claude writes these later in the PPT phase
  };
}
