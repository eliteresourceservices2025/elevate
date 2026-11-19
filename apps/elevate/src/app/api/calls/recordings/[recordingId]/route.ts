import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ActionFailure } from "@/lib/run-action";
import { openRecording } from "@/modules/calls/recording";

// A finished call recording, played inside the page. Only people who were in that call (never a guest) and only before it expires; every
// play is audited. Our own authenticated route, never a storage link. The file plays from the start (no seeking in this version).

const HEADERS = {
  "Content-Type": "video/webm",
  "Content-Disposition": "inline",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

export async function GET(_request: Request, { params }: { params: Promise<{ recordingId: string }> }) {
  const actor = await requireUser();
  const { recordingId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return new Response("Not found", { status: 404 });
  try {
    return new Response(await openRecording(actor, recordingId), { headers: HEADERS });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("call recording failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
