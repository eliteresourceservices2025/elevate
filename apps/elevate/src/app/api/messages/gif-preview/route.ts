import { requireUser } from "@/lib/auth";
import { authorize, ForbiddenError } from "@/lib/authz";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { isAllowedGifUrl } from "@/modules/messages/gif-rules";
import { verifyGifSignature } from "@/modules/messages/gif-sign";
import { assertGuestReady } from "@/modules/messages/guests";
import { fetchGif } from "@/modules/messages/klipy";

// A small preview in the GIF picker, fetched by our server (the browser never contacts the GIF service). Only a signed-in person who may chat,
// only an address our own search returned (it carries our signature: ?u=<address>&s=<signature>), only an allowed media host, and a limit per
// person. This is not an open proxy.

export async function GET(request: Request) {
  const actor = await requireUser({ allowGuest: true });
  const params = new URL(request.url).searchParams;
  const target = params.get("u");
  if (!isAllowedGifUrl(target) || !verifyGifSignature(target, params.get("s"))) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "messages.use", { ownerUserId: actor.id });
    await assertGuestReady(actor);
    if (!(await allowRequest("gifPreview", actor.id))) return new Response("Too many requests", { status: 429 });
    const gif = await fetchGif(target);
    if (!gif) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(gif.bytes), {
      headers: { "Content-Type": gif.mime, "Content-Length": String(gif.bytes.length), "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("chat gif preview failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
