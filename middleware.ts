import { NextRequest, NextResponse } from "next/server";

/**
 * Shared-password auth gate.
 *
 * Enabled only when BOTH APP_PASSWORD and AUTH_SECRET are set — otherwise it's a
 * no-op (handy for local dev). Machine endpoints (Slack/Discord/Inngest/health)
 * are always exempt: they're called by external services and verify their own
 * signatures, so they must NOT sit behind the browser login.
 */
const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_API_PREFIXES = [
  "/api/login",
  "/api/logout",
  "/api/health",
  "/api/inngest",
  "/api/slack",
  "/api/discord",
];

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) return NextResponse.next(); // auth disabled

  const { pathname } = req.nextUrl;
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
  if (PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("rr_auth")?.value;
  if (token && token === (await sha256Hex(secret))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
