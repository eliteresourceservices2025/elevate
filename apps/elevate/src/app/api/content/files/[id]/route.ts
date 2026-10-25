import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/modules/audit/write";
import { openContentFile } from "@/modules/announcements/content-files";

// A picture, file or video of an announcement or policy, for signed-in people who may read it (see openContentFile). Pictures show in
// the page; documents download; a video redirects to a short-lived storage link so the browser can seek. Never a public link.

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireUser();
  const { id } = await params;
  try {
    const file = await openContentFile(viewer, id);
    if (!file) return new Response("Not found", { status: 404 });
    if (file.kind === "video") {
      // A player asks for many ranges of one video: audit the start of a viewing only.
      const range = request.headers.get("range");
      if (!range || /^bytes=0-/.test(range)) await writeAudit({ actor: viewer, action: "content.video_view", targetType: "content_file", targetId: file.id }).catch(() => {});
      return new Response(null, { status: 307, headers: { Location: file.playbackUrl, "Cache-Control": "private, max-age=240", "X-Content-Type-Options": "nosniff" } }); // the link lives 300 s: reuse it for the many range requests of one viewing
    }
    if (file.kind === "file") {
      // A document goes straight from storage under a 60-second link (a function response is limited to a few MB on the host).
      await writeAudit({ actor: viewer, action: "content.file_view", targetType: "content_file", targetId: file.id }).catch(() => {});
      return new Response(null, { status: 307, headers: { Location: file.downloadUrl, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const headers: Record<string, string> = {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    return new Response(Buffer.from(file.bytes), { headers });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
