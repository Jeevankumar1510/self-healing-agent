import { NextResponse } from "next/server";
import {
  createSessionToken,
  MINIMUM_PASSWORD_LENGTH,
  passwordsMatch,
  SESSION_COOKIE,
  SESSION_DURATION_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

const maximumFailedAttempts = 10;
const attemptWindowMs = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function getClientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local-client";
}

function clearExpiredAttempts(now: number) {
  for (const [key, attempts] of failedAttempts) {
    if (attempts.resetAt <= now) failedAttempts.delete(key);
  }
  while (failedAttempts.size >= 1000) {
    const oldestKey = failedAttempts.keys().next().value;
    if (oldestKey === undefined) break;
    failedAttempts.delete(oldestKey);
  }
}

export async function POST(request: Request) {
  const password = process.env.SHA_DASHBOARD_PASSWORD;
  if (!password || password.length < MINIMUM_PASSWORD_LENGTH) {
    return NextResponse.json(
      { detail: "The shared dashboard password is not configured securely on the host." },
      { status: 503 },
    );
  }

  const now = Date.now();
  clearExpiredAttempts(now);
  const clientKey = getClientKey(request);
  const attempts = failedAttempts.get(clientKey);
  if (attempts && attempts.resetAt > now && attempts.count >= maximumFailedAttempts) {
    const retryAfter = Math.ceil((attempts.resetAt - now) / 1000);
    return NextResponse.json(
      { detail: "Too many sign-in attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "Request body must be valid JSON." }, { status: 400 });
  }

  const submittedPassword =
    payload && typeof payload === "object" && "password" in payload && typeof payload.password === "string"
      ? payload.password
      : "";
  if (submittedPassword.length > 256 || !passwordsMatch(submittedPassword, password)) {
    const current = failedAttempts.get(clientKey);
    failedAttempts.set(clientKey, {
      count: current && current.resetAt > now ? current.count + 1 : 1,
      resetAt: current && current.resetAt > now ? current.resetAt : now + attemptWindowMs,
    });
    return NextResponse.json({ detail: "Incorrect password." }, { status: 401 });
  }

  failedAttempts.delete(clientKey);
  const expiresAt = now + SESSION_DURATION_SECONDS * 1000;
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE, createSessionToken(password, expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
  return response;
}
