import { PDFDocument } from "pdf-lib";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { PAYSLIP_LABELS as L } from "@/modules/payroll/constants";
import { payslipView } from "@/modules/payroll/payslip";
import { renderPayslipPdf } from "@/modules/payroll/payslip-pdf";
import { PayslipUnreadable } from "@/modules/payroll/payslip-queries";
import { getAllStatementsForTeam } from "@/modules/payroll/statements-queries";

// Every statement of a run as ONE PDF (one statement after another, in name order), for the payroll team (payroll.view). Same rules as the
// single statement: a missing run, a run that is not approved yet and anyone without payroll access all answer 404; audited with the run id
// and a count only; rate-limited; never cached. A run of test statements is stamped TEST on every page.

export const maxDuration = 60;

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });
const BATCH = 5;

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await requireUser();
  const { runId } = await params;
  try {
    if (!(await allowRequest("download", actor.id))) return new Response("Too many requests", { status: 429, headers: HEADERS });
    const slips = await getAllStatementsForTeam(runId); // authorize("payroll.view") and the audit row are inside
    if (!slips || slips.length === 0) return notFound();

    // A few at a time: each statement is drawn on its own, then the pages are put together in order.
    const parts: Uint8Array[] = [];
    for (let i = 0; i < slips.length; i += BATCH) {
      parts.push(...(await Promise.all(slips.slice(i, i + BATCH).map((slip) => renderPayslipPdf(payslipView(slip))))));
    }
    const merged = await PDFDocument.create();
    for (const bytes of parts) {
      const doc = await PDFDocument.load(bytes);
      for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
    }
    const out = await merged.save();
    const first = slips[0];
    return new Response(Buffer.from(out), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contractor-payment-statements-${first.periodStart}-to-${first.periodEnd}${first.isTest ? "-TEST" : ""}.pdf"`,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return notFound();
    if (error instanceof PayslipUnreadable) return new Response(L.unreadableDownload, { status: 500, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
    throw error;
  }
}
