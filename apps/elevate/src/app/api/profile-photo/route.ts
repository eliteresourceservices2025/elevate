import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { MAX_PHOTO_BYTES } from "@/modules/people/photo";
import { saveOwnPhoto } from "@/modules/people/photo-service";

// The signed-in person uploads their own photo. The browser has already cropped it to a small square JPEG; the server re-checks it and
// stores only a cleaned copy (see cleanProfilePhoto).

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const actor = await requireUser();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_PHOTO_BYTES + 50_000) return json({ ok: false, error: "That picture is too large. Choose a smaller one." }, 413);
  if (!(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the picture. Please try again." }, 400);
  }
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: "Choose a picture first." }, 400);
  if (file.size > MAX_PHOTO_BYTES) return json({ ok: false, error: "That picture is too large. Choose a smaller one." }, 413);

  try {
    const result = await saveOwnPhoto(actor, new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    revalidatePath("/", "layout");
    return json({ ok: true });
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    console.error("profile photo failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
