"use client";

import { useState } from "react";

type ReportType = "one-pager" | "deck";

interface ReportFormProps {
  onSubmit: (data: {
    chatbotUrl: string;
    prompt: string;
    clientLogo: File | null;
    dateRange: { start: string; end: string } | null;
    reportType: ReportType;
  }) => void;
}

export default function ReportForm({ onSubmit }: ReportFormProps) {
  const [chatbotUrl, setChatbotUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const [clientLogo, setClientLogo] = useState<File | null>(null);
  const [reportType, setReportType] = useState<ReportType>("one-pager");
  const [showDateRange, setShowDateRange] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const handleSubmit = () => {
    if (!chatbotUrl.trim() || !prompt.trim()) return;

    onSubmit({
      chatbotUrl: chatbotUrl.trim(),
      prompt: prompt.trim(),
      clientLogo,
      dateRange:
        showDateRange && startDate && endDate
          ? { start: startDate, end: endDate }
          : null,
      reportType,
    });
  };

  const isValid = chatbotUrl.trim() && prompt.trim();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
      {/* Chatbot URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Chatbot Link
        </label>
        <input
          type="url"
          value={chatbotUrl}
          onChange={(e) => setChatbotUrl(e.target.value)}
          placeholder="https://app.tars.pro/bots/..."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Analysis Prompt */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          What analysis do you need?
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Analyze drop-off rates per gambit. Highlight the top 3 problem areas and suggest improvements."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
        />
      </div>

      {/* Report Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Report Type
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setReportType("one-pager")}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
              reportType === "one-pager"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            Monthly One-Pager (PDF)
          </button>
          <button
            type="button"
            onClick={() => setReportType("deck")}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium border transition-colors ${
              reportType === "deck"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            Quarterly Deck (PPT)
          </button>
        </div>
      </div>

      {/* Client Logo */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Client Logo{" "}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setClientLogo(e.target.files?.[0] || null)}
          className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
      </div>

      {/* Date Range (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setShowDateRange(!showDateRange)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {showDateRange ? "− Remove date filter" : "+ Add date range filter"}
        </button>
        {showDateRange && (
          <div className="flex gap-3 mt-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className="w-full py-2.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        Generate Report
      </button>
    </div>
  );
}
