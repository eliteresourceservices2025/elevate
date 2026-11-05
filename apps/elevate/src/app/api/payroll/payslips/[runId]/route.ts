import { z } from "zod";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseMarkdown } from "@/lib/markdown";
import { allowRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/write";
import { renderOfferPdf } from "@/modules/offers/offer-pdf";
import { logChange } from "@/modules/payroll/changes";
import { PAYSLIP_LABELS as L } from "@/modules/payroll/constants";
import { payslipMarkdown } from "@/modules/payroll/payslip";
import { getMyPayslip, PayslipUnreadable } from "@/modules/payroll/payslip-queries";

// A person's own payslip as a PDF. Only a paid run has one; someone else's run, an unpaid run and a run that does not exist all
// answer the same 404. Audited with the run id only (never an amount), rate-limited, never cached.

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const actor = await requireUser();
  const { runId } = await params;
  if (!z.uuid().safeParse(runId).success) return notFound();
  try {
    if (!(await allowRequest("download", actor.id))) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    const slip = await getMyPayslip(actor, runId);
    if (!slip) return notFound();
    const pdf = await renderOfferPdf({ title: L.documentTitle, blocks: parseMarkdown(payslipMarkdown(slip)), footer: `${L.footer} ${slip.periodStart} to ${slip.periodEnd}` });
    await db.transaction(async (tx) => {
      await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["payslip"] } }, tx);
      await logChange(tx, actor, { action: "payslip_downloaded", runId, employeeId: slip.employeeId });
    });
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="payslip-${slip.periodStart}-to-${slip.periodEnd}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return notFound();
    if (error instanceof PayslipUnreadable) return new Response(L.unreadableDownload, { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    throw error;
  }
}
