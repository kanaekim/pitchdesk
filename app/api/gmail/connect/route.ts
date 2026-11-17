import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { authUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.APP_URL) {
    return new NextResponse("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL must be set.", { status: 500 });
  }
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(state));
  res.cookies.set("pd_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
