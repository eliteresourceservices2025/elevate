"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, type Resource } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { managerChainUserIds, todayInZone } from "@/modules/org/service";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { users } from "@/modules/core/schema";
import { checkAnswers, suggestedOverall, type Question } from "./constants";
import { openReviews, peopleForScope, requireOpenCycle, withIds } from "./service";
import { reviewAcknowledgments, reviewCalibrations, reviewCycles, reviewResponses, reviewSettings, reviewTemplates, reviews } from "./schema";
import { acknowledgeSchema, calibrateSchema, cycleIdSchema, earlySettingsSchema, launchCycleSchema, reassignSchema, reviewIdSchema, reviewTemplateSchema, submitReviewSchema, templateIdSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (...paths: string[]) => {
  revalidatePath("/reviews");
  for (const p of paths) revalidatePath(p);
};

/** The review with its person and the people above them (plus a reassigned lead), which is what the access rules need. */
async function loadReview(reviewId: string) {
  const [row] = await db
    .select({ review: reviews, cycle: reviewCycles, employeeUserId: employees.userId, employeeId: employees.id })
    .from(reviews)
    .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
    .innerJoin(employees, eq(employees.id, reviews.employeeId))
    .where(eq(reviews.id, reviewId));
  if (!row) return null;
  const resource: Resource = { ownerUserId: row.employeeUserId ?? undefined, managerChainUserIds: [...new Set([...(await managerChainUserIds(db, row.employeeId)), ...(row.review.leadUserId ? [row.review.leadUserId] : [])])] };
  return { ...row, resource };
}

// ---- Templates (HR) ---------------------------------------------------------------------------------------------------------

export async function saveReviewTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_templates");
    const parsed = reviewTemplateSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    try {
      const id = await db.transaction(async (tx) => {
        let templateId = v.id;
        if (templateId) {
          const [row] = await tx.update(reviewTemplates).set({ name: v.name, questions: withIds(v.questions) }).where(and(eq(reviewTemplates.id, templateId), isNull(reviewTemplates.archivedAt))).returning({ id: reviewTemplates.id });
          if (!row) throw new ActionFailure("That template was not found.");
        } else {
          const [row] = await tx.insert(reviewTemplates).values({ name: v.name, questions: withIds(v.questions), createdBy: actor.id }).returning({ id: reviewTemplates.id });
          templateId = row.id;
        }
        await writeAudit({ actor, action: v.id ? "review.template_update" : "review.template_create", targetType: "review_template", targetId: templateId, after: { questions: v.questions.length } }, tx);
        return templateId;
      });
      refresh("/reviews/templates");
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A template with that name already exists.");
      throw error;
    }
  });
}

export async function archiveReviewTemplate(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_templates");
    const parsed = templateIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.update(reviewTemplates).set({ archivedAt: new Date() }).where(and(eq(reviewTemplates.id, parsed.data.templateId), isNull(reviewTemplates.archivedAt))).returning({ id: reviewTemplates.id });
      if (!row) throw new ActionFailure("That template was not found.");
      // Early reviews fall back to the built-in questions if this was their template
      await tx.update(reviewSettings).set({ earlyTemplateId: null }).where(eq(reviewSettings.earlyTemplateId, row.id));
      await writeAudit({ actor, action: "review.template_archive", targetType: "review_template", targetId: row.id }, tx);
    });
    refresh("/reviews/templates");
    return { ok: true, data: undefined };
  });
}

export async function setEarlyReviews(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_cycles");
    const parsed = earlySettingsSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      if (parsed.data.templateId) {
        const [t] = await tx.select({ id: reviewTemplates.id }).from(reviewTemplates).where(and(eq(reviewTemplates.id, parsed.data.templateId), isNull(reviewTemplates.archivedAt)));
        if (!t) throw new ActionFailure("That template was not found.");
      }
      await tx.update(reviewSettings).set({ earlyEnabled: parsed.data.enabled, earlyTemplateId: parsed.data.templateId ?? null, updatedAt: new Date() }).where(eq(reviewSettings.id, 1));
      await writeAudit({ actor, action: "review.early_settings", targetType: "review_settings", targetId: "1", after: { enabled: parsed.data.enabled } }, tx);
    });
    refresh("/reviews/templates");
    return { ok: true, data: undefined };
  });
}

// ---- Cycles (HR) ------------------------------------------------------------------------------------------------------------

export async function launchReviewCycle(input: unknown): Promise<ActionResult<{ cycleId: string; reviews: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_cycles");
    const parsed = launchCycleSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    if (v.selfDueOn < todayInZone()) return fail("The first due date cannot be in the past.");
    const result = await db.transaction(async (tx) => {
      const [template] = await tx.select().from(reviewTemplates).where(and(eq(reviewTemplates.id, v.templateId), isNull(reviewTemplates.archivedAt)));
      if (!template) throw new ActionFailure("That template was not found.");
      const people = await peopleForScope(tx, v.scope);
      if (people.length === 0) throw new ActionFailure("Nobody matches that selection.");
      const [cycle] = await tx
        .insert(reviewCycles)
        .values({ name: v.name, type: v.type, questions: template.questions as Question[], selfDueOn: v.selfDueOn, leadDueOn: v.leadDueOn, calibrateDueOn: v.calibrateDueOn, createdBy: actor.id })
        .returning({ id: reviewCycles.id });
      const n = await openReviews(tx, { cycleId: cycle.id, employeeIds: people, what: v.name });
      await writeAudit({ actor, action: "review.cycle_launch", targetType: "review_cycle", targetId: cycle.id, after: { type: v.type, reviews: n } }, tx);
      return { cycleId: cycle.id, reviews: n };
    });
    refresh();
    return { ok: true, data: result };
  });
}

export async function closeReviewCycle(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_cycles");
    const parsed = cycleIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.update(reviewCycles).set({ status: "closed", closedAt: new Date() }).where(and(eq(reviewCycles.id, parsed.data.cycleId), eq(reviewCycles.status, "open"))).returning({ id: reviewCycles.id });
      if (!row) throw new ActionFailure("That cycle is already closed.");
      await writeAudit({ actor, action: "review.cycle_close", targetType: "review_cycle", targetId: row.id }, tx);
    });
    refresh(`/reviews/cycles/${parsed.data.cycleId}`);
    return { ok: true, data: undefined };
  });
}

/** HR hands a review to another lead (the person's lead changed mid-cycle) before the lead's review is in. */
export async function reassignReviewer(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.manage_cycles");
    const parsed = reassignSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const loaded = await loadReview(parsed.data.reviewId);
    if (!loaded) return fail("That review was not found.");
    if (loaded.review.leadSubmittedAt) return fail("The lead's review is already in.");
    if (parsed.data.leadUserId === loaded.employeeUserId) return fail("Nobody can review themselves.");
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, parsed.data.leadUserId), isNull(users.archivedAt)));
    if (!u) return fail("That person does not have an active account.");
    await db.transaction(async (tx) => {
      await tx.update(reviews).set({ leadUserId: u.id }).where(eq(reviews.id, loaded.review.id));
      await notify(tx, { userId: u.id, kind: "review.reassigned", title: "A review is waiting for you", body: "Open it to write your review of a team member.", link: `/reviews/${loaded.review.id}` });
      await writeAudit({ actor, action: "review.reassign", targetType: "review", targetId: loaded.review.id, after: { leadUserId: u.id } }, tx);
    });
    refresh(`/reviews/${loaded.review.id}`);
    return { ok: true, data: undefined };
  });
}

// ---- Writing a review -------------------------------------------------------------------------------------------------------

async function submit(actor: Awaited<ReturnType<typeof requireUser>>, role: "self" | "lead", input: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const parsed = submitReviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const loaded = await loadReview(v.reviewId);
    if (!loaded) return fail("You do not have access to do that."); // not there looks the same as not yours
    if (role === "self") {
      await authorize(actor, "reviews.write_self", loaded.resource);
      if (loaded.employeeUserId !== actor.id) return fail("You do not have access to do that.");
    } else {
      await authorize(actor, "reviews.write_lead", loaded.resource);
      if (loaded.employeeUserId === actor.id) return fail("You cannot write the lead's review of your own review.");
    }
    const questions = loaded.cycle.questions as Question[];
    const problem = checkAnswers(questions, v.answers);
    if (problem) return fail(problem);
    const overall = v.overallRating ?? suggestedOverall(questions, v.answers) ?? undefined;
    if (role === "lead" && overall === undefined) return fail("Give an overall rating.");
    try {
      await db.transaction(async (tx) => {
        const [fresh] = await tx.select().from(reviews).where(eq(reviews.id, loaded.review.id)).for("update");
        requireOpenCycle(loaded.cycle.status);
        if (role === "self" && fresh.selfSubmittedAt) throw new ActionFailure("You already submitted your self review.");
        if (role === "lead" && fresh.leadSubmittedAt) throw new ActionFailure("The lead's review is already in.");
        await tx.insert(reviewResponses).values({ reviewId: fresh.id, role, answers: v.answers, overallRating: overall ?? null, comments: v.comments ?? null, authorUserId: actor.id });
        await tx.update(reviews).set(role === "self" ? { selfSubmittedAt: new Date() } : { leadSubmittedAt: new Date() }).where(eq(reviews.id, fresh.id));
        await writeAudit({ actor, action: role === "self" ? "review.self_submit" : "review.lead_submit", targetType: "review", targetId: fresh.id }, tx); // never the answers
        if (role === "lead") {
          const hr = await hrUserIds();
          await notify(tx, hr.filter((id) => id !== loaded.employeeUserId).map((userId) => ({ userId, kind: "review.ready_to_calibrate", title: "A review is ready to calibrate", body: "Open it to set the final rating.", link: `/reviews/${fresh.id}` })));
        } else if (fresh.leadUserId) {
          await notify(tx, { userId: fresh.leadUserId, kind: "review.self_in", title: "A self review was submitted", body: "You will see it once your own review is in.", link: `/reviews/${fresh.id}` });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("That review was already submitted.");
      throw error;
    }
    refresh(`/reviews/${v.reviewId}`);
    return { ok: true, data: undefined };
  });
}

export async function submitSelfReview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return submit(actor, "self", input);
}

export async function submitLeadReview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return submit(actor, "lead", input);
}

// ---- Calibration, sharing, acknowledgment -----------------------------------------------------------------------------------

export async function calibrateReview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.calibrate");
    const parsed = calibrateSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const loaded = await loadReview(v.reviewId);
    if (!loaded) return fail("That review was not found.");
    if (loaded.employeeUserId === actor.id) return fail("Another HR admin has to calibrate your own review.");
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(reviews).where(eq(reviews.id, loaded.review.id)).for("update");
      if (!fresh.leadSubmittedAt) throw new ActionFailure("The lead's review is not in yet.");
      if (fresh.sharedAt) throw new ActionFailure("It was already shared, so it cannot be changed.");
      const [lead] = await tx.select({ overall: reviewResponses.overallRating }).from(reviewResponses).where(and(eq(reviewResponses.reviewId, fresh.id), eq(reviewResponses.role, "lead")));
      if (lead?.overall !== null && lead?.overall !== v.finalRating && !v.changeReason) throw new ActionFailure("Give a reason for changing the lead's rating.");
      await tx.insert(reviewCalibrations).values({ reviewId: fresh.id, finalRating: v.finalRating, summary: v.summary ?? null, changeReason: v.changeReason ?? null, calibratedBy: actor.id });
      await tx.update(reviews).set({ calibratedAt: new Date() }).where(eq(reviews.id, fresh.id));
      await writeAudit({ actor, action: "review.calibrate", targetType: "review", targetId: fresh.id, after: { finalRating: v.finalRating, changed: lead?.overall !== v.finalRating } }, tx);
    });
    refresh(`/reviews/${v.reviewId}`);
    return { ok: true, data: undefined };
  });
}

async function shareRows(actor: Awaited<ReturnType<typeof requireUser>>, ids: string[]): Promise<number> {
  let shared = 0;
  for (const id of ids) {
    const loaded = await loadReview(id);
    if (!loaded || loaded.employeeUserId === actor.id) continue; // another HR admin shares your own
    const ok = await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(reviews).where(eq(reviews.id, id)).for("update");
      if (!fresh.calibratedAt || fresh.sharedAt) return false;
      await tx.update(reviews).set({ sharedAt: new Date() }).where(eq(reviews.id, id));
      const out: { userId: string; kind: string; title: string; body: string; link: string }[] = [];
      if (loaded.employeeUserId) out.push({ userId: loaded.employeeUserId, kind: "review.shared", title: "Your review is ready to read", body: "Open it, read it and acknowledge it.", link: `/reviews/${id}` });
      if (fresh.leadUserId) out.push({ userId: fresh.leadUserId, kind: "review.shared", title: "A review you wrote was shared", body: "The person can now read it.", link: `/reviews/${id}` });
      await notify(tx, out);
      await writeAudit({ actor, action: "review.share", targetType: "review", targetId: id }, tx);
      return true;
    });
    if (ok) shared += 1;
  }
  return shared;
}

export async function shareReview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.share");
    const parsed = reviewIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if ((await shareRows(actor, [parsed.data.reviewId])) === 0) return fail("It must be calibrated, not yet shared, and not your own review.");
    refresh(`/reviews/${parsed.data.reviewId}`);
    return { ok: true, data: undefined };
  });
}

/** Shares every calibrated review of a cycle at once (not HR's own). */
export async function shareCycleReviews(input: unknown): Promise<ActionResult<{ shared: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "reviews.share");
    const parsed = cycleIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const rows = await db.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.cycleId, parsed.data.cycleId), isNull(reviews.sharedAt)));
    const shared = await shareRows(actor, rows.map((r) => r.id));
    refresh(`/reviews/cycles/${parsed.data.cycleId}`);
    return { ok: true, data: { shared } };
  });
}

/** "I have read this", with an optional comment. Only the person it is about. */
export async function acknowledgeReview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = acknowledgeSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const loaded = await loadReview(parsed.data.reviewId);
    if (!loaded || loaded.employeeUserId !== actor.id) return fail("You do not have access to do that.");
    await authorize(actor, "reviews.acknowledge", loaded.resource);
    try {
      await db.transaction(async (tx) => {
        const [fresh] = await tx.select().from(reviews).where(eq(reviews.id, loaded.review.id)).for("update");
        if (!fresh.sharedAt) throw new ActionFailure("It has not been shared with you yet.");
        if (fresh.acknowledgedAt) throw new ActionFailure("You already acknowledged it.");
        await tx.insert(reviewAcknowledgments).values({ reviewId: fresh.id, userId: actor.id, comment: parsed.data.comment ?? null });
        await tx.update(reviews).set({ acknowledgedAt: new Date() }).where(eq(reviews.id, fresh.id));
        await writeAudit({ actor, action: "review.acknowledge", targetType: "review", targetId: fresh.id }, tx);
        const hr = await hrUserIds();
        await notify(tx, hr.filter((id) => id !== actor.id).map((userId) => ({ userId, kind: "review.acknowledged", title: "A review was acknowledged", body: "Open Reviews to see it.", link: `/reviews/${fresh.id}` })));
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("You already acknowledged it.");
      throw error;
    }
    refresh(`/reviews/${parsed.data.reviewId}`);
    return { ok: true, data: undefined };
  });
}
