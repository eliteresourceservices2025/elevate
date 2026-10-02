import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { STATE_COOKIE, completeConnection, sameState } from "@/modules/recruiting/calendar";
import { GoogleError } from "@/modules/recruiting/google";

// Step 2: Google sends the person back here with a one-time code. The state cookie must match, the session must be the same signed-in
// (MFA) person who started it, and they must be allowed to connect. Nothing from Google is shown to the browser except a status word.

export async function GET(request: Request) {
  const actor = await requireUser();
  const url = new URL(request.url);
  const back = (flag: string) => {
    const response = NextResponse.redirect(new URL(`/recruiting?calendar=${flag}`, request.url));
    response.cookies.delete({ name: STATE_COOKIE, path: "/api/google" });
    return response;
  };
  const jar = await cookies();
  if (!sameState(jar.get(STATE_COOKIE)?.value, url.searchParams.get("state"))) return back("failed");
  if (url.searchParams.get("error")) return back("denied"); // the person clicked Cancel on Google's screen
  const code = url.searchParams.get("code");
  if (!code) return back("failed");
  try {
    await completeConnection(actor, code);
    return back("connected");
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    console.error("google connect failed:", error instanceof GoogleError ? error.code : error instanceof Error ? error.name : "unknown error");
    return back("failed");
  }
}
