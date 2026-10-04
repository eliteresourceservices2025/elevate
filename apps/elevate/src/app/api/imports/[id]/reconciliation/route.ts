import { ForbiddenError, authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { parseMarkdown } from "@/lib/markdown";
import { allowRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/write";
import { renderOfferPdf } from "@/modules/offers/offer-pdf";
import { getBatch, getReconciliation } from "@/modules/imports/queries";

// The reconciliation report as a PDF for HR's sign-off. Counts only: no names, emails or values. Audited, rate-limited, never cached.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    await authorize(actor, "imports.manage");
    if (!(await allowRequest("download", actor.id))) return new Response("Too many requests", { status: 429 });
    const batch = await getBatch(id);
    const rec = await getReconciliation(id);
    const lines = rec.checks.map((c) => `- ${c.label}: TalentHR file ${c.expected}, ELEVATE ${c.actual}${c.expected === c.actual ? "" : " (MISMATCH)"}`);
    const body = [
      "# Reconciliation report",
      `Import of **${batch.fileName.replace(/[*_`#\[\]]/g, "")}**, ${batch.committedAt ? `committed ${batch.committedAt.toISOString().slice(0, 10)}` : "not committed yet"}.`,
      `Result: **${rec.clean ? "all counts match" : "there are mismatches"}**. Rows with warnings: ${rec.warnings}.`,
      ...lines,
      ...rec.notes.map((n) => `${n}`),
      batch.signedOffAt ? `Signed off ${batch.signedOffAt.toISOString().slice(0, 10)}.` : "Not signed off yet.",
    ].join("\n\n");
    const pdf = await renderOfferPdf({ title: "Reconciliation report", blocks: parseMarkdown(body), footer: `Import ${id.slice(0, 8)}` });
    await writeAudit({ actor, action: "import.reconciliation_view", targetType: "import_batch", targetId: id });
    return new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="reconciliation-${id.slice(0, 8)}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" } });
  } catch (error) {
    if (error instanceof ForbiddenError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
