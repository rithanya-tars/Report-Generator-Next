import { updateJob } from "./jobStore";
import { loginAndFetchData } from "./playwright/login";
import { extractBotId } from "./playwright/fetchConversations";
import { fetchConversations } from "./playwright/fetchConversations";
import { fetchConData } from "./playwright/fetchConData";
import { fetchAnalytics } from "./playwright/fetchAnalytics";
import { runAnalysis } from "./analysis/runAnalysis";
import { generateDeck } from "./pptx/generateDeck";
import { generateOnePager } from "./onepager/generateOnePager";
import * as fs from "fs";
import * as path from "path";
import botMapping from "../../knowledge/bot_mapping.json";

const REPORTS_DIR = process.env.REPORTS_DIR || "/tmp/reports";

export interface PipelineInput {
  jobId: string;
  chatbotUrl: string;
  prompt: string;
  clientLogo: string | null;
  dateRange: { start: string; end: string } | null;
  reportType: "one-pager" | "deck";
}

export async function runPipeline(input: PipelineInput): Promise<void> {
  const workDir = path.join(REPORTS_DIR, input.jobId);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // ── Write request_info.json so Python adapter has access to user inputs ──
    const requestInfo = {
      dateRange: input.dateRange,
      prompt: input.prompt,
      reportType: input.reportType,
    };
    fs.writeFileSync(
      path.join(workDir, "request_info.json"),
      JSON.stringify(requestInfo, null, 2)
    );

    // ── Resolve & copy knowledge files ──────────────────────────────────────
    const knowledgeDir = path.join(__dirname, "../../knowledge");
    const tarsBrainPath = path.join(knowledgeDir, "_platform/tars_brain.md");
    if (fs.existsSync(tarsBrainPath)) {
      fs.copyFileSync(tarsBrainPath, path.join(workDir, "tars_brain.md"));
    }

    const botId = extractBotId(input.chatbotUrl);
    const clientFolder = (botMapping as Record<string, string>)[botId];
    if (clientFolder) {
      const dossierPath = path.join(
        knowledgeDir,
        `clients/${clientFolder}/dossier.md`
      );
      if (fs.existsSync(dossierPath)) {
        fs.copyFileSync(dossierPath, path.join(workDir, "client_dossier.md"));
      }
    }

    // ── Phase 1: Data Acquisition ──
    updateJob(input.jobId, {
      phase: "fetching",
      progress: "Logging into TARS...",
    });

    const browser = await loginAndFetchData();

    updateJob(input.jobId, { progress: "Downloading conversation data..." });
    await fetchConversations(browser, input.chatbotUrl, workDir, input.dateRange);

    updateJob(input.jobId, { progress: "Downloading bot structure..." });
    await fetchConData(browser, input.chatbotUrl, workDir);

    updateJob(input.jobId, { progress: "Capturing analytics..." });
    await fetchAnalytics(browser, input.chatbotUrl, workDir, input.dateRange);

    await browser.close();

    // ── Phase 2: Number Calculation (deterministic) ──
    updateJob(input.jobId, {
      phase: "analyzing",
      progress: "Calculating locked numbers from data...",
    });

    const analysisResult = await runAnalysis({
      workDir,
      prompt: input.prompt,
      dateRange: input.dateRange,
    });

    updateJob(input.jobId, {
      progress: "Numbers locked. Preparing slide plan...",
    });

    // ── Phase 3: Report Generation ──
    let outputPath: string;

    if (input.reportType === "one-pager") {
      updateJob(input.jobId, {
        phase: "generating",
        progress: "Generating one-pager PDF...",
      });

      outputPath = await generateOnePager({
        workDir,
        analysisResult,
        clientLogo: input.clientLogo,
        prompt: input.prompt,
      });
    } else {
      updateJob(input.jobId, {
        phase: "generating",
        progress: "Claude is writing insights & slide plan...",
      });

      outputPath = await generateDeck({
        workDir,
        analysisResult,
        clientLogo: input.clientLogo,
        prompt: input.prompt,
      });
    }

    // ── Done ──
    updateJob(input.jobId, {
      status: "completed",
      phase: "done",
      progress: "Report ready!",
      insights: analysisResult.insights,
      outputPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Pipeline ${input.jobId}] Failed:`, message);
    updateJob(input.jobId, {
      status: "failed",
      progress: "Failed",
      error: message,
    });
  }
}
