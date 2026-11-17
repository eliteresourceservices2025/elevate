import { requireUser } from "@/lib/auth";
import { authorize, ForbiddenError } from "@/lib/authz";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { loadAttachmentForViewer } from "@/modules/messages/uploads";

// A file, picture or voice note from a chat, shown or played inside the page. Our own authenticated route, never a storage link:
// the person must be a current member who may see the message it belongs to (from their join time on; not removed). Pictures and
// voice are shown inline, other files are saved. Never cached, never sniffed, and the response can load nothing.

const COMMON = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'", "X-Frame-Options": "SAMEORIGIN" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser({ allowGuest: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "messages.use", { ownerUserId: actor.id });
    const file = await loadAttachmentForViewer(actor, id);
    // A document someone opens is worth a trace (ids and the kind only, never the name); pictures and voice notes are not.
    if (file.kind === "file") await writeAudit({ actor, action: "chat.attachment.view", targetType: "chat_attachment", targetId: id, metadata: { conversationId: file.conversationId } });
    const inline = file.kind !== "file";
    // A plain ASCII fallback name for old browsers (the real name follows in filename*); quotes and backslashes are never allowed in it.
    const asciiName = Array.from(file.name, (ch) => (ch >= " " && ch <= "~" && ch !== '"' && ch !== String.fromCharCode(92) ? ch : "_")).join("");
    const disposition = inline ? "inline" : `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    return new Response(Buffer.from(file.bytes), { headers: { "Content-Type": file.mime, "Content-Disposition": disposition, "Content-Length": String(file.bytes.length), ...COMMON } });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    if (error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("chat attachment failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
