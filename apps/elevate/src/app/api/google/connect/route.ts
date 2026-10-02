import { NextResponse } from "next/server";
import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { STATE_COOKIE, newState, redirectUri } from "@/modules/recruiting/calendar";
import { getGoogleClient } from "@/modules/recruiting/google";

// Step 1 of connecting Google Calendar: only HR, Super Admin and recruiters, only for themselves. A random one-time value goes into a
// short-lived cookie and into Google's `state`; the callback refuses anything that does not match, so a link sent by someone else
// cannot attach their Google account to yours.

export async function GET(request: Request) {
  const actor = await requireUser();
  const back = (flag: string) => NextResponse.redirect(new URL(`/recruiting?calendar=${flag}`, request.url));
  try {
    await authorize(actor, "recruiting.connect_calendar", { ownerUserId: actor.id });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const client = getGoogleClient();
  if (!client) return back("not_configured");
  const state = newState();
  const response = NextResponse.redirect(client.authUrl(state, redirectUri()));
  response.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/google", maxAge: 600 });
  return response;
}
