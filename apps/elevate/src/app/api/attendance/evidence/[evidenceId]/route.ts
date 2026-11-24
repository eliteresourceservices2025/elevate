import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { auditEvidenceView, authorizeEvidenceView, imageType } from "@/modules/attendance/service";

// A screenshot (a time claim, extra hours, a technical issue or a time off request's proof) shown inside the page. Same access rules as the
// download link (the person, their lead and HR), our own authenticated route and never a storage link, never cached. Thumbnails are not
// audited; the full-size viewer asks with ?view=1 and is audited once per open (ids only, never the picture).

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Disposition": "inline",
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
} as const;

export async function GET(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const actor = await requireUser();
  const { evidenceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(evidenceId)) return new Response("Not found", { status: 404 });
  try {
    if (!(await allowRequest("evidence", actor.id))) return new Response("Too many requests. Wait a few minutes.", { status: 429 });
    const ev = await authorizeEvidenceView(actor, evidenceId);
    const bytes = await getDocumentStorage().read(BUCKETS.employee, ev.storagePath);
    if (!bytes) return new Response("Not found", { status: 404 });
    const type = imageType(bytes); // judged by the file's bytes, never its name
    if (!type) return new Response("This file cannot be shown.", { status: 415 });
    if (new URL(request.url).searchParams.get("view") === "1") await auditEvidenceView(actor, ev);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": type, ...HEADERS } });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    if (error instanceof ActionFailure) return new Response("Not found", { status: 404 });
    console.error("evidence view failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
