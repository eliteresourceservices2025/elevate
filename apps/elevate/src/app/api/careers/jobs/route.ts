import { NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { listPublicOpeningsWithDescriptions } from "@/modules/recruiting/queries";
import { baseUrl, corsHeaders, parseOrigins, toFeedJob } from "@/modules/recruiting/public-feed";

// The public job feed for the company's website (the WordPress plugin reads it, and any page may). No sign-in, no cookies, read only,
// and only what the public careers page already shows: open jobs, their title, place, pay note and a short summary. Applicants and
// every internal field stay out. A browser on another site may read it only if its address is listed in CAREERS_FEED_ALLOWED_ORIGINS
// (a server, like WordPress's own PHP, needs no permission). Cached for a minute by the network in front, so a job opened or closed
// shows on the site within about a minute.

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(request.headers.get("origin"), parseOrigins(process.env.CAREERS_FEED_ALLOWED_ORIGINS)), "Cache-Control": CACHE } });
}

export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"), parseOrigins(process.env.CAREERS_FEED_ALLOWED_ORIGINS));
  if (!(await allowRequest("careersFeed", await clientIp()))) return NextResponse.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429, headers: { ...cors, "Cache-Control": "no-store" } });
  const base = baseUrl(process.env.NEXT_PUBLIC_APP_URL);
  const openings = await listPublicOpeningsWithDescriptions();
  return NextResponse.json({ jobs: openings.map((o) => toFeedJob(o, base)), careersUrl: `${base}/careers` }, { headers: { ...cors, "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff" } });
}
