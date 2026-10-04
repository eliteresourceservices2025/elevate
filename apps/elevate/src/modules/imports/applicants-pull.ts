import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { sniffFileKind } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { createImportedOpening, importApplication } from "@/modules/recruiting/service";
import { activeApplicants } from "./applicants";
import { importPullItems } from "./schema";
import type { TalentHrApi } from "./talenthr-client";

// Loads TalentHR's ACTIVE applicants into recruiting: each job that has any becomes a CLOSED opening (HR reopens one to use it), each active
// applicant a candidate and an application at the matching stage, with their resume when TalentHR gives one. Closed, rejected, hired and
// disqualified applicants stay in the encrypted archive only. No email is queued for anyone. Safe to repeat.

const RESUME_MAX_BYTES = 4 * 1024 * 1024;

export type ApplicantsSummary = { openingsCreated: number; applicantsImported: number; applicantsSkipped: number; resumesImported: number };

export async function importActiveApplicants(actor: { id: string; email: string }, api: TalentHrApi, opts: { dryRun: boolean; pullId: string }): Promise<ApplicantsSummary> {
  const summary: ApplicantsSummary = { openingsCreated: 0, applicantsImported: 0, applicantsSkipped: 0, resumesImported: 0 };
  const storage = getDocumentStorage();
  const done = async (kind: string, sourceId: string) => {
    const [row] = await db
      .select({ id: importPullItems.id, localId: importPullItems.localId })
      .from(importPullItems)
      .where(and(eq(importPullItems.kind, kind), eq(importPullItems.sourceId, sourceId), inArray(importPullItems.outcome, ["imported", "archived"])));
    return row ?? null;
  };

  for (const position of await api.jobPositions()) {
    const rows = await api.positionApplicants(position.id);
    const active = activeApplicants(rows, position.available_steps ?? []);
    if (active.length === 0) continue;

    let openingId: string | null = null;
    const known = await done("opening", String(position.id));
    if (known?.localId) openingId = known.localId;
    else if (!opts.dryRun) {
      openingId = await db.transaction(async (tx) => {
        const id = await createImportedOpening(tx, actor, { title: position.job_position_title, description: position.job_description ?? "", location: position.location_name ?? position.city ?? null });
        await tx.insert(importPullItems).values({ pullId: opts.pullId, kind: "opening", sourceId: String(position.id), outcome: "imported", localId: id });
        return id;
      });
      summary.openingsCreated += 1;
    } else summary.openingsCreated += 1;

    for (const { row, stage } of active) {
      const app = row.application as NonNullable<typeof row.application>;
      const sourceId = String(app.id);
      if (await done("application", sourceId)) {
        summary.applicantsSkipped += 1;
        continue;
      }
      if (opts.dryRun || !openingId) {
        summary.applicantsImported += 1;
        continue;
      }

      // Resume: optional, and never a reason to lose the applicant
      let resume: { path: string; name: string; kind: "pdf" | "docx"; sha256: string } | null = null;
      try {
        const detail = await api.application(position.id, app.id);
        const cv = detail?.applicant_cv;
        if (cv?.cv_url) {
          const got = await api.downloadDocument({ url: cv.cv_url }, RESUME_MAX_BYTES);
          if ("bytes" in got) {
            const kind = sniffFileKind(got.bytes);
            if (kind === "pdf" || kind === "docx") {
              const path = `resumes/${randomUUID()}.${kind}`;
              await storage.write(BUCKETS.recruiting, path, got.bytes, kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
              const name = `${`${row.first_name ?? ""} ${row.last_name ?? ""}`.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "resume"} - resume.${kind}`;
              resume = { path, name, kind, sha256: createHash("sha256").update(got.bytes).digest("hex") };
            }
          }
        }
      } catch {
        resume = null;
      }

      try {
        const result = await db.transaction(async (tx) => {
          const made = await importApplication(tx, actor, {
            openingId: openingId as string,
            email: row.email as string,
            fullName: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
            phone: row.phone,
            stage,
            appliedAt: app.created_at ? new Date(app.created_at) : null,
            note: app.description,
            resume,
          });
          await tx.insert(importPullItems).values({ pullId: opts.pullId, kind: "application", sourceId, outcome: made ? "imported" : "duplicate", reason: made ? null : "already_applied", localId: made?.applicationId ?? null });
          return made;
        });
        if (result) {
          summary.applicantsImported += 1;
          if (resume) summary.resumesImported += 1;
        } else {
          summary.applicantsSkipped += 1;
          if (resume) await storage.remove(BUCKETS.recruiting, [resume.path]).catch(() => undefined);
        }
      } catch {
        if (resume) await storage.remove(BUCKETS.recruiting, [resume.path]).catch(() => undefined);
        summary.applicantsSkipped += 1;
      }
    }
  }
  return summary;
}
