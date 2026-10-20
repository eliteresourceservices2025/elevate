import { NextResponse } from "next/server";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { getPublicOpening } from "@/modules/recruiting/queries";
import { baseUrl, corsHeaders, parseOrigins, toFeedJob } from "@/modules/recruiting/public-feed";

// One open job with its full description (Markdown). Same rules as the list: public, read only, open jobs only, cached for a minute.

export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=60, stale-while-revalidate=300";

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: { ...corsHeaders(request.headers.get("origin"), parseOrigins(process.env.CAREERS_FEED_ALLOWED_ORIGINS)), "Cache-Control": CACHE } });
}

export async function GET(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const cors = corsHeaders(request.headers.get("origin"), parseOrigins(process.env.CAREERS_FEED_ALLOWED_ORIGINS));
  if (!(await allowRequest("careersFeed", await clientIp()))) return NextResponse.json({ error: "Too many requests. Please try again in a few minutes." }, { status: 429, headers: { ...cors, "Cache-Control": "no-store" } });
  const opening = await getPublicOpening((await ctx.params).slug);
  if (!opening) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { ...cors, "Cache-Control": "public, s-maxage=30" } });
  return NextResponse.json({ job: toFeedJob(opening, baseUrl(process.env.NEXT_PUBLIC_APP_URL), { withDescription: true }) }, { headers: { ...cors, "Cache-Control": CACHE, "X-Content-Type-Options": "nosniff" } });
}
