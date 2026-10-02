import { eq } from "drizzle-orm";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { certificates } from "@/modules/onboarding/schema";

// A certificate of engagement, shown inline. HR only (certificates.issue). Every view is audited.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || scopeFor(actor, "certificates.issue") !== "all") return new Response("Not found", { status: 404 });
  const [c] = await db.select().from(certificates).where(eq(certificates.id, id));
  if (!c) return new Response("Not found", { status: 404 });
  const bytes = await getDocumentStorage().read(BUCKETS.signed, c.storagePath);
  if (!bytes) return new Response("Not found", { status: 404 });
  await writeAudit({ actor, action: "certificate.view", targetType: "employee", targetId: c.employeeId, after: { reference: c.reference } });
  return new Response(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${c.reference}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN" },
  });
}
