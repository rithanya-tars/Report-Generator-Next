import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bot Report Generator",
  description: "Automated chatbot performance report generation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
