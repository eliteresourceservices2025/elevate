import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/modules/audit/write";
import { SafevoiceNotConfigured } from "@/modules/safevoice/handler-db";
import { getAttachment } from "@/modules/safevoice/queries";

// An attachment from a Safe Voice report, for designated handlers only. Files were rebuilt without metadata when they were sent; they have
// no real names, so the download is called "attachment-N". Every open is audited (case and attachment ids, never the content).

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, "safevoice.handle")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  try {
    const file = await getAttachment(id);
    if (!file) return new Response("Not found", { status: 404 });
    await writeAudit({ actor, action: "safevoice.attachment_view", targetType: "safevoice_case", targetId: file.reportId, after: { attachmentId: file.id } });
    const ext = file.contentType === "application/pdf" ? "pdf" : file.contentType === "image/png" ? "png" : "jpg";
    const inline = file.contentType !== "application/pdf";
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="attachment-${file.position}.${ext}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:",
      },
    });
  } catch (error) {
    if (error instanceof SafevoiceNotConfigured) return new Response("Not found", { status: 404 });
    throw error;
  }
}
