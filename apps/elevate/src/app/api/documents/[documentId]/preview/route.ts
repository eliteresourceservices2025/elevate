import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ActionFailure } from "@/lib/run-action";
import { PREVIEW_HTML_CSP } from "@/modules/documents/docx";
import { NOT_PREVIEWABLE, openDocumentPreview } from "@/modules/documents/service";

// A stored document (a person's file or a company file) shown inside the page. Same checks as the download link, audited, never cached.
// PDFs and pictures are sent as they are; a Word file is rebuilt as safe plain HTML. Our own authenticated route, never a storage link.

const COMMON = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const actor = await requireUser();
  const { documentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return new Response("Not found", { status: 404 });
  try {
    const preview = await openDocumentPreview(actor, documentId);
    const body = typeof preview.body === "string" ? preview.body : Buffer.from(preview.body);
    // A rebuilt Word file runs in a sandbox (no scripts, network or navigation); a picture cannot load anything.
    const security: Record<string, string> = preview.kind === "html" ? { "Content-Security-Policy": PREVIEW_HTML_CSP } : preview.kind === "image" ? { "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox" } : {};
    return new Response(body, { headers: { "Content-Type": preview.contentType, "Content-Disposition": "inline", ...COMMON, ...security } });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    if (error instanceof ActionFailure) {
      if (error.message === NOT_PREVIEWABLE) return new Response(error.message, { status: 415 });
      if (/not found|no access|do not have access/i.test(error.message)) return new Response("Not found", { status: 404 });
      return new Response(error.message, { status: 429 });
    }
    console.error("document preview failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
