import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobStore";

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

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    phase: job.phase,
    ...(job.status === "completed" && {
      insights: job.insights || [],
    }),
    ...(job.status === "failed" && {
      error: job.error,
    }),
  });
}
