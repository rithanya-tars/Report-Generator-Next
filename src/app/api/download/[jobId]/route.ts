import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobStore";
import * as fs from "fs";

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const job = getJob(params.jobId);

  if (!job) {
    return NextResponse.json(
      { error: "Job not found" },
      { status: 404 }
    );
  }

  if (job.status !== "completed" || !job.outputPath) {
    return NextResponse.json(
      { error: "Report not ready yet" },
      { status: 400 }
    );
  }

  if (!fs.existsSync(job.outputPath)) {
    return NextResponse.json(
      { error: "Report file not found on disk" },
      { status: 500 }
    );
  }

  const fileBuffer = fs.readFileSync(job.outputPath);
  const isPdf = job.outputPath.endsWith(".pdf");
  const ext = isPdf ? "pdf" : "pptx";
  const contentType = isPdf
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  const filename = `bot_report_${params.jobId}.${ext}`;

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": fileBuffer.length.toString(),
    },
  });
}
