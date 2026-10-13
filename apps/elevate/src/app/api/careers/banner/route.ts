import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { MAX_BANNER_BYTES, readBanner, saveBanner } from "@/modules/recruiting/careers-banner";

// GET: the careers page banner, public (the careers page is public). Cached by address: the page adds ?v=<time changed>.
// POST: staff with the permission upload a new one (already cropped by the browser; the server checks it again).

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const bytes = await readBanner();
  if (!bytes) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
  });
}

export async function POST(request: Request) {
  const actor = await requireUser();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BANNER_BYTES + 50_000) return json({ ok: false, error: "That picture is too large. Choose a smaller one." }, 413);
  if (!(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the picture. Please try again." }, 400);
  }
  const file = form.get("banner");
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: "Choose a picture first." }, 400);
  if (file.size > MAX_BANNER_BYTES) return json({ ok: false, error: "That picture is too large. Choose a smaller one." }, 413);

  try {
    const result = await saveBanner(actor, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    revalidatePath("/careers");
    revalidatePath("/recruiting/careers-page");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    console.error("careers banner failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
