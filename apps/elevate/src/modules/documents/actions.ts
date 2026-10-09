"use server";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { ALLOWED_TYPES_TEXT, MAX_FILE_BYTES, extensionOf, kindFromMime, mimeOf, sanitizeFileName, sniffFileKind } from "./files";
import { documentFolders, documentTypes, documents } from "./schema";
import { clientChoices } from "./service";
import { BUCKETS, getDocumentStorage, type Bucket } from "./storage";
import {
  archiveDocumentTypeSchema,
  createFolderSchema,
  documentIdSchema,
  folderIdSchema,
  moveDocumentSchema,
  renameFolderSchema,
  documentTypeSchema,
  requestUploadSchema,
  updateDocumentTypeSchema,
  verifyDocumentSchema,
} from "./validators";

const BAD = "Check the request and try again.";
const PENDING_LIMIT = 5;
const FOLDER_LIMIT_PER_PERSON = 30;
const ACTIVE_LIMIT_PER_PERSON = 100;
const PENDING_WINDOW_MS = 2 * 60 * 60 * 1000;

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

function refresh(employeeId: string | null) {
  revalidatePath("/documents");
  if (employeeId) revalidatePath(`/people/${employeeId}`);
}

// --- Upload: request, send, finalize ---------------------------------------------

export type UploadTicket = { documentId: string; bucket: Bucket; path: string; token: string; contentType: string };

/**
 * Step 1. Validates everything that can be checked before the file exists, records a pending
 * document, and returns a one-time token for exactly one storage path. The server picks the
 * path; the file name sent by the browser is only ever used for display (after cleaning).
 */
export async function requestUpload(input: unknown): Promise<ActionResult<UploadTicket>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = requestUploadSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;

    let employee: { id: string; userId: string | null } | undefined;
    if (v.target === "employee") {
      if (!v.employeeId) return fail("Choose whose document this is.");
      [employee] = await db
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt)))
        .limit(1);
      await authorize(actor, "documents.upload", { ownerUserId: employee?.userId ?? undefined });
      if (!employee) return fail("That person was not found.");
    } else {
      await authorize(actor, "documents.manage_company");
    }

    const [type] = await db.select().from(documentTypes).where(and(eq(documentTypes.id, v.typeId), isNull(documentTypes.archivedAt))).limit(1);
    if (!type || type.scope !== v.target) return fail("Choose a document type.");

    if (type.requiresExpiry && !v.expiresOn) return fail("Enter the expiry date for this type of document.");
    if (v.expiresOn && v.expiresOn < todayInZone()) return fail("That expiry date has already passed.");

    let clientId: string | null = null;
    if (type.requiresClient) {
      if (!v.clientId) return fail("Choose the client this document is for.");
      const allowed = await clientChoices(actor, employee!.id);
      if (!allowed.some((c) => c.id === v.clientId)) return fail("Choose one of your clients.");
      clientId = v.clientId;
    }

    const kind = kindFromMime(v.mimeType);
    if (!kind) return fail(`Only ${ALLOWED_TYPES_TEXT} files are allowed.`);
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");

    const [{ pending }] = await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(eq(documents.uploadedBy, actor.id), eq(documents.status, "pending")));
    if (pending >= PENDING_LIMIT) return fail("You have unfinished uploads. Finish or wait for them to clear, then try again.");

    if (employee) {
      const [{ active }] = await db
        .select({ active: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(eq(documents.employeeId, employee.id), eq(documents.status, "active"), isNull(documents.archivedAt)));
      if (active >= ACTIVE_LIMIT_PER_PERSON) return fail("This person has reached the limit of 100 documents. Archive old ones first.");
    }

    let folderId: string | null = null;
    if (v.folderId) {
      if (!employee) return fail("Folders are for a person's own documents.");
      const [folder] = await db.select({ id: documentFolders.id }).from(documentFolders).where(and(eq(documentFolders.id, v.folderId), eq(documentFolders.employeeId, employee.id), isNull(documentFolders.archivedAt))).limit(1);
      if (!folder) return fail("Choose one of this person's folders.");
      folderId = folder.id;
    }

    const id = randomUUID();
    const bucket = v.target === "employee" ? BUCKETS.employee : BUCKETS.company;
    const path = `${employee ? employee.id : "company"}/${id}.${extensionOf(kind)}`;

    await db.insert(documents).values({
      id,
      typeId: type.id,
      employeeId: employee?.id ?? null,
      clientId,
      folderId,
      title: v.title,
      audience: v.target === "company" ? v.audience : "all_staff",
      status: "pending",
      storageBucket: bucket,
      storagePath: path,
      originalName: sanitizeFileName(v.fileName, kind),
      mimeType: mimeOf(kind), // what the browser claims; replaced by the checked type at finalize
      expiresOn: v.expiresOn ?? null,
      uploadedBy: actor.id,
    });

    let token: string;
    try {
      ({ token } = await getDocumentStorage().createSignedUpload(bucket, path));
    } catch (error) {
      await db.delete(documents).where(eq(documents.id, id));
      throw error;
    }

    await writeAudit({ actor, action: "document.upload_requested", targetType: employee ? "employee" : "company", targetId: employee?.id ?? "company", metadata: { documentId: id, type: type.slug } });
    return { ok: true, data: { documentId: id, bucket, path, token, contentType: mimeOf(kind) } };
  });
}

/**
 * Step 3, after the browser has sent the file. Reads the stored file and checks what it really is,
 * its size and its fingerprint. A file that fails is deleted and the attempt is discarded.
 */
export async function finalizeUpload(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = documentIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const storage = getDocumentStorage();

    const [doc] = await db.select().from(documents).where(eq(documents.id, parsed.data.documentId)).limit(1);
    // Only the person who started the upload can finish it.
    if (!doc || doc.uploadedBy !== actor.id || doc.status !== "pending") return fail("That upload was not found.");
    if (Date.now() - doc.createdAt.getTime() > PENDING_WINDOW_MS) return fail("That upload timed out. Start it again.");

    const bytes = await storage.read(doc.storageBucket as Bucket, doc.storagePath);
    if (!bytes) return fail("We did not receive the file. Try uploading it again.");

    const rejectWith = async (reason: string, message: string) => {
      await storage.remove(doc.storageBucket as Bucket, [doc.storagePath]).catch(() => undefined);
      await db.transaction(async (tx) => {
        await tx.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.status, "pending")));
        await writeAudit({ actor, action: "document.upload_rejected", targetType: doc.employeeId ? "employee" : "company", targetId: doc.employeeId ?? "company", metadata: { documentId: doc.id, reason } }, tx);
      });
      return fail(message);
    };

    if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) return rejectWith("size", "Files can be 10 MB at most.");
    const kind = sniffFileKind(bytes);
    if (!kind) return rejectWith("type", `That file is not a ${ALLOWED_TYPES_TEXT}, or a Word file with macros, so it was not saved.`);
    if (kind !== kindFromMime(doc.mimeType ?? "")) return rejectWith("mismatch", "The file does not match the type you chose, so it was not saved.");

    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const result = await db.transaction(async (tx) => {
      const [owner] = doc.employeeId ? await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, doc.employeeId)).limit(1) : [];
      // HR uploads count as verified, except on HR's own record (nobody verifies their own documents).
      const autoVerify = can(actor, "documents.verify") && owner?.userId !== actor.id;

      const [updated] = await tx
        .update(documents)
        .set({
          status: "active",
          mimeType: mimeOf(kind),
          sizeBytes: bytes.length,
          sha256,
          finalizedAt: new Date(),
          updatedAt: new Date(),
          ...(autoVerify ? { verifiedBy: actor.id, verifiedAt: new Date() } : {}),
        })
        .where(and(eq(documents.id, doc.id), eq(documents.status, "pending")))
        .returning({ id: documents.id });
      if (!updated) throw new ActionFailure("That upload was already finished.");

      const [type] = await tx.select({ slug: documentTypes.slug }).from(documentTypes).where(eq(documentTypes.id, doc.typeId)).limit(1);
      await writeAudit(
        { actor, action: "document.upload", targetType: doc.employeeId ? "employee" : "company", targetId: doc.employeeId ?? "company", metadata: { documentId: doc.id, type: type?.slug, sizeBytes: bytes.length, verified: autoVerify } },
        tx,
      );
      return { ok: true, data: undefined } as const;
    });

    refresh(doc.employeeId);
    return result;
  });
}

/** Abandons an upload the person started (for example the browser upload failed). */
export async function cancelUpload(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = documentIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const [doc] = await db.select().from(documents).where(eq(documents.id, parsed.data.documentId)).limit(1);
    if (!doc || doc.uploadedBy !== actor.id || doc.status !== "pending") return fail("That upload was not found.");
    await getDocumentStorage().remove(doc.storageBucket as Bucket, [doc.storagePath]).catch(() => undefined);
    await db.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.status, "pending")));
    return { ok: true, data: undefined };
  });
}

// --- Download, verify, archive ------------------------------------------------------

async function loadDocument(documentId: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || doc.status !== "active") return null;
  const [owner] = doc.employeeId ? await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, doc.employeeId)).limit(1) : [];
  return { doc, ownerUserId: owner?.userId ?? undefined };
}

/** A 60-second download link. Every download is written to the audit log. */
export async function getDownloadUrl(input: unknown): Promise<ActionResult<{ url: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = documentIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);

    const found = await loadDocument(parsed.data.documentId);
    const isHr = can(actor, "documents.verify");
    if (found?.doc.employeeId) await authorize(actor, "documents.view", { ownerUserId: found.ownerUserId });
    else await authorize(actor, "documents.view_company");
    if (!found) return fail("That document was not found.");
    const { doc } = found;

    if (!doc.employeeId && doc.audience === "hr_only" && !can(actor, "documents.manage_company")) return fail("You do not have access to do that.");
    if (doc.archivedAt && !isHr) return fail("That document was not found.");
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");

    const url = await getDocumentStorage().createSignedDownload(doc.storageBucket as Bucket, doc.storagePath, 60, doc.originalName);
    await writeAudit({
      actor,
      action: "document.download",
      targetType: doc.employeeId ? "employee" : "company",
      targetId: doc.employeeId ?? "company",
      metadata: { documentId: doc.id },
    });
    return { ok: true, data: { url } };
  });
}

export async function verifyDocument(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "documents.verify");
    const parsed = verifyDocumentSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);

    const found = await loadDocument(parsed.data.documentId);
    if (!found || !found.doc.employeeId || found.doc.archivedAt) return fail("That document was not found.");
    // Four eyes: nobody verifies a document on their own record.
    if (found.ownerUserId === actor.id) return fail("Another admin must verify documents on your own record.");

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set(parsed.data.verified ? { verifiedBy: actor.id, verifiedAt: new Date(), updatedAt: new Date() } : { verifiedBy: null, verifiedAt: null, updatedAt: new Date() })
        .where(eq(documents.id, found.doc.id));
      await writeAudit({ actor, action: parsed.data.verified ? "document.verify" : "document.unverify", targetType: "employee", targetId: found.doc.employeeId!, metadata: { documentId: found.doc.id } }, tx);
    });
    refresh(found.doc.employeeId);
    return { ok: true, data: undefined };
  });
}

/** Hides a document from lists. The file is kept until retention periods are approved. */
export async function archiveDocument(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = documentIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);

    const found = await loadDocument(parsed.data.documentId);
    if (found?.doc.employeeId) await authorize(actor, "documents.archive", { ownerUserId: found.ownerUserId });
    else await authorize(actor, "documents.manage_company");
    if (!found || found.doc.archivedAt) return fail("That document was not found.");

    // A person can remove their own file only until HR has verified it.
    if (found.doc.employeeId && found.doc.verifiedAt && !can(actor, "documents.verify")) {
      return fail("HR has verified this document, so only HR can remove it.");
    }

    await db.transaction(async (tx) => {
      await tx.update(documents).set({ archivedAt: new Date(), archivedBy: actor.id, updatedAt: new Date() }).where(eq(documents.id, found.doc.id));
      await writeAudit({ actor, action: "document.archive", targetType: found.doc.employeeId ? "employee" : "company", targetId: found.doc.employeeId ?? "company", metadata: { documentId: found.doc.id } }, tx);
    });
    refresh(found.doc.employeeId);
    return { ok: true, data: undefined };
  });
}

// --- Folders ------------------------------------------------------------------------

async function ownerOfEmployee(employeeId: string) {
  const [row] = await db.select({ id: employees.id, userId: employees.userId }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.archivedAt))).limit(1);
  return row;
}

async function loadFolder(folderId: string) {
  const [folder] = await db.select().from(documentFolders).where(and(eq(documentFolders.id, folderId), isNull(documentFolders.archivedAt))).limit(1);
  if (!folder) return null;
  const owner = await ownerOfEmployee(folder.employeeId);
  return owner ? { folder, ownerUserId: owner.userId } : null;
}

/** A new folder for a person's documents. HR for anyone; a person for their own. Names are never written to the audit log. */
export async function createFolder(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = createFolderSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const owner = await ownerOfEmployee(parsed.data.employeeId);
    await authorize(actor, "documents.organize", { ownerUserId: owner?.userId ?? undefined });
    if (!owner) return fail("That person was not found.");

    try {
      const id = await db.transaction(async (tx) => {
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(documentFolders).where(and(eq(documentFolders.employeeId, owner.id), isNull(documentFolders.archivedAt)));
        if (n >= FOLDER_LIMIT_PER_PERSON) throw new ActionFailure(`A person can have ${FOLDER_LIMIT_PER_PERSON} folders at most.`);
        const [row] = await tx.insert(documentFolders).values({ employeeId: owner.id, name: parsed.data.name, createdBy: actor.id }).returning({ id: documentFolders.id });
        await writeAudit({ actor, action: "document.folder_create", targetType: "employee", targetId: owner.id, metadata: { folderId: row.id } }, tx);
        return row.id;
      });
      refresh(owner.id);
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("There is already a folder with that name.");
      throw error;
    }
  });
}

export async function renameFolder(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = renameFolderSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const found = await loadFolder(parsed.data.folderId);
    await authorize(actor, "documents.organize", { ownerUserId: found?.ownerUserId ?? undefined });
    if (!found) return fail("That folder was not found.");

    try {
      await db.transaction(async (tx) => {
        await tx.update(documentFolders).set({ name: parsed.data.name, updatedAt: new Date() }).where(eq(documentFolders.id, found.folder.id));
        await writeAudit({ actor, action: "document.folder_rename", targetType: "employee", targetId: found.folder.employeeId, metadata: { folderId: found.folder.id } }, tx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("There is already a folder with that name.");
      throw error;
    }
    refresh(found.folder.employeeId);
    return { ok: true, data: undefined };
  });
}

/** Removes a folder. Its documents are not touched: they go back to "No folder". */
export async function archiveFolder(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = folderIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const found = await loadFolder(parsed.data.folderId);
    await authorize(actor, "documents.organize", { ownerUserId: found?.ownerUserId ?? undefined });
    if (!found) return fail("That folder was not found.");

    await db.transaction(async (tx) => {
      await tx.update(documents).set({ folderId: null, updatedAt: new Date() }).where(eq(documents.folderId, found.folder.id));
      await tx.update(documentFolders).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(documentFolders.id, found.folder.id));
      await writeAudit({ actor, action: "document.folder_remove", targetType: "employee", targetId: found.folder.employeeId, metadata: { folderId: found.folder.id } }, tx);
    });
    refresh(found.folder.employeeId);
    return { ok: true, data: undefined };
  });
}

/** Puts a document in one of its owner's folders, or back to "No folder" (folderId null). The document and the folder must belong to the same person. */
export async function moveDocument(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    const parsed = moveDocumentSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);

    const found = await loadDocument(parsed.data.documentId);
    await authorize(actor, "documents.organize", { ownerUserId: found?.ownerUserId ?? undefined });
    if (!found || found.doc.archivedAt || !found.doc.employeeId) return fail("That document was not found.");

    if (parsed.data.folderId) {
      const [folder] = await db
        .select({ id: documentFolders.id })
        .from(documentFolders)
        .where(and(eq(documentFolders.id, parsed.data.folderId), eq(documentFolders.employeeId, found.doc.employeeId), isNull(documentFolders.archivedAt)))
        .limit(1);
      if (!folder) return fail("Choose one of this person's folders.");
    }

    await db.transaction(async (tx) => {
      await tx.update(documents).set({ folderId: parsed.data.folderId, updatedAt: new Date() }).where(eq(documents.id, found.doc.id));
      await writeAudit({ actor, action: "document.move", targetType: "employee", targetId: found.doc.employeeId!, metadata: { documentId: found.doc.id, folderId: parsed.data.folderId } }, tx);
    });
    refresh(found.doc.employeeId);
    return { ok: true, data: undefined };
  });
}

// --- Document types (HR) --------------------------------------------------------------

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "type";

export async function createDocumentType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "documents.manage_types");
    const parsed = documentTypeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const flags = v.scope === "company" ? { requiresClient: false, requiredForAll: false } : { requiresClient: v.requiresClient, requiredForAll: v.requiredForAll };

    try {
      await db.transaction(async (tx) => {
        const slug = `${slugify(v.name)}_${randomUUID().slice(0, 6)}`;
        const [t] = await tx.insert(documentTypes).values({ slug, name: v.name, scope: v.scope, requiresExpiry: v.requiresExpiry, ...flags }).returning({ id: documentTypes.id });
        await writeAudit({ actor, action: "document_type.create", targetType: "document_type", targetId: t.id, after: { name: v.name, scope: v.scope, requiresExpiry: v.requiresExpiry, ...flags } }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A document type with that name already exists.");
      throw e;
    }
    revalidatePath("/documents");
    return { ok: true, data: undefined };
  });
}

export async function updateDocumentType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "documents.manage_types");
    const parsed = updateDocumentTypeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { typeId, ...v } = parsed.data;

    try {
      const result = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(documentTypes).where(eq(documentTypes.id, typeId)).for("update");
        if (!before || before.archivedAt) return fail("That document type was not found.");
        if (before.scope !== v.scope) return fail("A type cannot change between person and company documents.");
        const flags = v.scope === "company" ? { requiresClient: false, requiredForAll: false } : { requiresClient: v.requiresClient, requiredForAll: v.requiredForAll };
        await tx.update(documentTypes).set({ name: v.name, requiresExpiry: v.requiresExpiry, ...flags, updatedAt: new Date() }).where(eq(documentTypes.id, typeId));
        await writeAudit(
          {
            actor,
            action: "document_type.update",
            targetType: "document_type",
            targetId: typeId,
            before: { name: before.name, requiresExpiry: before.requiresExpiry, requiresClient: before.requiresClient, requiredForAll: before.requiredForAll },
            after: { name: v.name, requiresExpiry: v.requiresExpiry, ...flags },
          },
          tx,
        );
        return { ok: true, data: undefined } as const;
      });
      revalidatePath("/documents");
      return result;
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A document type with that name already exists.");
      throw e;
    }
  });
}

export async function archiveDocumentType(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "documents.manage_types");
    const parsed = archiveDocumentTypeSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const result = await db.transaction(async (tx) => {
      const [t] = await tx.update(documentTypes).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(documentTypes.id, parsed.data.typeId), isNull(documentTypes.archivedAt))).returning({ name: documentTypes.name });
      if (!t) return fail("That document type was not found.");
      await writeAudit({ actor, action: "document_type.archive", targetType: "document_type", targetId: parsed.data.typeId, metadata: { name: t.name } }, tx);
      return { ok: true, data: undefined } as const;
    });
    revalidatePath("/documents");
    return result;
  });
}
