import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { can, type AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { clientAssignments, clients } from "@/modules/people/schema";
import { MAX_FILE_BYTES, sanitizeFileName, sniffFileKind } from "./files";
import { documentTypes, documents, systemDocuments, SYSTEM_SOURCE_KINDS } from "./schema";
import { BUCKETS, getDocumentStorage } from "./storage";

// Server-only helpers. They are NOT server actions (they live outside the "use server" files), so the
// browser cannot call them and they may take the acting user as an argument.

/**
 * Clients a document may be tied to. HR picks from all active clients; a person only from the
 * clients they are (or were) assigned to, so client names are not exposed to everyone.
 */
export async function clientChoices(actor: AuthzUser, employeeId: string) {
  if (can(actor, "people.manage_assignments")) {
    return db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.isActive, true), isNull(clients.archivedAt))).orderBy(clients.name);
  }
  return db
    .selectDistinct({ id: clients.id, name: clients.name })
    .from(clientAssignments)
    .innerJoin(clients, eq(clients.id, clientAssignments.clientId))
    .where(eq(clientAssignments.employeeId, employeeId))
    .orderBy(clients.name);
}

/** The "uploader" and "verifier" of a file ELEVATE filed by itself (no person did it). */
export const SYSTEM_UPLOADER_ID = "00000000-0000-0000-0000-000000000000";

/** Most active documents a person can hold (the same limit the upload form enforces). */
const MAX_ACTIVE_DOCUMENTS = 100;

export type FileSystemDocumentInput = {
  employeeId: string;
  typeSlug: "training_certificate" | "signed_document";
  title: string;
  fileName: string;
  bytes: Uint8Array;
  sourceKind: (typeof SYSTEM_SOURCE_KINDS)[number];
  sourceId: string;
};

/**
 * Files a PDF ELEVATE produced (a training certificate, a signed document) in a person's Documents, once per source and person.
 * The bytes are COPIED into the private employee bucket (never pointed at the signing bucket: retention for a person's documents
 * would then delete the signed evidence). The row is verified, so the person cannot archive it; HR can. The type, size and the
 * 100-document limit are checked like an upload. Returns "filed", "already" (this source was filed before) or "skipped" (no such
 * person or type, not a PDF, too big, or the person is at the limit). Server-only: the browser cannot call it.
 */
export async function fileSystemDocument(input: FileSystemDocumentInput): Promise<"filed" | "already" | "skipped"> {
  const [existing] = await db
    .select({ id: systemDocuments.documentId })
    .from(systemDocuments)
    .where(and(eq(systemDocuments.sourceKind, input.sourceKind), eq(systemDocuments.sourceId, input.sourceId), eq(systemDocuments.employeeId, input.employeeId)))
    .limit(1);
  if (existing) return "already";

  if (sniffFileKind(input.bytes) !== "pdf" || input.bytes.length === 0 || input.bytes.length > MAX_FILE_BYTES) return "skipped";
  const [person] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.id, input.employeeId), isNull(employees.archivedAt))).limit(1);
  const [type] = await db.select({ id: documentTypes.id }).from(documentTypes).where(and(eq(documentTypes.slug, input.typeSlug), isNull(documentTypes.archivedAt))).limit(1);
  if (!person || !type) return "skipped";
  const [{ n }] = await db.select({ n: count() }).from(documents).where(and(eq(documents.employeeId, input.employeeId), eq(documents.status, "active"), isNull(documents.archivedAt)));
  if (n >= MAX_ACTIVE_DOCUMENTS) return "skipped";

  const storage = getDocumentStorage();
  const path = `${input.employeeId}/${randomUUID()}.pdf`;
  await storage.write(BUCKETS.employee, path, input.bytes, "application/pdf");
  const id = randomUUID();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id,
        typeId: type.id,
        employeeId: input.employeeId,
        title: input.title.slice(0, 120),
        status: "active",
        storageBucket: BUCKETS.employee,
        storagePath: path,
        originalName: sanitizeFileName(input.fileName, "pdf"),
        mimeType: "application/pdf",
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        uploadedBy: SYSTEM_UPLOADER_ID,
        verifiedBy: SYSTEM_UPLOADER_ID,
        verifiedAt: now,
        finalizedAt: now,
      });
      await tx.insert(systemDocuments).values({ sourceKind: input.sourceKind, sourceId: input.sourceId, employeeId: input.employeeId, documentId: id });
      await writeAudit({ actor: null, action: "document.filed", targetType: "employee", targetId: input.employeeId, metadata: { documentId: id, type: input.typeSlug, source: input.sourceKind } }, tx);
    });
    return "filed";
  } catch (error) {
    await storage.remove(BUCKETS.employee, [path]).catch(() => undefined);
    if (isUniqueViolation(error)) return "already"; // two runs at once: the other one filed it
    throw error;
  }
}

/** Archives the copies filed from these sources (for example the certificate that was revoked). The files are kept. Returns how many were archived. */
export async function archiveSystemDocuments(sourceKind: FileSystemDocumentInput["sourceKind"], sourceIds: string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const rows = await db.select({ documentId: systemDocuments.documentId }).from(systemDocuments).where(and(eq(systemDocuments.sourceKind, sourceKind), inArray(systemDocuments.sourceId, sourceIds)));
  if (rows.length === 0) return 0;
  const archived = await db
    .update(documents)
    .set({ archivedAt: new Date(), archivedBy: SYSTEM_UPLOADER_ID, updatedAt: new Date() })
    .where(and(inArray(documents.id, rows.map((r) => r.documentId)), isNull(documents.archivedAt)))
    .returning({ id: documents.id });
  if (archived.length > 0) await writeAudit({ actor: null, action: "document.filed_archived", targetType: "document", targetId: archived[0].id, metadata: { count: archived.length, source: sourceKind } });
  return archived.length;
}
