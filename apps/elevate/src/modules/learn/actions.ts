"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { currentSignInMethods } from "@/modules/signing/session";
import { courseInfo } from "./constants";
import { createLaunchToken } from "./service";
import { handoffUrl, learnBaseUrl } from "./token";
import { assignTrainingSchema, grantRetrySchema } from "./validators";

/**
 * Starts the sign-in handoff to ELEVATE Learn: makes a one-time token (60 seconds, stored only as a hash) and returns it with the
 * address to post it to. The browser posts it straight to Learn, so it never appears in a link, history or referrer. Learn then
 * starts its own session; it never sees a password or an ELEVATE cookie.
 */
export async function startLearnLaunch(): Promise<ActionResult<{ token: string; action: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.launch", { ownerUserId: actor.id });
    const base = learnBaseUrl();
    if (!base) return fail("Training is not set up yet. Please ask HR.");
    if (!(await allowRequest("learnLaunch", actor.id))) return fail("You opened training several times in a row. Please wait a few minutes and try again.");

    // How the person signed in (for example password and totp): kept on the Learn session and written on the attestation.
    const methods = ((await currentSignInMethods()) ?? "").split(",").map((m) => m.trim()).filter(Boolean);
    const token = await db.transaction(async (tx) => {
      const issued = await createLaunchToken(tx, actor.id, methods);
      // No token, hash or address is written to the audit log: only that a launch happened.
      await writeAudit({ actor, action: "learn.launch", targetType: "user", targetId: actor.id }, tx);
      return issued;
    });
    return { ok: true, data: { token, action: handoffUrl(base) } };
  });
}

/**
 * HR (or Super Admin) gives someone more tries or more exam time, with a reason (kept in the training record, never edited). Nobody
 * grants their own. Only for a training that is still open.
 */
export async function grantLearnRetry(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.grant_retry");
    const parsed = grantRetrySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const v = parsed.data;

    await db.transaction(async (tx) => {
      const found = (await tx.execute(sql`select a.user_id, a.status, c.slug from learn.assignments a join learn.courses c on c.id = a.course_id where a.id = ${v.assignmentId} for update of a`)) as unknown as { user_id: string; status: string; slug: string }[];
      const a = found[0];
      if (!a) throw new ActionFailure("That training was not found.");
      if (a.user_id === actor.id) throw new ActionFailure("Another HR admin has to give you more tries.");
      if (!["assigned", "in_progress"].includes(a.status)) throw new ActionFailure("That training is not open.");
      await tx.execute(sql`
        insert into learn.retry_grants (assignment_id, user_id, kind, extra_tries, extra_minutes, reason, granted_by)
        values (${v.assignmentId}, ${a.user_id}, ${v.kind}, ${v.kind === "tries" ? v.amount : 0}, ${v.kind === "time" ? v.amount : 0}, ${v.reason}, ${actor.id})`);
      await writeAudit({ actor, action: "learn.grant_retry", targetType: "learn_assignment", targetId: v.assignmentId, metadata: { kind: v.kind, amount: v.amount } }, tx);
      await notify(tx, {
        userId: a.user_id,
        kind: "learn.retry",
        title: v.kind === "tries" ? `You can try the ${courseInfo(a.slug).label} exam again` : `You have extra time for the ${courseInfo(a.slug).label} exam`,
        body: "Open training from the menu to continue.",
        link: "/learn",
      });
    });
    revalidatePath("/training");
    return { ok: true, data: undefined };
  });
}

/** HR puts someone on a course now, on a track (the nightly job does this for everyone who needs it). */
export async function assignLearnTraining(input: unknown): Promise<ActionResult<{ created: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.assign");
    const parsed = assignTrainingSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const { userId, course } = parsed.data;
    const info = courseInfo(course);
    const track = info.fixedTrack ?? parsed.data.track;

    const created = await db.transaction(async (tx) => {
      const version = (await tx.execute(sql`
        select v.id as version_id, c.id as course_id from learn.course_versions v join learn.courses c on c.id = v.course_id
        where c.slug = ${info.slug} and v.status = 'published'`)) as unknown as { version_id: string; course_id: string }[];
      if (!version[0]) throw new ActionFailure("The course is not published yet.");
      const person = (await tx.execute(sql`
        select 1 from core.users u where u.id = ${userId} and u.archived_at is null
          and exists (select 1 from core.employees e where e.user_id = u.id and e.archived_at is null and e.status <> 'separated')`)) as unknown as unknown[];
      if (person.length === 0) throw new ActionFailure("That person is not an active team member with an account.");
      const made = (await tx.execute(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, created_by)
        select ${userId}, ${version[0].course_id}, ${version[0].version_id}, ${track}, 'manual', ((now() at time zone 'America/Phoenix')::date + 30), ${actor.id}
        where not exists (select 1 from learn.assignments a where a.user_id = ${userId} and a.course_id = ${version[0].course_id} and a.status in ('assigned', 'in_progress'))
        returning id`)) as unknown as { id: string }[];
      if (made.length === 0) return false;
      await writeAudit({ actor, action: "learn.assign", targetType: "learn_assignment", targetId: made[0].id, metadata: { track, course: info.slug } }, tx);
      await notify(tx, { userId, kind: "learn.assigned", title: `${info.noun.charAt(0).toUpperCase()}${info.noun.slice(1)} is assigned to you`, body: "Your progress is saved as you go.", link: "/learn" });
      return true;
    });
    revalidatePath("/training");
    return { ok: true, data: { created } };
  });
}
