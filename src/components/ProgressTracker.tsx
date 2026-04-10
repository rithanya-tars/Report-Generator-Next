"use client";

const PHASES = [
  { key: "fetching", label: "Fetching data from TARS" },
  { key: "analyzing", label: "Analyzing conversations" },
  { key: "generating", label: "Building PPT deck" },
];

interface ProgressTrackerProps {
  progress: string;
  jobId: string | null;
}

export default function ProgressTracker({
  progress,
  jobId,
}: ProgressTrackerProps) {
  // Determine active phase from progress string
  const activeIndex = progress.toLowerCase().includes("ppt")
    ? 2
    : progress.toLowerCase().includes("analy")
      ? 1
      : 0;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
        <h2 className="text-lg font-semibold text-gray-900">
          Generating Report
        </h2>
      </div>

      <div className="space-y-4 mb-6">
        {PHASES.map((phase, i) => (
          <div key={phase.key} className="flex items-center gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                i < activeIndex
                  ? "bg-green-100 text-green-700"
                  : i === activeIndex
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              {i < activeIndex ? "✓" : i + 1}
            </div>
            <span
              className={`text-sm ${
                i === activeIndex
                  ? "text-gray-900 font-medium"
                  : i < activeIndex
                    ? "text-green-700"
                    : "text-gray-400"
              }`}
            >
              {phase.label}
            </span>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        {progress || "Starting up..."}
        {jobId && <span className="ml-2">• Job: {jobId.slice(0, 8)}</span>}
      </p>
    </div>
  );
}
