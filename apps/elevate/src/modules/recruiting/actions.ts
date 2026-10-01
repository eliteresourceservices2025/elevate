"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { userRoles } from "@/modules/core/schema";
import { queueEmails } from "@/modules/notifications/email-queue";
import { notify } from "@/modules/notifications/service";
import { canMove } from "./constants";
import { buildInterviewIcs, interviewMail, rejectionMail } from "./mail";
import { applicationStageHistory, applications, candidateNotes, candidates, interviewers, interviews, jobOpenings, openingHiringTeam, recruitingSettings, scorecards } from "./schema";
import { authorizeForOpening, openingIdOfApplication, queueCandidateEmail } from "./service";
import { cancelInterviewSchema, interviewSchema, moveSchema, noteSchema, openingSchema, rejectSchema, resumeSchema, retentionSchema, scorecardSchema, setOpeningStatusSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const MANILA = "Asia/Manila";
const ELIGIBLE_INTERVIEWER_ROLES = ["super_admin", "hr_admin", "recruiter", "team_lead"];
const refresh = (openingId?: string, applicationId?: string) => {
  revalidatePath("/recruiting");
  if (openingId) revalidatePath(`/recruiting/${openingId}`);
  if (applicationId) revalidatePath(`/recruiting/applications/${applicationId}`);
};

// ---- Openings -------------------------------------------------------------------------------------------------------------

export async function saveOpening(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.manage_openings");
    const parsed = openingSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const id = await db.transaction(async (tx) => {
      // Only people who can actually be interviewers can be on a hiring team.
      if (v.hiringTeamUserIds.length) {
        const eligible = await tx.select({ userId: userRoles.userId }).from(userRoles).where(and(inArray(userRoles.userId, v.hiringTeamUserIds), inArray(userRoles.roleSlug, ELIGIBLE_INTERVIEWER_ROLES)));
        if (new Set(eligible.map((e) => e.userId)).size !== new Set(v.hiringTeamUserIds).size) throw new ActionFailure("One of the hiring team members cannot take part in hiring.");
      }
      const fields = { title: v.title, description: v.description, location: v.location || "Remote", payNote: v.payNote ?? null, teamId: v.teamId ?? null, clientId: v.clientId ?? null, sendAck: v.sendAck, sendRejection: v.sendRejection, updatedAt: new Date() };
      let openingId = v.id;
      if (openingId) {
        const [before] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, openingId), isNull(jobOpenings.archivedAt)));
        if (!before) throw new ActionFailure("That job was not found.");
        await tx.update(jobOpenings).set(fields).where(eq(jobOpenings.id, openingId));
        await writeAudit({ actor, action: "recruiting.opening_update", targetType: "job_opening", targetId: openingId, before: { title: before.title, status: before.status }, after: { title: v.title } }, tx);
      } else {
        const [row] = await tx.insert(jobOpenings).values({ ...fields, createdBy: actor.id }).returning({ id: jobOpenings.id });
        openingId = row.id;
        await writeAudit({ actor, action: "recruiting.opening_create", targetType: "job_opening", targetId: openingId, after: { title: v.title } }, tx);
      }
      await tx.delete(openingHiringTeam).where(eq(openingHiringTeam.openingId, openingId));
      const team = [...new Set(v.hiringTeamUserIds)];
      if (team.length) await tx.insert(openingHiringTeam).values(team.map((userId) => ({ openingId: openingId as string, userId })));
      return openingId;
    });
    refresh(id);
    return { ok: true, data: { id } };
  });
}

export async function setOpeningStatus(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.manage_openings");
    const parsed = setOpeningStatusSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { id, status } = parsed.data;
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, id), isNull(jobOpenings.archivedAt)));
      if (!before) throw new ActionFailure("That job was not found.");
      if (before.status === status) return;
      await tx
        .update(jobOpenings)
        .set({ status, updatedAt: new Date(), ...(status === "open" ? { openedAt: before.openedAt ?? new Date(), closedAt: null } : {}), ...(status === "closed" ? { closedAt: new Date() } : {}) })
        .where(eq(jobOpenings.id, id));
      await writeAudit({ actor, action: "recruiting.opening_status", targetType: "job_opening", targetId: id, before: { status: before.status }, after: { status } }, tx);
    });
    refresh(id);
    return { ok: true, data: undefined };
  });
}

// ---- Pipeline -------------------------------------------------------------------------------------------------------------

export async function moveApplication(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.move");
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { applicationId, to, note } = parsed.data;
    const openingId = await db.transaction(async (tx) => {
      const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId)).for("update");
      if (!app) throw new ActionFailure("That application was not found.");
      const rule = canMove(app.stage as never, to);
      if (!rule.ok) throw new ActionFailure(rule.reason);
      const reopening = app.stage === "rejected";
      await tx
        .update(applications)
        .set({ stage: to, stageChangedAt: new Date(), ...(reopening ? { closeKind: null, closeReason: null, closedAt: null } : {}), ...(to === "hired" ? { closedAt: new Date() } : {}) })
        .where(eq(applications.id, applicationId));
      await tx.insert(applicationStageHistory).values({ applicationId, fromStage: app.stage, toStage: to, byUserId: actor.id, note: note ?? null });
      await writeAudit({ actor, action: "recruiting.move", targetType: "application", targetId: applicationId, before: { stage: app.stage }, after: { stage: to } }, tx);
      return app.openingId;
    });
    refresh(openingId, applicationId);
    return { ok: true, data: undefined };
  });
}

export async function rejectApplication(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.move");
    const parsed = rejectSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const openingId = await db.transaction(async (tx) => {
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
      await tx.insert(applicationStageHistory).values({ applicationId: v.applicationId, fromStage: row.app.stage, toStage: "rejected", byUserId: actor.id, note: v.kind === "withdrawn" ? "Withdrawn by the applicant" : "Rejected" });
      await writeAudit({ actor, action: "recruiting.reject", targetType: "application", targetId: v.applicationId, before: { stage: row.app.stage }, after: { stage: "rejected", kind: v.kind } }, tx);
      if (v.kind === "rejected" && v.notifyCandidate && row.sendRejection && !row.anonymized) {
        const mail = rejectionMail({ fullName: row.name, jobTitle: row.title });
        await queueCandidateEmail(tx, { applicationId: v.applicationId, toEmail: row.email, kind: "rejection", subject: mail.subject, text: mail.text, html: mail.html, dedupeKey: `rejection:${v.applicationId}` });
      }
      return row.app.openingId;
    });
    refresh(openingId, v.applicationId);
    return { ok: true, data: undefined };
  });
}


export async function addNote(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = noteSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const openingId = await openingIdOfApplication(db, parsed.data.applicationId);
    if (!openingId) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.view", openingId);
    await db.transaction(async (tx) => {
      await tx.insert(candidateNotes).values({ applicationId: parsed.data.applicationId, authorId: actor.id, body: parsed.data.body });
      await writeAudit({ actor, action: "recruiting.note", targetType: "application", targetId: parsed.data.applicationId }, tx);
    });
    refresh(openingId, parsed.data.applicationId);
    return { ok: true, data: undefined };
  });
}

// ---- Interviews and scorecards --------------------------------------------------------------------------------------------

export async function scheduleInterview(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.interview");
    const parsed = interviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const panel = [...new Set(v.interviewerUserIds)];
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ app: applications, title: jobOpenings.title, name: candidates.fullName, email: candidates.email, anonymized: candidates.anonymizedAt })
        .from(applications)
        .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
        .innerJoin(candidates, eq(candidates.id, applications.candidateId))
        .where(eq(applications.id, v.applicationId));
      if (!row) throw new ActionFailure("That application was not found.");
      if (row.app.stage === "rejected" || row.app.stage === "hired") throw new ActionFailure("This application is closed.");
      const eligible = await tx.select({ userId: userRoles.userId }).from(userRoles).where(and(inArray(userRoles.userId, panel), inArray(userRoles.roleSlug, ELIGIBLE_INTERVIEWER_ROLES)));
      if (new Set(eligible.map((e) => e.userId)).size !== panel.length) throw new ActionFailure("One of the interviewers cannot take part in hiring.");

      const [iv] = await tx.insert(interviews).values({ applicationId: v.applicationId, kind: v.kind, startsAt: v.startsAt, minutes: v.minutes, location: v.location, note: v.note ?? null, createdBy: actor.id }).returning({ id: interviews.id });
      await tx.insert(interviewers).values(panel.map((userId) => ({ interviewId: iv.id, userId })));
      await writeAudit({ actor, action: "recruiting.interview_schedule", targetType: "application", targetId: v.applicationId, after: { interviewId: iv.id, startsAt: v.startsAt.toISOString(), interviewers: panel.length } }, tx);

      const when = `${formatInZone(v.startsAt, MANILA, "EEE MMM d, h:mm a")} Manila time`;
      const ics = buildInterviewIcs({ uid: iv.id, summary: `Interview: ${row.title}`, startsAt: v.startsAt, minutes: v.minutes, location: v.location, description: v.note });
      await queueEmails(
        tx,
        panel.map((userId) => ({
          userId,
          kind: "invite" as const,
          subject: "An interview was scheduled with you",
          heading: "Interview scheduled",
          lines: [`You are an interviewer. ${when}.`, "The attached file adds it to your calendar. Open ELEVATE for the details and to fill in your scorecard afterwards."],
          link: `/recruiting/applications/${v.applicationId}`,
          attachment: { fileName: "interview.ics", mimeType: "text/calendar", content: ics },
          dedupeKey: `interview:${iv.id}`,
        })),
      );
      await notify(tx, panel.map((userId) => ({ userId, kind: "recruiting.interview", title: "Interview scheduled", body: `${when}.`, link: `/recruiting/applications/${v.applicationId}` })));
      if (v.emailCandidate && !row.anonymized) {
        const mail = interviewMail({ fullName: row.name, jobTitle: row.title, when, location: v.location, note: v.note });
        await queueCandidateEmail(tx, { applicationId: v.applicationId, toEmail: row.email, kind: "interview", subject: mail.subject, text: mail.text, html: mail.html, attachment: { fileName: "interview.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview:${iv.id}` });
      }
      return iv.id;
    });
    const openingId = await openingIdOfApplication(db, v.applicationId);
    refresh(openingId ?? undefined, v.applicationId);
    return { ok: true, data: { id } };
  });
}

export async function cancelInterview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.interview");
    const parsed = cancelInterviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { interviewId } = parsed.data;
    const applicationId = await db.transaction(async (tx) => {
      const [iv] = await tx.select().from(interviews).where(eq(interviews.id, interviewId)).for("update");
      if (!iv) throw new ActionFailure("That interview was not found.");
      if (iv.status === "cancelled") throw new ActionFailure("It is already cancelled.");
      await tx.update(interviews).set({ status: "cancelled" }).where(eq(interviews.id, interviewId));
      await writeAudit({ actor, action: "recruiting.interview_cancel", targetType: "application", targetId: iv.applicationId, after: { interviewId } }, tx);
      const panel = await tx.select({ userId: interviewers.userId }).from(interviewers).where(eq(interviewers.interviewId, interviewId));
      const ics = buildInterviewIcs({ uid: iv.id, summary: "Interview cancelled", startsAt: iv.startsAt, minutes: iv.minutes, location: iv.location, method: "CANCEL" });
      await queueEmails(
        tx,
        panel.map((p) => ({ userId: p.userId, kind: "invite" as const, subject: "An interview was cancelled", heading: "Interview cancelled", lines: ["An interview you were part of was cancelled. The attached file removes it from your calendar."], link: `/recruiting/applications/${iv.applicationId}`, attachment: { fileName: "interview-cancelled.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview-cancel:${iv.id}` })),
      );
      const [cand] = await tx.select({ name: candidates.fullName, email: candidates.email, anonymized: candidates.anonymizedAt }).from(applications).innerJoin(candidates, eq(candidates.id, applications.candidateId)).where(eq(applications.id, iv.applicationId));
      if (cand && !cand.anonymized) {
        // Only if they were told about it in the first place.
        await queueCandidateEmail(tx, { applicationId: iv.applicationId, toEmail: cand.email, kind: "interview", subject: "Your interview was cancelled", text: `Hi,\n\nYour interview with Elite Resource Services was cancelled. We will be in touch about a new time.\n\nElite Resource Services`, html: `<p>Hi,</p><p>Your interview with Elite Resource Services was cancelled. We will be in touch about a new time.</p>`, attachment: { fileName: "interview-cancelled.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview-cancel:${iv.id}` });
      }
      return iv.applicationId;
    });
    const openingId = await openingIdOfApplication(db, applicationId);
    refresh(openingId ?? undefined, applicationId);
    return { ok: true, data: undefined };
  });
}

export async function submitScorecard(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.scorecard", { ownerUserId: actor.id });
    const parsed = scorecardSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const applicationId = await db.transaction(async (tx) => {
      const [iv] = await tx.select().from(interviews).where(eq(interviews.id, v.interviewId));
      if (!iv) throw new ActionFailure("That interview was not found.");
      if (iv.status === "cancelled") throw new ActionFailure("That interview was cancelled.");
      const [member] = await tx.select({ userId: interviewers.userId }).from(interviewers).where(and(eq(interviewers.interviewId, v.interviewId), eq(interviewers.userId, actor.id)));
      if (!member) throw new ActionFailure("You were not an interviewer for this interview.");
      if (iv.startsAt.getTime() > Date.now()) throw new ActionFailure("You can fill in your scorecard once the interview has started.");
      const [done] = await tx.select({ id: scorecards.id }).from(scorecards).where(and(eq(scorecards.interviewId, v.interviewId), eq(scorecards.interviewerId, actor.id)));
      if (done) throw new ActionFailure("You already submitted your scorecard. It cannot be changed.");
      await tx.insert(scorecards).values({ interviewId: v.interviewId, applicationId: iv.applicationId, interviewerId: actor.id, ratings: v.ratings, recommendation: v.recommendation, comments: v.comments });
      await writeAudit({ actor, action: "recruiting.scorecard", targetType: "application", targetId: iv.applicationId, after: { interviewId: v.interviewId, recommendation: v.recommendation } }, tx);
      return iv.applicationId;
    });
    const openingId = await openingIdOfApplication(db, applicationId);
    refresh(openingId ?? undefined, applicationId);
    return { ok: true, data: undefined };
  });
}

// ---- Resume ---------------------------------------------------------------------------------------------------------------

export async function getResumeLink(input: unknown): Promise<ActionResult<{ url: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = resumeSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const openingId = await openingIdOfApplication(db, parsed.data.applicationId);
    if (!openingId) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.download_resume", openingId);
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");
    const [row] = await db.select({ path: candidates.resumePath, name: candidates.resumeName }).from(applications).innerJoin(candidates, eq(candidates.id, applications.candidateId)).where(eq(applications.id, parsed.data.applicationId));
    if (!row?.path) return fail("There is no resume on file.");
    const url = await getDocumentStorage().createSignedDownload(BUCKETS.recruiting, row.path, 60, row.name ?? "resume");
    await writeAudit({ actor, action: "recruiting.resume_view", targetType: "application", targetId: parsed.data.applicationId });
    return { ok: true, data: { url } };
  });
}

// ---- Retention ------------------------------------------------------------------------------------------------------------

export async function saveRetention(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.manage_retention");
    const parsed = retentionSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(recruitingSettings).where(eq(recruitingSettings.id, 1));
      await tx
        .insert(recruitingSettings)
        .values({ id: 1, retentionEnabled: v.enabled, rejectedMonths: v.rejectedMonths, withdrawnMonths: v.withdrawnMonths, updatedBy: actor.id })
        .onConflictDoUpdate({ target: recruitingSettings.id, set: { retentionEnabled: v.enabled, rejectedMonths: v.rejectedMonths, withdrawnMonths: v.withdrawnMonths, updatedBy: actor.id, updatedAt: new Date() } });
      await writeAudit({ actor, action: "recruiting.retention_settings", targetType: "recruiting_settings", targetId: "1", before: before ? { enabled: before.retentionEnabled, rejected: before.rejectedMonths, withdrawn: before.withdrawnMonths } : null, after: { enabled: v.enabled, rejected: v.rejectedMonths, withdrawn: v.withdrawnMonths } }, tx);
    });
    revalidatePath("/recruiting");
    return { ok: true, data: undefined };
  });
}
