import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ActionFailure } from "@/lib/run-action";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { openSigningDocument } from "@/modules/signing/document";

// The document, shown inside the page (an iframe), not downloaded: the same checks as the download link, then the PDF's bytes with
// "inline". Served from this site, not from storage, so the browser's own PDF viewer can show it. Never cached.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const doc = await openSigningDocument(actor, id);
    const bytes = await getDocumentStorage().read(BUCKETS.signed, doc.path);
    if (!bytes) return new Response("Not found", { status: 404 });
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="document.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || (error instanceof ActionFailure && /not found/i.test(error.message))) return new Response("Not found", { status: 404 });
    if (error instanceof ActionFailure) return new Response(error.message, { status: 429 });
    console.error("document view failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
