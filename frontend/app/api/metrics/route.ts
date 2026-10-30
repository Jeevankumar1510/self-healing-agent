import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const hostedPreview = process.env.VERCEL === "1";

const allowedParameters = [
  "interval",
  "cpu_threshold",
  "memory_threshold",
  "disk_threshold",
] as const;

export async function GET(request: Request) {
  if (hostedPreview) {
    return NextResponse.json(
      { detail: "Browser-only mode cannot read this computer's CPU, memory, processes, or disk. Full system monitoring requires a small local agent on the computer being monitored." },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of allowedParameters) {
    const value = incoming.searchParams.get(key);
    if (value !== null) query.set(key, value);
  }

  const baseUrl = process.env.METRICS_API_URL ?? "http://127.0.0.1:8000";
  try {
    const response = await fetch(`${baseUrl}/api/metrics?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const body: unknown = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    if (!(error instanceof Error) || !["AbortError", "TimeoutError", "TypeError", "SyntaxError"].includes(error.name)) {
      throw error;
    }
    return NextResponse.json(
      { detail: "The local metrics service is unavailable. Start the Python API and try again." },
      { status: 503 },
    );
  }
}
