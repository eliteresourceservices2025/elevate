import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { authorize, type ActionName, type AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { sniffFileKind } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { notify } from "@/modules/notifications/service";
import { RESUME_KINDS, RESUME_MAX_BYTES, isApplyable, type OpeningStatus } from "./constants";
import { receivedMail } from "./mail";
import { applicationStageHistory, applications, candidateEmails, candidates, jobOpenings, openingHiringTeam, recruitingSettings } from "./schema";
import { applySchema } from "./validators";

// Internals that take the acting user as an argument: not a "use server" file, so they are not public endpoints.

type Executor = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute">;

export async function hiringTeamIds(executor: Executor, openingId: string): Promise<string[]> {
  const rows = await executor.select({ userId: openingHiringTeam.userId }).from(openingHiringTeam).where(eq(openingHiringTeam.openingId, openingId));
  return rows.map((r) => r.userId);
}

/** Authorizes an action on one opening. A team lead's "team" scope means "on this opening's hiring team". */
export async function authorizeForOpening(user: AuthzUser, action: ActionName, openingId: string) {
  await authorize(user, action, { managerChainUserIds: await hiringTeamIds(db, openingId) });
}

export async function openingIdOfApplication(executor: Executor, applicationId: string): Promise<string | null> {
  const [row] = await executor.select({ openingId: applications.openingId }).from(applications).where(eq(applications.id, applicationId));
  return row?.openingId ?? null;
}

export async function getRetentionSettings(executor: Executor = db) {
  const [row] = await executor.select().from(recruitingSettings).where(eq(recruitingSettings.id, 1));
  return row ?? { id: 1, retentionEnabled: false, rejectedMonths: 12, withdrawnMonths: 6, updatedBy: null, updatedAt: new Date() };
}

export async function queueCandidateEmail(executor: Executor, mail: { applicationId: string; toEmail: string; kind: "received" | "rejection" | "interview"; subject: string; text: string; html: string; dedupeKey: string; attachment?: { fileName: string; mimeType: string; content: string } }) {
  await executor
    .insert(candidateEmails)
    .values({ applicationId: mail.applicationId, toEmail: mail.toEmail, kind: mail.kind, subject: mail.subject, body: JSON.stringify({ text: mail.text, html: mail.html }), attachment: mail.attachment ?? null, dedupeKey: mail.dedupeKey })
    .onConflictDoNothing();
}

/**
 * Marks an application Hired inside the caller's transaction (stage, stage history, audit). Only offers/hiring calls this, after it
 * has authorized. A hire is final; an already hired or rejected application is refused.
 */
export async function markHired(tx: Executor, actor: { id: string; email: string }, applicationId: string): Promise<void> {
  const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId)).for("update");
  if (!app) throw new ActionFailure("That application was not found.");
  if (app.stage === "hired") throw new ActionFailure("They were already hired.");
  if (app.stage === "rejected") throw new ActionFailure("Reopen the application before hiring.");
  await tx.update(applications).set({ stage: "hired", stageChangedAt: new Date(), closedAt: new Date() }).where(eq(applications.id, applicationId));
  await tx.insert(applicationStageHistory).values({ applicationId, fromStage: app.stage, toStage: "hired", byUserId: actor.id, note: "Hired" });
  await writeAudit({ actor, action: "recruiting.move", targetType: "application", targetId: applicationId, before: { stage: app.stage }, after: { stage: "hired" } }, tx);
}

export type ApplyResult = { ok: true } | { ok: false; error: string; field?: string };

/**
 * The public application. The caller (the /api/careers/apply route) has already applied the rate limit. Everything is checked
 * here: the honeypot, the privacy consent, the file by its bytes. A second application to the same opening looks exactly like
 * the first one to the applicant (no hint that an address is known), and adds nothing.
 */
export async function submitApplication(raw: Record<string, unknown>, file: { bytes: Uint8Array; name: string } | null): Promise<ApplyResult> {
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) {
    // A filled honeypot gets the same answer as success, so a bot learns nothing.
    if (parsed.error.issues.some((i) => i.path[0] === "website")) return { ok: true };
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form and try again.", field: String(issue?.path[0] ?? "") };
  }
  const v = parsed.data;

  if (!file || file.bytes.length === 0) return { ok: false, error: "Please attach your resume (PDF or DOCX).", field: "resume" };
  if (file.bytes.length > RESUME_MAX_BYTES) return { ok: false, error: "Your resume is too large. The limit is 4 MB.", field: "resume" };
  const kind = sniffFileKind(file.bytes);
  if (kind !== "pdf" && kind !== "docx") return { ok: false, error: "Your resume must be a PDF or a Word (DOCX) file.", field: "resume" };
  if (!(RESUME_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "Your resume must be a PDF or a Word (DOCX) file.", field: "resume" };

  const [opening] = await db.select().from(jobOpenings).where(eq(jobOpenings.id, v.openingId));
  if (!opening || !isApplyable(opening.status as OpeningStatus, opening.archivedAt !== null)) return { ok: false, error: "This job is no longer accepting applications." };

  const path = `resumes/${randomUUID()}.${kind}`;
  const sha = createHash("sha256").update(file.bytes).digest("hex");
  const storage = getDocumentStorage();
  await storage.write(BUCKETS.recruiting, path, file.bytes, kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

  const displayName = `${v.fullName.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "resume"} - resume.${kind}`;
  try {
    const result = await db.transaction(async (tx) => {
      const [notice] = await tx.execute<{ version: number }>(sql`
        select pv.version from docs.policy_versions pv join docs.policies p on p.id = pv.policy_id
        where p.kind = 'privacy_notice' and pv.status = 'published' order by pv.version desc limit 1`);
      const noticeVersion = notice ? `v${notice.version}` : null;

      const [existing] = await tx.select().from(candidates).where(and(sql`lower(${candidates.email}) = ${v.email}`, sql`${candidates.anonymizedAt} is null`));
      let candidateId: string;
      let oldResume: string | null = null;
      if (existing) {
        const [again] = await tx.select({ id: applications.id }).from(applications).where(and(eq(applications.openingId, opening.id), eq(applications.candidateId, existing.id)));
        if (again) return { duplicate: true as const, oldResume: null };
        candidateId = existing.id;
        oldResume = existing.resumePath;
        await tx.update(candidates).set({ fullName: v.fullName, phone: v.phone ?? existing.phone, country: v.country ?? existing.country, resumePath: path, resumeName: displayName, resumeKind: kind, resumeSha256: sha, consentNoticeVersion: noticeVersion, consentAt: new Date() }).where(eq(candidates.id, candidateId));
      } else {
        const [created] = await tx
          .insert(candidates)
          .values({ email: v.email, fullName: v.fullName, phone: v.phone ?? null, country: v.country ?? null, consentNoticeVersion: noticeVersion, resumePath: path, resumeName: displayName, resumeKind: kind, resumeSha256: sha })
          .returning({ id: candidates.id });
        candidateId = created.id;
      }

      const [app] = await tx.insert(applications).values({ openingId: opening.id, candidateId, note: v.note ?? null }).onConflictDoNothing().returning({ id: applications.id });
      if (!app) return { duplicate: true as const, oldResume: null };

      await tx.insert(applicationStageHistory).values({ applicationId: app.id, fromStage: null, toStage: "applied" });
      await writeAudit({ actor: null, action: "recruiting.apply", targetType: "application", targetId: app.id, after: { openingId: opening.id, noticeVersion } }, tx);

      if (opening.sendAck) {
        const mail = receivedMail({ fullName: v.fullName, jobTitle: opening.title });
        await queueCandidateEmail(tx, { applicationId: app.id, toEmail: v.email, kind: "received", subject: mail.subject, text: mail.text, html: mail.html, dedupeKey: `received:${app.id}` });
      }
      const team = new Set([...(opening.createdBy ? [opening.createdBy] : []), ...(await hiringTeamIds(tx, opening.id))]);
      if (team.size > 0) {
        await notify(tx, [...team].map((userId) => ({ userId, kind: "recruiting.new_application", title: "New application", body: `For ${opening.title}.`, link: `/recruiting/${opening.id}` })));
      }
      return { duplicate: false as const, oldResume };
    });

    if (result.duplicate) {
      await storage.remove(BUCKETS.recruiting, [path]).catch(() => undefined);
      return { ok: true };
    }
    // The newest resume replaces the old one (applicants fix their file); the old object is removed only after the commit.
    if (result.oldResume) await storage.remove(BUCKETS.recruiting, [result.oldResume]).catch(() => undefined);
    return { ok: true };
  } catch (error) {
    await storage.remove(BUCKETS.recruiting, [path]).catch(() => undefined);
    throw error;
  }
}
