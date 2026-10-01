import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { ActionFailure } from "@/lib/run-action";
import { openResume } from "@/modules/recruiting/resume";

// An applicant's resume shown inside the page (an iframe). Only PDFs are shown this way; a Word file is downloaded instead (a browser
// cannot display it). Same checks as the download link: the hiring team and HR, audited, never cached.

export async function GET(_request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const actor = await requireUser();
  const { applicationId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(applicationId)) return new Response("Not found", { status: 404 });
  try {
    const resume = await openResume(actor, applicationId);
    if (resume.kind !== "pdf") return new Response("This file type cannot be shown in the page. Download it instead.", { status: 415 });
    return new Response(Buffer.from(resume.bytes), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="resume.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || (error instanceof ActionFailure && /not found|no resume/i.test(error.message))) return new Response("Not found", { status: 404 });
    if (error instanceof ActionFailure) return new Response(error.message, { status: 429 });
    console.error("resume view failed:", error instanceof Error ? error.name : "unknown error");
    return new Response("Something went wrong", { status: 500 });
  }
}
