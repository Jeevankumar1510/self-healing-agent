import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { hasMfaAssurance } from "@/lib/supabase/claims";

const publicPaths = new Set(["/login", "/auth/callback"]);
const lowerAssurancePaths = new Set(["/mfa", "/set-password"]);

function copyCookies(source: NextResponse, destination: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie));
  return destination;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (publicPaths.has(pathname)) return NextResponse.next();
    return new NextResponse(
      "Authentication is not configured. Set the Supabase project URL and publishable key, then redeploy.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error && !publicPaths.has(pathname)) {
    if (pathname.startsWith("/api/")) {
      return copyCookies(response, NextResponse.json({ detail: "Could not verify the sign-in session." }, { status: 503 }));
    }
    return copyCookies(response, NextResponse.redirect(new URL("/login?error=session", request.url)));
  }

  if (publicPaths.has(pathname)) return response;

  if (!claims?.sub) {
    if (pathname.startsWith("/api/")) {
      return copyCookies(response, NextResponse.json({ detail: "Sign in to continue." }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return copyCookies(response, NextResponse.redirect(loginUrl));
  }

  const completedMfa = hasMfaAssurance(claims);
  if (pathname === "/mfa" && completedMfa) {
    return copyCookies(response, NextResponse.redirect(new URL("/", request.url)));
  }

  if (!completedMfa && !lowerAssurancePaths.has(pathname)) {
    if (pathname.startsWith("/api/")) {
      return copyCookies(response, NextResponse.json({ detail: "Complete authenticator MFA to continue." }, { status: 403 }));
    }
    return copyCookies(response, NextResponse.redirect(new URL("/mfa", request.url)));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
