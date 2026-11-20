import { requireUser } from "@/lib/auth";
import { authorize, ForbiddenError } from "@/lib/authz";
import { ActionFailure } from "@/lib/run-action";
import { assertGuestReady } from "@/modules/messages/guests";
import { fetchGif } from "@/modules/messages/klipy";
import { gifUrlForViewer } from "@/modules/messages/service";

// A GIF in a chat, fetched from KLIPY by our server and shown from our own address, so KLIPY never sees who is looking. Only a current
// member may open it; the address was checked when it was sent and is checked again here; nothing else can be fetched through this route.

const HEADERS = { "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:", "X-Frame-Options": "SAMEORIGIN" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const actor = await requireUser({ allowGuest: true });
  const { messageId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(messageId)) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "messages.use", { ownerUserId: actor.id });
    await assertGuestReady(actor);
    const gif = await fetchGif(await gifUrlForViewer(actor, messageId));
    if (!gif) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(gif.bytes), { headers: { "Content-Type": gif.mime, "Content-Length": String(gif.bytes.length), ...HEADERS } });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("chat gif failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
