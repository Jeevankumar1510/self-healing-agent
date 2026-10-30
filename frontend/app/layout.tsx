import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Self-Healing PC Agent",
  description: "Local system health monitoring and diagnostics dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
