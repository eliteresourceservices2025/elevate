import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/modules/audit/write";
import { openContentFile } from "@/modules/announcements/content-files";

// A picture or file of an announcement or policy, for signed-in people who may read it (see openContentFile). Pictures show in the
// page; documents download. Served by the app, never a public link.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireUser();
  const { id } = await params;
  try {
    const file = await openContentFile(viewer, id);
    if (!file) return new Response("Not found", { status: 404 });
    const headers: Record<string, string> = {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (file.kind === "file") {
      const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
      headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
      await writeAudit({ actor: viewer, action: "content.file_view", targetType: "content_file", targetId: file.id }).catch(() => {});
    }
    return new Response(Buffer.from(file.bytes), { headers });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
