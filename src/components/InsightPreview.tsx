"use client";

interface InsightPreviewProps {
  insights: string[];
  downloadUrl: string;
  onReset: () => void;
}

export default function InsightPreview({
  insights,
  downloadUrl,
  onReset,
}: InsightPreviewProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-green-600 text-xl">✓</span>
        <h2 className="text-lg font-semibold text-gray-900">Report Ready</h2>
      </div>

      {insights.length > 0 && (
        <div className="bg-gray-50 rounded-md p-4 mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Key Insights
          </h3>
          <ul className="space-y-1.5">
            {insights.map((insight, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2">
                <span className="text-blue-500 mt-0.5">•</span>
                {insight}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <a
          href={downloadUrl}
          download
          className="flex-1 py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 text-center transition-colors"
        >
          Download PPT
        </a>
        <button
          onClick={onReset}
          className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md text-sm hover:bg-gray-50 transition-colors"
        >
          New Report
        </button>
      </div>
    </div>
  );
}
