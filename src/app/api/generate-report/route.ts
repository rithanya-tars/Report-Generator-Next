import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createJob } from "@/lib/jobStore";
import { runPipeline } from "@/lib/orchestrator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.chatbotUrl || !body.prompt) {
      return NextResponse.json(
        { error: "chatbotUrl and prompt are required" },
        { status: 400 }
      );
    }

    // Create a job
    const jobId = `rpt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    createJob(jobId);

    // Run pipeline asynchronously (don't await — return immediately)
    runPipeline({
      jobId,
      chatbotUrl: body.chatbotUrl,
      prompt: body.prompt,
      clientLogo: body.clientLogo || null,
      dateRange: body.dateRange || null,
      reportType: body.reportType || "deck",
    }).catch((err) => {
      console.error(`[generate-report] Pipeline error for ${jobId}:`, err);
    });

    return NextResponse.json({ jobId, status: "processing" });
  } catch (err) {
    console.error("[generate-report] Request error:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
