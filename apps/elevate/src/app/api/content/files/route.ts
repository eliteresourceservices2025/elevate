import { NextResponse } from "next/server";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { MAX_IMAGE_BYTES, uploadContentFile } from "@/modules/announcements/content-files";
import { MAX_FILE_BYTES } from "@/modules/documents/files";

// Staff who write announcements and policies upload a picture (already cropped and re-encoded by the browser; checked again here) or a
// PDF/Word file. It waits as "pending" until the item is saved. Nothing is public: files are served by /api/content/files/[id].

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const actor = await requireUser();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 100_000) return json({ ok: false, error: "A file can be up to 10 MB." }, 413);
  if (!(await allowRequest("upload", actor.id))) return json({ ok: false, error: "Too many uploads. Wait a few minutes and try again." }, 429);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "We could not read the file. Please try again." }, 400);
  }
  const kind = form.get("kind") === "image" ? "image" : form.get("kind") === "file" ? "file" : null;
  const file = form.get("file");
  if (!kind || !(file instanceof File) || file.size === 0) return json({ ok: false, error: "Choose a file first." }, 400);
  if (kind === "image" && file.size > MAX_IMAGE_BYTES) return json({ ok: false, error: "That picture is too large. Choose a smaller one." }, 413);
  if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: "A file can be up to 10 MB." }, 413);

  try {
    const result = await uploadContentFile(actor, { kind, bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name });
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    return json({ ok: true, file: result.file });
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ ok: false, error: "You do not have access to do that." }, 403);
    console.error("content file upload failed:", error instanceof Error ? error.name : "unknown error");
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
}
