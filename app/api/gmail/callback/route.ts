import { NextResponse, type NextRequest } from "next/server";
import { connectWithCode } from "@/lib/gmail";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const back = (msg: string) => {
    const dest = new URL("/settings", url.origin);
    dest.searchParams.set("gmail", msg);
    const res = NextResponse.redirect(dest);
    res.cookies.delete("pd_oauth_state");
    return res;
  };
  const err = url.searchParams.get("error");
  if (err) return back(`error: ${err}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("pd_oauth_state")?.value) return back("error: invalid state");
  try {
    const email = await connectWithCode(code);
    await logActivity(null, "gmail", `Gmail connected: ${email}`);
    return back("connected");
  } catch (e) {
    return back(`error: ${(e as Error).message}`);
  }
}
