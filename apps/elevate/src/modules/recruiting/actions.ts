"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatInZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { userRoles, users } from "@/modules/core/schema";
import { randomUUID } from "node:crypto";
import { createInterviewEvent, deleteInterviewEvent, discardInterviewEvent, removeConnection } from "./calendar";
import { googleEventIdFor } from "./google";
import { queueEmails } from "@/modules/notifications/email-queue";
import { notify } from "@/modules/notifications/service";
import { canMove } from "./constants";
import { buildInterviewIcs, interviewMail, rejectionMail } from "./mail";
import { deleteApplicantSelfId } from "@/modules/demographics/service";
import { offers } from "@/modules/offers/schema";
import { onboardingCases } from "@/modules/onboarding/schema";
import { applicationStageHistory, applications, candidateEmails, candidateNotes, candidates, careersPage, interviewers, interviews, jobOpenings, openingHiringTeam, recruitingSettings, scorecards } from "./schema";
import { sendRecruitingEmailsNow } from "./immediate";
import { authorizeForOpening, freeSlug, openingIdOfApplication, queueCandidateEmail, slugTaken } from "./service";
import { clearBanner } from "./careers-banner";
import { careersPageSchema, cancelInterviewSchema, deleteApplicationSchema, deleteOpeningSchema, interviewSchema, moveSchema, noteSchema, openingSchema, rejectSchema, resumeSchema, retentionSchema, scorecardSchema, setOpeningStatusSchema } from "./validators";

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
        // The web address is kept stable (shared links). It can be changed only while the job is a draft; a job with none gets one.
        let slug = before.slug;
        if (v.slug && v.slug !== before.slug) {
          if (before.status !== "draft") throw new ActionFailure("The web address can only be changed while the job is a draft.");
          if (await slugTaken(tx, v.slug, openingId)) throw new ActionFailure("Another job already uses that web address.");
          slug = v.slug;
        }
        if (!slug) slug = await freeSlug(tx, v.title, openingId);
        await tx.update(jobOpenings).set({ ...fields, slug }).where(eq(jobOpenings.id, openingId));
        await writeAudit({ actor, action: "recruiting.opening_update", targetType: "job_opening", targetId: openingId, before: { title: before.title, status: before.status }, after: { title: v.title } }, tx);
      } else {
        if (v.slug && (await slugTaken(tx, v.slug))) throw new ActionFailure("Another job already uses that web address.");
        const slug = v.slug ?? (await freeSlug(tx, v.title));
        const [row] = await tx.insert(jobOpenings).values({ ...fields, slug, createdBy: actor.id }).returning({ id: jobOpenings.id });
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

/** The careers page's title and introduction. Blank = the built-in wording. */
export async function saveCareersPage(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.manage_careers_page");
    const parsed = careersPageSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const values = { title: parsed.data.title ?? null, intro: parsed.data.intro ?? null, updatedBy: actor.id, updatedAt: new Date() };
    await db.transaction(async (tx) => {
      await tx.insert(careersPage).values({ id: 1, ...values }).onConflictDoUpdate({ target: careersPage.id, set: values });
      await writeAudit({ actor, action: "recruiting.careers_page", targetType: "careers_page", targetId: undefined, after: { title: values.title !== null, intro: values.intro !== null } }, tx);
    });
    revalidatePath("/careers");
    revalidatePath("/recruiting/careers-page");
    return { ok: true, data: undefined };
  });
}

/** Takes the banner off the careers page. */
export async function removeCareersBanner(): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.manage_careers_page");
    await clearBanner(actor);
    revalidatePath("/careers");
    revalidatePath("/recruiting/careers-page");
    return { ok: true, data: undefined };
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

/**
 * Removes a job ad from the lists. A job nobody applied to is erased; one that has applications is archived instead (hidden, with its
 * applications kept for the retention rules), so a delete never destroys an applicant record by accident.
 */
export async function deleteOpening(input: unknown): Promise<ActionResult<{ erased: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.delete_opening");
    const parsed = deleteOpeningSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { id } = parsed.data;
    const erased = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(jobOpenings).where(and(eq(jobOpenings.id, id), isNull(jobOpenings.archivedAt))).for("update");
      if (!before) throw new ActionFailure("That job was not found.");
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(applications).where(eq(applications.openingId, id));
      if (n === 0) {
        await tx.delete(openingHiringTeam).where(eq(openingHiringTeam.openingId, id));
        await tx.delete(jobOpenings).where(eq(jobOpenings.id, id));
      } else {
        await tx.update(jobOpenings).set({ status: "closed", closedAt: before.closedAt ?? new Date(), archivedAt: new Date(), updatedAt: new Date() }).where(eq(jobOpenings.id, id));
      }
      await writeAudit({ actor, action: "recruiting.opening_delete", targetType: "job_opening", targetId: id, before: { status: before.status, title: before.title }, metadata: { erased: n === 0, applications: n } }, tx);
      return n === 0;
    });
    revalidatePath("/careers");
    refresh(id);
    return { ok: true, data: { erased } };
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

/**
 * Erases one application for good, with the applicant, notes, interviews, scorecards and resume if it was their only one. For test
 * data (Super Admin only). Refused once an offer or onboarding exists: those hold signed documents and a person record. The
 * append-only tables are opened for this transaction only, the same way the retention job does it.
 */
export async function deleteApplication(input: unknown): Promise<ActionResult<{ openingId: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.delete_application");
    const parsed = deleteApplicationSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { applicationId } = parsed.data;
    const done = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('talent.retention', 'on', true)`);
      const [app] = await tx.select().from(applications).where(eq(applications.id, applicationId)).for("update");
      if (!app) throw new ActionFailure("That application was not found.");
      const [offer] = await tx.select({ id: offers.id }).from(offers).where(eq(offers.applicationId, applicationId)).limit(1);
      const [onboarding] = await tx.select({ id: onboardingCases.id }).from(onboardingCases).where(eq(onboardingCases.applicationId, applicationId)).limit(1);
      if (offer || onboarding || app.stage === "hired") throw new ActionFailure("This applicant has an offer or was hired, so it cannot be erased.");
      const ivs = await tx.select({ id: interviews.id, eventId: interviews.googleEventId, calendarUserId: interviews.calendarUserId, status: interviews.status }).from(interviews).where(eq(interviews.applicationId, applicationId));
      const ivIds = ivs.map((i) => i.id);
      if (ivIds.length) {
        await tx.delete(scorecards).where(inArray(scorecards.interviewId, ivIds));
        await tx.delete(interviewers).where(inArray(interviewers.interviewId, ivIds));
      }
      await tx.delete(interviews).where(eq(interviews.applicationId, applicationId));
      await tx.delete(candidateNotes).where(eq(candidateNotes.applicationId, applicationId));
      await tx.delete(candidateEmails).where(eq(candidateEmails.applicationId, applicationId));
      await tx.delete(applicationStageHistory).where(eq(applicationStageHistory.applicationId, applicationId));
      await tx.delete(applications).where(eq(applications.id, applicationId));
      // The applicant goes too when this was their only application.
      const [other] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.candidateId, app.candidateId)).limit(1);
      let resumePath: string | null = null;
      if (!other) {
        const [c] = await tx.select({ resumePath: candidates.resumePath }).from(candidates).where(eq(candidates.id, app.candidateId));
        resumePath = c?.resumePath ?? null;
        await deleteApplicantSelfId(tx, app.candidateId);
        await tx.delete(candidates).where(eq(candidates.id, app.candidateId));
      }
      // Ids and counts only, never the applicant's name.
      await writeAudit({ actor, action: "recruiting.application_erase", targetType: "application", targetId: applicationId, before: { stage: app.stage }, metadata: { openingId: app.openingId, interviews: ivIds.length, applicantErased: !other } }, tx);
      return { openingId: app.openingId, resumePath, events: ivs.filter((i) => i.eventId && i.calendarUserId && i.status === "scheduled") };
    });
    if (done.resumePath) await getDocumentStorage().remove(BUCKETS.recruiting, [done.resumePath]);
    for (const e of done.events) await deleteInterviewEvent(e.calendarUserId!, e.eventId!); // best effort: a failure only leaves a calendar event to delete by hand
    refresh(done.openingId, applicationId);
    return { ok: true, data: { openingId: done.openingId } };
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
      await tx.insert(applicationStageHistory).values({ applicationId: v.applicationId, fromStage: row.app.stage, toStage: "rejected", byUserId: actor.id, note: v.kind === "withdrawn" ? "Withdrawn by the applicant" : v.kind === "not_qualified" ? "Not qualified" : "Rejected" });
      await writeAudit({ actor, action: "recruiting.reject", targetType: "application", targetId: v.applicationId, before: { stage: row.app.stage }, after: { stage: "rejected", kind: v.kind } }, tx);
      if (v.kind !== "withdrawn" && v.notifyCandidate && row.sendRejection && !row.anonymized) {
        const mail = rejectionMail({ fullName: row.name, jobTitle: row.title });
        await queueCandidateEmail(tx, { applicationId: v.applicationId, toEmail: row.email, kind: "rejection", subject: mail.subject, text: mail.text, html: mail.html, dedupeKey: `rejection:${v.applicationId}` });
      }
      return row.app.openingId;
    });
    await sendRecruitingEmailsNow();
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

export async function scheduleInterview(input: unknown): Promise<ActionResult<{ id: string; calendar: "google" | "ics"; meetLink: string | null; warning: string | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.interview");
    const parsed = interviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const panel = [...new Set(v.interviewerUserIds)];

    const [row] = await db
      .select({ app: applications, title: jobOpenings.title, name: candidates.fullName, email: candidates.email, anonymized: candidates.anonymizedAt })
      .from(applications)
      .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .where(eq(applications.id, v.applicationId));
    if (!row) return fail("That application was not found.");
    if (row.app.stage === "rejected" || row.app.stage === "hired") return fail("This application is closed.");
    const eligible = await db.select({ userId: userRoles.userId }).from(userRoles).where(and(inArray(userRoles.userId, panel), inArray(userRoles.roleSlug, ELIGIBLE_INTERVIEWER_ROLES)));
    if (new Set(eligible.map((e) => e.userId)).size !== panel.length) return fail("One of the interviewers cannot take part in hiring.");
    const panelUsers = await db.select({ email: users.email }).from(users).where(inArray(users.id, panel));

    // If the person scheduling connected their Google Calendar the event is created there first (with a Meet link, and Google sends
    // the invites); otherwise, or if Google fails, the invites go out as .ics emails as before. Scheduling never fails because of Google.
    const interviewId = randomUUID();
    const calendar = await createInterviewEvent(actor.id, {
      eventId: googleEventIdFor(interviewId),
      summary: `Interview: ${row.title}`,
      description: v.note ?? null,
      location: v.location,
      startsAt: v.startsAt,
      minutes: v.minutes,
      attendeeEmails: [...panelUsers.map((u) => u.email), ...(v.emailCandidate && !row.anonymized ? [row.email] : [])],
    });

    try {
      await db.transaction(async (tx) => {
        const [fresh] = await tx.select({ stage: applications.stage }).from(applications).where(eq(applications.id, v.applicationId));
        if (!fresh || fresh.stage === "rejected" || fresh.stage === "hired") throw new ActionFailure("This application is closed.");
        await tx.insert(interviews).values({
          id: interviewId,
          applicationId: v.applicationId,
          kind: v.kind,
          startsAt: v.startsAt,
          minutes: v.minutes,
          location: v.location,
          note: v.note ?? null,
          createdBy: actor.id,
          ...(calendar.mode === "google" ? { calendarMode: "google", googleEventId: calendar.eventId, meetLink: calendar.meetLink, calendarUserId: actor.id } : {}),
        });
        await tx.insert(interviewers).values(panel.map((userId) => ({ interviewId, userId })));
        await writeAudit({ actor, action: "recruiting.interview_schedule", targetType: "application", targetId: v.applicationId, after: { interviewId, startsAt: v.startsAt.toISOString(), interviewers: panel.length, calendar: calendar.mode } }, tx);

        const when = `${formatInZone(v.startsAt, MANILA, "EEE MMM d, h:mm a")} Manila time`;
        await notify(tx, panel.map((userId) => ({ userId, kind: "recruiting.interview", title: "Interview scheduled", body: `${when}.`, link: `/recruiting/applications/${v.applicationId}` })));
        if (calendar.mode === "ics") {
          const ics = buildInterviewIcs({ uid: interviewId, summary: `Interview: ${row.title}`, startsAt: v.startsAt, minutes: v.minutes, location: v.location, description: v.note });
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
              dedupeKey: `interview:${interviewId}`,
            })),
          );
          if (v.emailCandidate && !row.anonymized) {
            const mail = interviewMail({ fullName: row.name, jobTitle: row.title, when, location: v.location, note: v.note });
            await queueCandidateEmail(tx, { applicationId: v.applicationId, toEmail: row.email, kind: "interview", subject: mail.subject, text: mail.text, html: mail.html, attachment: { fileName: "interview.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview:${interviewId}` });
          }
        }
      });
    } catch (error) {
      if (calendar.mode === "google") await discardInterviewEvent(actor.id, calendar.eventId); // do not leave an orphan event on their calendar
      throw error;
    }
    await sendRecruitingEmailsNow();
    refresh(row.app.openingId, v.applicationId);
    return { ok: true, data: { id: interviewId, calendar: calendar.mode, meetLink: calendar.mode === "google" ? calendar.meetLink : null, warning: calendar.mode === "ics" ? calendar.warning : null } };
  });
}

export async function cancelInterview(input: unknown): Promise<ActionResult<{ warning: string | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "recruiting.interview");
    const parsed = cancelInterviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { interviewId } = parsed.data;
    const done = await db.transaction(async (tx) => {
      const [iv] = await tx.select().from(interviews).where(eq(interviews.id, interviewId)).for("update");
      if (!iv) throw new ActionFailure("That interview was not found.");
      if (iv.status === "cancelled") throw new ActionFailure("It is already cancelled.");
      await tx.update(interviews).set({ status: "cancelled" }).where(eq(interviews.id, interviewId));
      await writeAudit({ actor, action: "recruiting.interview_cancel", targetType: "application", targetId: iv.applicationId, after: { interviewId, calendar: iv.calendarMode } }, tx);
      const panel = await tx.select({ userId: interviewers.userId }).from(interviewers).where(eq(interviewers.interviewId, interviewId));
      await notify(tx, panel.map((p) => ({ userId: p.userId, kind: "recruiting.interview_cancelled", title: "An interview was cancelled", body: "Open the applicant for details.", link: `/recruiting/applications/${iv.applicationId}` })));
      // A Google event is removed from the calendar (Google tells the guests, after the commit). Otherwise cancellation files go out as email.
      if (iv.calendarMode === "ics") {
        const ics = buildInterviewIcs({ uid: iv.id, summary: "Interview cancelled", startsAt: iv.startsAt, minutes: iv.minutes, location: iv.location, method: "CANCEL" });
        await queueEmails(
          tx,
          panel.map((p) => ({ userId: p.userId, kind: "invite" as const, subject: "An interview was cancelled", heading: "Interview cancelled", lines: ["An interview you were part of was cancelled. The attached file removes it from your calendar."], link: `/recruiting/applications/${iv.applicationId}`, attachment: { fileName: "interview-cancelled.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview-cancel:${iv.id}` })),
        );
        const [cand] = await tx.select({ name: candidates.fullName, email: candidates.email, anonymized: candidates.anonymizedAt }).from(applications).innerJoin(candidates, eq(candidates.id, applications.candidateId)).where(eq(applications.id, iv.applicationId));
        if (cand && !cand.anonymized) {
          // Only if they were told about it in the first place.
          await queueCandidateEmail(tx, { applicationId: iv.applicationId, toEmail: cand.email, kind: "interview", subject: "Your interview was cancelled", text: "Hi,\n\nYour interview with Elite Resource Services was cancelled. We will be in touch about a new time.\n\nElite Resource Services", html: "<p>Hi,</p><p>Your interview with Elite Resource Services was cancelled. We will be in touch about a new time.</p>", attachment: { fileName: "interview-cancelled.ics", mimeType: "text/calendar", content: ics }, dedupeKey: `interview-cancel:${iv.id}` });
        }
      }
      return { applicationId: iv.applicationId, eventId: iv.googleEventId, calendarUserId: iv.calendarUserId };
    });
    await sendRecruitingEmailsNow();
    const warning = done.eventId && done.calendarUserId ? await deleteInterviewEvent(done.calendarUserId, done.eventId) : null;
    const openingId = await openingIdOfApplication(db, done.applicationId);
    refresh(openingId ?? undefined, done.applicationId);
    return { ok: true, data: { warning } };
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

/** Disconnects the signed-in person's own Google Calendar: the permission is revoked at Google and the stored token deleted. */
export async function disconnectCalendar(): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await removeConnection(actor);
    revalidatePath("/recruiting");
    return { ok: true, data: undefined };
  });
}
