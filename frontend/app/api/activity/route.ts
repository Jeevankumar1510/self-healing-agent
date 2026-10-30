import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const baseUrl = process.env.METRICS_API_URL ?? "http://127.0.0.1:8000";
const hostedPreview = process.env.VERCEL === "1";

async function forward(request: Request, method: "GET" | "DELETE") {
  if (hostedPreview) {
    return NextResponse.json(
      { detail: "Activity history is stored on the shared PC. Open its Cloudflare Tunnel HTTPS link to view it." },
      { status: 503 },
    );
  }

  const incoming = new URL(request.url);
  const query = method === "GET" ? `?${incoming.searchParams}` : "";
  try {
    const response = await fetch(`${baseUrl}/api/activity${query}`, {
      method,
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
      { detail: "The local activity history service is unavailable." },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function DELETE(request: Request) {
  return forward(request, "DELETE");
}
