import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { writeAudit } from "@/modules/audit/write";
import { documents, documentTypes } from "@/modules/documents/schema";
import { extensionOf, MAX_FILE_BYTES, mimeOf, sanitizeFileName, sniffFileKind } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { employees } from "@/modules/people/schema";
import { importPullItems, importPulls } from "./schema";
import type { TalentHrApi } from "./talenthr-client";
import { createHash } from "node:crypto";

// Pulls what the CSV export lacks from TalentHR's API. Read-only on TalentHR's side. Run by the pull script (never by a button: the API key
// lives in the host's environment). Safe to run again: a source item already imported is skipped.

export type PullActor = { id: string; email: string };
export type PullSummary = { people: number; matched: number; unmatched: number; documentsFound: number; documentsImported: number; documentsDuplicate: number; documentsSkipped: number; documentsFailed: number; leaveArchived: number; applicantsArchived: number };

const DOC_TYPE_SLUG = "talenthr_import";
const archiveContext = (kind: string, source: string) => `import_pull:${kind}:${source}`;
export const readArchive = (kind: "leave_history" | "applicants", source: string, enc: string) => JSON.parse(fieldCrypto().decrypt(enc, archiveContext(kind, source))) as unknown;

async function importedDocumentType(): Promise<string> {
  const [found] = await db.select({ id: documentTypes.id }).from(documentTypes).where(eq(documentTypes.slug, DOC_TYPE_SLUG));
  if (found) return found.id;
  const [made] = await db.insert(documentTypes).values({ slug: DOC_TYPE_SLUG, name: "Imported from TalentHR", scope: "employee" }).returning({ id: documentTypes.id });
  return made.id;
}

export async function runPull(actor: PullActor, api: TalentHrApi, opts: { dryRun: boolean; onlyEmails?: string[] }): Promise<{ pullId: string; summary: PullSummary }> {
  const [pull] = await db.insert(importPulls).values({ startedBy: actor.id, dryRun: opts.dryRun ? "yes" : "no" }).returning({ id: importPulls.id });
  const summary: PullSummary = { people: 0, matched: 0, unmatched: 0, documentsFound: 0, documentsImported: 0, documentsDuplicate: 0, documentsSkipped: 0, documentsFailed: 0, leaveArchived: 0, applicantsArchived: 0 };
  try {
    const directory = await api.directory();
    summary.people = directory.length;
    const wanted = opts.onlyEmails ? new Set(opts.onlyEmails.map((e) => e.toLowerCase())) : null;
    const people = directory.filter((d) => d.email && (!wanted || wanted.has(d.email.toLowerCase())));
    const emails = people.map((p) => p.email.toLowerCase());
    const mine = emails.length ? await db.select({ id: employees.id, email: employees.workEmail }).from(employees).where(inArray(sql`lower(${employees.workEmail})`, emails)) : [];
    const byEmail = new Map(mine.map((e) => [e.email.toLowerCase(), e.id]));
    const typeId = opts.dryRun ? "" : await importedDocumentType();
    const storage = getDocumentStorage();

    for (const person of people) {
      const employeeId = byEmail.get(person.email.toLowerCase());
      if (!employeeId) {
        summary.unmatched += 1;
        continue;
      }
      summary.matched += 1;

      // Documents
      const docs = await api.documents(person.id);
      for (const doc of docs) {
        summary.documentsFound += 1;
        const sourceId = String(doc.id);
        const [done] = await db.select({ id: importPullItems.id }).from(importPullItems).where(and(eq(importPullItems.kind, "document"), eq(importPullItems.sourceId, sourceId), inArray(importPullItems.outcome, ["imported", "archived"])));
        if (done) {
          summary.documentsDuplicate += 1;
          continue;
        }
        const record = async (outcome: string, reason: string | null, sha256: string | null = null) => {
          if (opts.dryRun) return;
          // A skipped or failed item that is tried again replaces its earlier row, so counts stay one per source file
          await db.delete(importPullItems).where(and(eq(importPullItems.kind, "document"), eq(importPullItems.sourceId, sourceId), inArray(importPullItems.outcome, ["skipped", "failed", "duplicate"])));
          await db.insert(importPullItems).values({ pullId: pull.id, kind: "document", sourceId, employeeId, outcome, reason, sha256 });
        };
        if (opts.dryRun) {
          summary.documentsImported += 1;
          continue;
        }
        const got = await api.downloadDocument(doc, MAX_FILE_BYTES);
        if ("error" in got) {
          const counter = got.error === "too_large" ? "documentsSkipped" : "documentsFailed";
          summary[counter] += 1; // eslint-disable-line security/detect-object-injection -- fixed counter names
          await record(got.error === "too_large" ? "skipped" : "failed", got.error);
          continue;
        }
        const kind = sniffFileKind(got.bytes);
        if (!kind) {
          summary.documentsSkipped += 1;
          await record("skipped", "type_not_allowed");
          continue;
        }
        const sha256 = createHash("sha256").update(got.bytes).digest("hex");
        const [same] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.employeeId, employeeId), eq(documents.sha256, sha256)));
        if (same) {
          summary.documentsDuplicate += 1;
          await record("duplicate", "same_file_already_there", sha256);
          continue;
        }
        const path = `${employeeId}/${randomUUID()}.${extensionOf(kind)}`;
        await storage.write(BUCKETS.employee, path, got.bytes, mimeOf(kind));
        try {
          await db.transaction(async (tx) => {
            await tx.insert(documents).values({ typeId, employeeId, title: sanitizeFileName(doc.client_filename || doc.filename || "TalentHR file", kind).slice(0, 120), status: "active", storageBucket: BUCKETS.employee, storagePath: path, originalName: sanitizeFileName(doc.client_filename || doc.filename || "file", kind), mimeType: mimeOf(kind), sizeBytes: got.bytes.length, sha256, uploadedBy: actor.id, finalizedAt: new Date() });
            await tx.delete(importPullItems).where(and(eq(importPullItems.kind, "document"), eq(importPullItems.sourceId, sourceId), inArray(importPullItems.outcome, ["skipped", "failed", "duplicate"])));
            await tx.insert(importPullItems).values({ pullId: pull.id, kind: "document", sourceId, employeeId, outcome: "imported", sha256 });
          });
          summary.documentsImported += 1;
        } catch {
          await storage.remove(BUCKETS.employee, [path]).catch(() => undefined);
          summary.documentsFailed += 1;
          await record("failed", "save_failed");
        }
      }

      // Leave history: kept as an encrypted archive, never loaded into the leave ledger
      const sourceId = String(person.id);
      const [archived] = await db.select({ id: importPullItems.id }).from(importPullItems).where(and(eq(importPullItems.kind, "leave_history"), eq(importPullItems.sourceId, sourceId), eq(importPullItems.outcome, "archived")));
      if (!archived && !opts.dryRun) {
        const [budgets, requests] = await Promise.all([api.timeOffBudgets(person.id), api.timeOffRequests(person.id)]);
        if (budgets.length > 0 || requests.length > 0) {
          const payloadEnc = fieldCrypto().encrypt(JSON.stringify({ budgets, requests }), archiveContext("leave_history", sourceId));
          await db.insert(importPullItems).values({ pullId: pull.id, kind: "leave_history", sourceId, employeeId, outcome: "archived", payloadEnc });
          summary.leaveArchived += 1;
        }
      }
    }

    // Jobs and applicants: one archive of everything TalentHR holds, so closed candidates are kept but not loaded into recruiting
    const [haveApplicants] = await db.select({ id: importPullItems.id }).from(importPullItems).where(and(eq(importPullItems.kind, "applicants"), eq(importPullItems.sourceId, "all"), eq(importPullItems.outcome, "archived")));
    if (!haveApplicants && !opts.dryRun && !wanted) {
      const [jobs, applicants] = await Promise.all([api.jobPositions(), api.applicants()]);
      const payloadEnc = fieldCrypto().encrypt(JSON.stringify({ jobs, applicants }), archiveContext("applicants", "all"));
      await db.insert(importPullItems).values({ pullId: pull.id, kind: "applicants", sourceId: "all", outcome: "archived", payloadEnc });
      summary.applicantsArchived = applicants.length;
    }

    await db.transaction(async (tx) => {
      await tx.update(importPulls).set({ status: "done", finishedAt: new Date(), summary: summary as unknown as Record<string, number> }).where(eq(importPulls.id, pull.id));
      await writeAudit({ actor, action: "import.pull", targetType: "import_pull", targetId: pull.id, after: { ...summary, dryRun: opts.dryRun } }, tx);
    });
    return { pullId: pull.id, summary };
  } catch (error) {
    await db.update(importPulls).set({ status: "failed", finishedAt: new Date(), summary: summary as unknown as Record<string, number> }).where(eq(importPulls.id, pull.id));
    throw error;
  }
}
