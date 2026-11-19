import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ActionFailure } from "@/lib/run-action";
import { openGrantedRecording } from "@/modules/chat-access/queries";

// A call recording HR was granted (two administrators approved, 72 hours). Only the person who asked can play it; the approval, the hours and
// the request are checked on every request and every play is audited. Our own authenticated route, never a storage link.

const HEADERS = {
  "Content-Type": "video/webm",
  "Content-Disposition": "inline",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  await requireUser();
  const { requestId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return new Response("Not found", { status: 404 });
  try {
    return new Response(await openGrantedRecording(requestId), { headers: HEADERS });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("granted recording failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
