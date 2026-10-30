import { NextRequest, NextResponse } from "next/server";
import { isValidSessionToken, SESSION_COOKIE } from "@/lib/auth";

export function proxy(request: NextRequest) {
  if (process.env.VERCEL === "1" || process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  const password = process.env.SHA_DASHBOARD_PASSWORD;
  if (!password || password.length < 16) {
    return new NextResponse(
      "The shared dashboard is locked. Configure SHA_DASHBOARD_PASSWORD with a passphrase of at least 16 characters, then restart the web server.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const path = request.nextUrl.pathname;
  if (path === "/login" || path === "/api/auth/login") {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (isValidSessionToken(token, password)) {
    return NextResponse.next();
  }

  if (path.startsWith("/api/")) {
    return NextResponse.json({ detail: "Sign in to use the shared PC dashboard." }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
