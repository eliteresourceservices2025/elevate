import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { readPhotoOf } from "@/modules/people/photo-service";

// A profile photo, for signed-in colleagues only (private bucket, served by the app, never a public link). The address carries ?v=<time of
// change>, so the browser may keep it and a new picture still shows at once.

export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const viewer = await requireUser();
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readPhotoOf(viewer, userId);
    if (!bytes) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(bytes), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
