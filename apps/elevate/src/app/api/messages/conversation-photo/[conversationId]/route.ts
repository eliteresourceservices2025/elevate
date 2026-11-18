import { requireUser } from "@/lib/auth";
import { authorize, can, ForbiddenError } from "@/lib/authz";
import { ActionFailure } from "@/lib/run-action";
import { assertGuestReady } from "@/modules/messages/guests";
import { loadConversationPhoto } from "@/modules/messages/uploads";

// The picture of a group, channel or client group, served by our own route (never a storage link) to its members, and to the people who
// manage groups (so they can see it where they manage it). The address carries ?v=<picture id>, so a new picture shows at once.

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const actor = await requireUser({ allowGuest: true });
  const { conversationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "messages.use", { ownerUserId: actor.id });
    await assertGuestReady(actor);
    const photo = await loadConversationPhoto(actor, conversationId, can(actor, "messages.manage_group"));
    return new Response(Buffer.from(photo.bytes), {
      headers: { "Content-Type": photo.mime, "Content-Length": String(photo.bytes.length), "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("chat conversation photo failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
