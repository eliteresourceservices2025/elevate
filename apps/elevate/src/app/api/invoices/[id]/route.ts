import { z } from "zod";
import { authorize, ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { writeAudit } from "@/modules/audit/write";
import { renderInvoicePdf } from "@/modules/invoices/invoice-pdf";
import { invoiceText } from "@/modules/invoices/invoice-text";
import { loadInvoiceView } from "@/modules/invoices/service";

// An invoice as a PDF. Signed in, authorized (invoices.view), rate-limited and audited with the invoice id only; never cached.

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return notFound();
  try {
    await authorize(actor, "invoices.view");
    if (!(await allowRequest("download", actor.id))) return new Response("Too many requests", { status: 429, headers: HEADERS });
    const view = await loadInvoiceView(db, id);
    if (!view) return notFound();
    const pdf = await renderInvoicePdf(invoiceText(view));
    await writeAudit({ actor, action: "sensitive.view", targetType: "invoice", targetId: id, metadata: { fields: ["invoice pdf"] } });
    return new Response(Buffer.from(pdf), {
      headers: {
        ...HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${view.number}.pdf"`,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return notFound();
    throw error;
  }
}
