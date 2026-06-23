import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/** Clear the session cookie and bounce to the login page. */
export async function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url));
  res.cookies.set("rr_auth", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
