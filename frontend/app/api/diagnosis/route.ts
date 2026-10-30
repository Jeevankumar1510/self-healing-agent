import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const baseUrl = process.env.METRICS_API_URL ?? "http://127.0.0.1:8000";
const hostedPreview = process.env.VERCEL === "1";

export async function GET() {
  if (hostedPreview) {
    return NextResponse.json({
      configured: false,
      provider: "OpenAI",
      model: "gpt-4o-mini",
      hosted_preview: true,
    });
  }

  try {
    const response = await fetch(`${baseUrl}/api/diagnosis/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const body: unknown = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    if (!(error instanceof Error) || !["AbortError", "TimeoutError", "TypeError", "SyntaxError"].includes(error.name)) {
      throw error;
    }
    return NextResponse.json(
      { detail: "The local diagnosis service is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (hostedPreview) {
    return NextResponse.json(
      { detail: "System diagnosis requires metrics from a local monitoring agent; it is unavailable in browser-only mode." },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl}/api/diagnosis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });
    const body: unknown = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    if (!(error instanceof Error) || !["AbortError", "TimeoutError", "TypeError", "SyntaxError"].includes(error.name)) {
      throw error;
    }
    return NextResponse.json(
      { detail: "The local diagnosis request timed out or the API is unavailable. Try again." },
      { status: 503 },
    );
  }
}
