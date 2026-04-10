// File-based job store — survives Next.js module context splits
import * as fs from "fs";
import * as path from "path";

const REPORTS_DIR = process.env.REPORTS_DIR || "/tmp/reports";

export interface Job {
  id: string;
  status: "processing" | "completed" | "failed";
  progress: string;
  phase: "fetching" | "analyzing" | "generating" | "done";
  error?: string;
  insights?: string[];
  outputPath?: string;
  createdAt: string;
}

function jobPath(id: string): string {
  return path.join(REPORTS_DIR, id, "job.json");
}

export function createJob(id: string): Job {
  const job: Job = {
    id,
    status: "processing",
    progress: "Starting...",
    phase: "fetching",
    createdAt: new Date().toISOString(),
  };
  const dir = path.join(REPORTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(jobPath(id), JSON.stringify(job, null, 2));
  return job;
}

export function getJob(id: string): Job | undefined {
  const p = jobPath(id);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Job;
  } catch {
    return undefined;
  }
}

export function updateJob(id: string, updates: Partial<Job>) {
  const job = getJob(id);
  if (!job) return;
  Object.assign(job, updates);
  fs.writeFileSync(jobPath(id), JSON.stringify(job, null, 2));
}
