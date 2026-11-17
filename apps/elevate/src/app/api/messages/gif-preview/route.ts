import { requireUser } from "@/lib/auth";
import { authorize, ForbiddenError } from "@/lib/authz";
import { ActionFailure } from "@/lib/run-action";
import { isAllowedGifUrl } from "@/modules/messages/gif-rules";
import { assertGuestReady } from "@/modules/messages/guests";
import { fetchGif } from "@/modules/messages/klipy";

// A small preview in the GIF picker, fetched by our server (the browser never contacts KLIPY). Only a signed-in person who may chat, and
// only https KLIPY addresses: this is not an open proxy.

export async function GET(request: Request) {
  const actor = await requireUser({ allowGuest: true });
  const target = new URL(request.url).searchParams.get("u");
  if (!isAllowedGifUrl(target)) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "messages.use", { ownerUserId: actor.id });
    await assertGuestReady(actor);
    const gif = await fetchGif(target);
    if (!gif) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(gif.bytes), {
      headers: { "Content-Type": gif.mime, "Content-Length": String(gif.bytes.length), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("chat gif preview failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
