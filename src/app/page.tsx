"use client";

import { useState } from "react";
import ReportForm from "@/components/ReportForm";
import ProgressTracker from "@/components/ProgressTracker";
import InsightPreview from "@/components/InsightPreview";

type AppState = "input" | "processing" | "completed" | "failed";

interface ReportResult {
  jobId: string;
  downloadUrl: string;
  insights: string[];
}

export default function Home() {
  const [state, setState] = useState<AppState>("input");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (formData: {
    chatbotUrl: string;
    prompt: string;
    clientLogo: File | null;
    dateRange: { start: string; end: string } | null;
    reportType: "one-pager" | "deck";
  }) => {
    setState("processing");
    setError(null);

    try {
      // Convert logo to base64 if provided
      let logoBase64: string | null = null;
      if (formData.clientLogo) {
        logoBase64 = await fileToBase64(formData.clientLogo);
      }

      // Kick off report generation
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatbotUrl: formData.chatbotUrl,
          prompt: formData.prompt,
          clientLogo: logoBase64,
          dateRange: formData.dateRange,
          reportType: formData.reportType,
        }),
      });

      if (!res.ok) throw new Error("Failed to start report generation");

      const { jobId: newJobId } = await res.json();
      setJobId(newJobId);

      // Poll for status
      await pollStatus(newJobId);
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const pollStatus = async (id: string) => {
    const maxAttempts = 120; // 6 minutes at 3s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const res = await fetch(`/api/report-status/${id}`);
      if (!res.ok) throw new Error("Failed to check status");

      const data = await res.json();
      setProgress(data.progress || "Working...");

      if (data.status === "completed") {
        setState("completed");
        setResult({
          jobId: id,
          downloadUrl: `/api/download/${id}`,
          insights: data.insights || [],
        });
        return;
      }

      if (data.status === "failed") {
        throw new Error(data.error || "Report generation failed");
      }
    }

    throw new Error("Report generation timed out");
  };

  const handleReset = () => {
    setState("input");
    setJobId(null);
    setProgress("");
    setResult(null);
    setError(null);
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Bot Report Generator
        </h1>
        <p className="text-gray-500 mb-8">
          Paste a chatbot link, describe the analysis you need, and get a
          downloadable PPT deck.
        </p>

        {state === "input" && <ReportForm onSubmit={handleSubmit} />}

        {state === "processing" && (
          <ProgressTracker progress={progress} jobId={jobId} />
        )}

        {state === "completed" && result && (
          <InsightPreview
            insights={result.insights}
            downloadUrl={result.downloadUrl}
            onReset={handleReset}
          />
        )}

        {state === "failed" && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-red-800 font-semibold mb-2">
              Generation Failed
            </h2>
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <button
              onClick={handleReset}
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
