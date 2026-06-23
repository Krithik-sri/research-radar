import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

/** Verify the shared password and set the session cookie. */
export async function POST(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (!password || !secret) {
    // Auth disabled — nothing to log into.
    return NextResponse.json({ ok: true, note: "auth disabled" });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const supplied = typeof body.password === "string" ? body.password : "";
  const ok =
    supplied.length === password.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(password));
  if (!ok) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = crypto.createHash("sha256").update(secret).digest("hex");
  const res = NextResponse.json({ ok: true });
  res.cookies.set("rr_auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
