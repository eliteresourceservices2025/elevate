"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { todayInZone } from "@/modules/org/service";
import { moveLearnHistory } from "@/modules/people/duplicates-service";
import { employees } from "@/modules/people/schema";
import { currentSignInMethods } from "@/modules/signing/session";
import { describeCourse, findLearnCourse } from "./course-catalog";
import { createLaunchToken } from "./service";
import { handoffUrl, learnBaseUrl } from "./token";
import { buildClientEvidence } from "./evidence";
import { evidenceCsv, evidencePdf, summarize } from "./evidence-format";
import { HIPAA_SLUG } from "./constants";
import { convertEssentialsToFull } from "./essentials-conversion";
import { assignTrainingSchema, autoAssignSchema, changeDueDateSchema, convertEssentialsSchema, evidenceExportSchema, grantRetrySchema, repairLearnHistorySchema } from "./validators";

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
      const courseLabel = (await describeCourse(tx, a.slug)).label;
      await notify(tx, {
        userId: a.user_id,
        kind: "learn.retry",
        title: v.kind === "tries" ? `You can try the ${courseLabel} exam again` : `You have extra time for the ${courseLabel} exam`,
        body: "Open training from the menu to continue.",
        link: "/learn",
      });
    });
    revalidatePath("/training");
    return { ok: true, data: undefined };
  });
}

/**
 * HR changes the effective deadline of an open training. The assignment keeps
 * the new date for learner views and reminders, while the old date and reason
 * are retained in `assignment_due_changes` and the audit log.
 */
export async function changeLearnDueDate(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.assign");
    const parsed = changeDueDateSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const v = parsed.data;
    if (v.dueOn < todayInZone()) return fail("The new due date cannot be in the past.");

    const changed = await db.transaction(async (tx) => {
      const found = (await tx.execute(sql`
        select a.user_id, a.status, a.due_on::text as due_on, c.slug
        from learn.assignments a join learn.courses c on c.id = a.course_id
        where a.id = ${v.assignmentId} for update of a`)) as unknown as { user_id: string; status: string; due_on: string; slug: string }[];
      const a = found[0];
      if (!a) throw new ActionFailure("That training was not found.");
      if (a.user_id === actor.id) throw new ActionFailure("Another HR admin has to change your own training deadline.");
      if (!['assigned', 'in_progress'].includes(a.status)) throw new ActionFailure("Only open training has a due date to change.");
      if (a.due_on === v.dueOn) return false;

      await tx.execute(sql`update learn.assignments set due_on = ${v.dueOn}::date where id = ${v.assignmentId}`);
      await tx.execute(sql`
        insert into learn.assignment_due_changes (assignment_id, previous_due_on, due_on, reason, changed_by)
        values (${v.assignmentId}, ${a.due_on}::date, ${v.dueOn}::date, ${v.reason}, ${actor.id})`);
      await writeAudit({ actor, action: "learn.change_due_date", targetType: "learn_assignment", targetId: v.assignmentId, before: { dueOn: a.due_on }, after: { dueOn: v.dueOn }, metadata: { reason: v.reason, course: a.slug } }, tx);
      const courseLabel = (await describeCourse(tx, a.slug)).label;
      await notify(tx, {
        userId: a.user_id,
        kind: "learn.due_date_changed",
        title: `Your ${courseLabel} due date changed`,
        body: `Please finish it by ${v.dueOn}.`,
        link: "/learn",
      });
      return true;
    });
    revalidatePath("/training");
    return { ok: true, data: { changed } };
  });
}

/** HR replaces a legacy HIPAA Essentials assignment with the Full course, keeping the modules already completed. */
export async function convertLearnEssentialsToFull(input: unknown): Promise<ActionResult<{ creditedModules: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.assign");
    const parsed = convertEssentialsSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const result = await db.transaction((tx) => convertEssentialsToFull(tx, actor, parsed.data));
    revalidatePath("/training");
    return { ok: true, data: { creditedModules: result.creditedModules } };
  });
}

/**
 * Transfers assignment-based history from an account with no current employee
 * record to a verified current profile. This is deliberately separate from
 * the merge workflow so historic data is never matched by name alone.
 */
export async function repairOrphanedLearnHistory(input: unknown): Promise<ActionResult<{ assignmentsMoved: number; assignmentsSkipped: number; certificatesMoved: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "people.merge");
    const parsed = repairLearnHistorySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const v = parsed.data;
    const result = await db.transaction(async (tx) => {
      const source = (await tx.execute(sql`
        select u.id
        from core.users u
        where u.id = ${v.sourceUserId} and u.archived_at is null
          and not exists (select 1 from core.employees e where e.user_id = u.id and e.archived_at is null)
        for update`)) as unknown as { id: string }[];
      if (!source[0]) throw new ActionFailure("That learning account is no longer eligible for repair.");
      const [target] = await tx.select({ userId: employees.userId, archivedAt: employees.archivedAt }).from(employees).where(eq(employees.id, v.targetEmployeeId)).for("update");
      if (!target || target.archivedAt || !target.userId) throw new ActionFailure("Choose a current employee with a sign-in account.");
      if (target.userId === v.sourceUserId) throw new ActionFailure("That account already belongs to this employee.");
      const moved = await moveLearnHistory(tx, { fromUserId: v.sourceUserId, toUserId: target.userId, actorId: actor.id, reason: v.reason });
      if (moved.assignmentsMoved === 0 && moved.certificatesMoved === 0) throw new ActionFailure("No transferable learning history was found for that account.");
      await writeAudit({ actor, action: "learn.repair_orphaned_history", targetType: "employee", targetId: v.targetEmployeeId, before: { sourceUserId: v.sourceUserId }, after: moved, metadata: { reason: v.reason } }, tx);
      return moved;
    });
    revalidatePath("/training");
    revalidatePath(`/people/${v.targetEmployeeId}`);
    return { ok: true, data: result };
  });
}

/** HR puts someone on a course now, on a track (the nightly job does this for everyone who needs it). */
export async function assignLearnTraining(input: unknown): Promise<ActionResult<{ created: boolean; queued?: boolean }>> {
  const actor = await requireUser();
  return runAction<{ created: boolean; queued?: boolean }>(async () => {
    await authorize(actor, "learn.assign");
    const parsed = assignTrainingSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const { course } = parsed.data;
    const info = await findLearnCourse(db, course);
    if (!info) return fail("That course was not found.");
    // HIPAA is Full or Refresher: a requested Refresher is kept, anything else (including the retired Essentials) becomes Full.
    const track = info.slug === HIPAA_SLUG ? (parsed.data.track === "refresher" ? "refresher" : "full") : (info.fixedTrack ?? parsed.data.track);

    // A person given by their record may have no account yet (a new hire who was invited and has not signed in). An assignment needs an
    // account, so the request waits in a queue and the nightly run turns it into an assignment once they have signed in.
    let userId = parsed.data.userId;
    if (!userId) {
      const found = (await db.execute(sql`select e.user_id from core.employees e where e.id = ${parsed.data.employeeId} and e.archived_at is null and e.status <> 'separated'`)) as unknown as { user_id: string | null }[];
      if (!found[0]) return fail("That person is not an active team member.");
      userId = found[0].user_id ?? undefined;
      if (!userId) {
        const queued = await db.transaction(async (tx) => {
          const made = (await tx.execute(sql`
            insert into learn.pending_assignments (employee_id, course_id, track, created_by)
            select ${parsed.data.employeeId}, c.id, ${track}, ${actor.id} from learn.courses c
            where c.slug = ${info.slug} and c.archived_at is null
              and exists (select 1 from learn.course_versions v where v.course_id = c.id and v.status = 'published')
            on conflict do nothing
            returning employee_id`)) as unknown as unknown[];
          if (made.length === 0) return false;
          await writeAudit({ actor, action: "learn.assign_queued", targetType: "employee", targetId: parsed.data.employeeId, metadata: { track, course: info.slug } }, tx);
          return true;
        });
        revalidatePath("/training");
        return { ok: true as const, data: { created: false as boolean, queued } };
      }
    }

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

/**
 * HR chooses who a course is assigned to automatically each night: everyone, chosen teams (a pilot), or nobody. Takes effect at the
 * next run; assignments already made are not touched. Audited with the mode and how many teams, never names.
 */
export async function setAutoAssign(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.assign");
    const parsed = autoAssignSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const { course, mode } = parsed.data;
    const teamIds = mode === "teams" ? [...new Set(parsed.data.teamIds)] : [];

    await db.transaction(async (tx) => {
      const found = (await tx.execute(sql`select id from learn.courses where slug = ${course} and archived_at is null`)) as unknown as { id: string }[];
      if (!found[0]) throw new ActionFailure("That course has not been loaded yet.");
      if (teamIds.length > 0) {
        const known = (await tx.execute(sql`select count(*)::int as n from core.teams where id = any(${`{${teamIds.join(",")}}`}::uuid[]) and archived_at is null`)) as unknown as { n: number }[];
        if (known[0].n !== teamIds.length) throw new ActionFailure("One of those teams was not found.");
      }
      const before = (await tx.execute(sql`select mode, cardinality(team_ids)::int as teams from learn.assignment_rules where course_id = ${found[0].id}`)) as unknown as { mode: string; teams: number }[];
      await tx.execute(sql`
        insert into learn.assignment_rules (course_id, mode, team_ids, updated_by, updated_at)
        values (${found[0].id}, ${mode}, ${`{${teamIds.join(",")}}`}::uuid[], ${actor.id}, now())
        on conflict (course_id) do update set mode = excluded.mode, team_ids = excluded.team_ids, updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
      await writeAudit(
        { actor, action: "learn.auto_assign", targetType: "learn_course", targetId: found[0].id, before: before[0] ? { mode: before[0].mode, teams: before[0].teams } : { mode: "all", teams: 0 }, after: { mode, teams: teamIds.length }, metadata: { course } },
        tx,
      );
    });
    revalidatePath("/training");
    return { ok: true, data: undefined };
  });
}

/**
 * HR downloads the training evidence for one client on one date, as a CSV or a PDF: the people assigned that day with their HIPAA
 * and Cybersecurity certificate status. Completion only (no scores, tries or answers). Rate limited and audited with counts.
 */
export async function exportClientEvidence(input: unknown): Promise<ActionResult<{ fileName: string; mimeType: string; content: string; base64: boolean; people: number; trained: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "learn.export_evidence");
    const parsed = evidenceExportSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the request and try again.");
    const { clientId, asOf, format } = parsed.data;
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");

    const report = await buildClientEvidence(db, clientId, asOf);
    if (!report) return fail("That client was not found.");
    const s = summarize(report);
    await writeAudit({ actor, action: "learn.export_evidence", targetType: "client", targetId: clientId, metadata: { asOf, format, people: s.people, trained: s.hipaaValid } });

    const slug = report.clientName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "client";
    if (format === "csv") {
      return { ok: true, data: { fileName: `training-evidence-${slug}-${asOf}.csv`, mimeType: "text/csv;charset=utf-8", content: evidenceCsv(report), base64: false as boolean, people: s.people, trained: s.hipaaValid } };
    }
    const bytes = await evidencePdf(report);
    return { ok: true, data: { fileName: `training-evidence-${slug}-${asOf}.pdf`, mimeType: "application/pdf", content: Buffer.from(bytes).toString("base64"), base64: true as boolean, people: s.people, trained: s.hipaaValid } };
  });
}
