import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { PAYSLIP_LABELS as L } from "@/modules/payroll/constants";
import { payslipView } from "@/modules/payroll/payslip";
import { renderPayslipPdf } from "@/modules/payroll/payslip-pdf";
import { PayslipUnreadable } from "@/modules/payroll/payslip-queries";
import { getStatementForTeam } from "@/modules/payroll/statements-queries";

// One contractor's statement as a PDF, for the payroll team (payroll.view). Only a run that is approved or paid has statements; a run or a
// person that does not exist, and anyone without payroll access, all answer the same 404. Audited with the run id only (never an amount),
// rate-limited, never cached. A statement from a test run is stamped TEST.

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string; employeeId: string }> }) {
  const actor = await requireUser();
  const { runId, employeeId } = await params;
  try {
    if (!(await allowRequest("download", actor.id))) return new Response("Too many requests", { status: 429, headers: HEADERS });
    const slip = await getStatementForTeam(runId, employeeId); // authorize("payroll.view") and the audit row are inside
    if (!slip) return notFound();
    const pdf = await renderPayslipPdf(payslipView(slip));
    return new Response(Buffer.from(pdf), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contractor-payment-statement-${slip.periodStart}-to-${slip.periodEnd}-${slip.employeeId.slice(0, 4)}${slip.isTest ? "-TEST" : ""}.pdf"`,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return notFound();
    if (error instanceof PayslipUnreadable) return new Response(L.unreadableDownload, { status: 500, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
    throw error;
  }
}
