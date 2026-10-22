import "server-only";
import { eq } from "drizzle-orm";

import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { canMove, type CloseKind, type Stage } from "./constants";
import { notQualifiedMail, rejectionMail } from "./mail";
import { applicationStageHistory, applications, candidates, jobOpenings } from "./schema";
import { loadTemplate, queueCandidateEmail } from "./service";

// The two ways an application changes stage, used by the single actions (actions.ts) and by bulk actions. They run inside the
// caller's transaction and assume the caller has already authorized. Not a "use server" file, so these are not public endpoints.

type Actor = { id: string; email: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Moves one application to an open stage (or reopens a closed one). Returns the opening it belongs to. */
export async function moveInTx(tx: Tx, actor: Actor, v: { applicationId: string; to: Stage; note?: string | null }): Promise<string> {
  const [app] = await tx.select().from(applications).where(eq(applications.id, v.applicationId)).for("update");
  if (!app) throw new ActionFailure("That application was not found.");
  const rule = canMove(app.stage as Stage, v.to);
  if (!rule.ok) throw new ActionFailure(rule.reason);
  const reopening = app.stage === "rejected";
  await tx
    .update(applications)
    .set({ stage: v.to, stageChangedAt: new Date(), ...(reopening ? { closeKind: null, closeReason: null, closedAt: null } : {}), ...(v.to === "hired" ? { closedAt: new Date() } : {}) })
    .where(eq(applications.id, v.applicationId));
  await tx.insert(applicationStageHistory).values({ applicationId: v.applicationId, fromStage: app.stage, toStage: v.to, byUserId: actor.id, note: v.note ?? null });
  await writeAudit({ actor, action: "recruiting.move", targetType: "application", targetId: v.applicationId, before: { stage: app.stage }, after: { stage: v.to } }, tx);
  return app.openingId;
}

/** Closes one application (rejected, not qualified or withdrawn) and, when asked and allowed, queues the applicant's polite email. */
export async function closeInTx(tx: Tx, actor: Actor, v: { applicationId: string; kind: CloseKind; reason: string; notifyCandidate: boolean }): Promise<string> {
  const [row] = await tx
    .select({ app: applications, title: jobOpenings.title, sendRejection: jobOpenings.sendRejection, name: candidates.fullName, email: candidates.email, anonymized: candidates.anonymizedAt })
    .from(applications)
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.id, v.applicationId));
  if (!row) throw new ActionFailure("That application was not found.");
  // Lock the application row itself, then work from the locked copy (FOR UPDATE cannot name a schema-qualified table in a join).
  const [locked] = await tx.select().from(applications).where(eq(applications.id, v.applicationId)).for("update");
  row.app = locked;
  if (row.app.stage === "hired") throw new ActionFailure("A hired person cannot be rejected.");
  if (row.app.stage === "rejected") throw new ActionFailure("They are already closed.");
  await tx.update(applications).set({ stage: "rejected", closeKind: v.kind, closeReason: v.reason, closedAt: new Date(), stageChangedAt: new Date() }).where(eq(applications.id, v.applicationId));
  await tx.insert(applicationStageHistory).values({
    applicationId: v.applicationId,
    fromStage: row.app.stage,
    toStage: "rejected",
    byUserId: actor.id,
    note: v.kind === "withdrawn" ? "Withdrawn by the applicant" : v.kind === "not_qualified" ? "Not qualified" : "Rejected",
  });
  await writeAudit({ actor, action: "recruiting.reject", targetType: "application", targetId: v.applicationId, before: { stage: row.app.stage }, after: { stage: "rejected", kind: v.kind } }, tx);
  if (v.kind !== "withdrawn" && v.notifyCandidate && row.sendRejection && !row.anonymized) {
    const person = { fullName: row.name, jobTitle: row.title };
    const mail = v.kind === "not_qualified" ? notQualifiedMail(person, await loadTemplate(tx, "not_qualified")) : rejectionMail(person, await loadTemplate(tx, "rejection"));
    await queueCandidateEmail(tx, { applicationId: v.applicationId, toEmail: row.email, kind: "rejection", subject: mail.subject, text: mail.text, html: mail.html, dedupeKey: `rejection:${v.applicationId}` });
  }
  return row.app.openingId;
}

export const POOL_REFUSED = "They did not agree to be kept for future roles, or that agreement has run out.";

/** Puts one applicant in the talent pool, or takes them out. Only someone who agreed to be kept (and whose agreement has not run out) can go in. */
export async function poolInTx(tx: Tx, actor: Actor, applicationId: string, inPool: boolean): Promise<void> {
  const [app] = await tx.select({ candidateId: applications.candidateId }).from(applications).where(eq(applications.id, applicationId));
  if (!app) throw new ActionFailure("That application was not found.");
  const [c] = await tx.select().from(candidates).where(eq(candidates.id, app.candidateId)).for("update");
  if (!c || c.anonymizedAt) throw new ActionFailure("Their personal data was removed.");
  if (inPool && (!c.poolConsentAt || !c.poolExpiresAt || c.poolExpiresAt <= new Date())) throw new ActionFailure(POOL_REFUSED);
  if (c.inPool === inPool) return;
  await tx.update(candidates).set({ inPool, inPoolBy: inPool ? actor.id : null, inPoolAt: inPool ? new Date() : null }).where(eq(candidates.id, c.id));
  await writeAudit({ actor, action: inPool ? "recruiting.pool_add" : "recruiting.pool_remove", targetType: "candidate", targetId: c.id }, tx);
}
