"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName, timeChainUserIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { rebuildAfterChange } from "./edit-service";
import { clockCorrections, clockEvents, clockEventVoids } from "./schema";
import { MAX_APPEAL_AGE_MS, MAX_EDIT_AGE_MS, checkProposal, lockEmployeeClock, prefsFor } from "./service";
import { editAttendanceSchema, loadDaySchema } from "./validators";

// Changing someone's recorded time: remove events that were recorded wrongly (they are marked removed, never deleted) and add the right
// ones. HR and Super Admin apply the change at once; a Team Lead's change for their team is filed for HR or Super Admin to approve.
// Nobody changes their own time this way. Hours are rebuilt from the events that remain, never edited.

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

function refresh() {
  for (const p of ["/attendance", "/team-attendance", "/hours-review", "/dashboard"]) revalidatePath(p);
}

export type DayEvent = { id: string; type: string; at: string; source: string; removed: boolean };

/** One person's clock events on one calendar day of their own zone (and the evening of the day before, for a night shift), with the ones already removed marked. */
export async function loadEditableDay(input: unknown): Promise<ActionResult<{ zone: string; events: DayEvent[] }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const scope = scopeFor(actor, "attendance.edit_hours");
    if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.edit_hours");
    const parsed = loadDaySchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, date } = parsed.data;
    const [target] = await db.select({ id: employees.id, userId: employees.userId }).from(employees).where(and(eq(employees.id, employeeId), isNull(employees.archivedAt)));
    if (!target) return fail("That person was not found.");
    await authorize(actor, "attendance.edit_hours", { ownerUserId: target.userId ?? undefined, managerChainUserIds: await timeChainUserIds(db, employeeId) });
    const zone = (await prefsFor(db, employeeId)).zone;
    // A day in the person's zone can start a day either side of UTC: read a wide window and keep the events that fall on the day or the night before.
    const from = Date.parse(`${date}T00:00:00Z`) - 2 * 86_400_000;
    const to = Date.parse(`${date}T00:00:00Z`) + 3 * 86_400_000;
    const rows = (await db.execute(sql`
      select e.id, e.type, e.occurred_at, e.source, (v.id is not null) as removed
      from time.clock_events e left join time.clock_event_voids v on v.event_id = e.id
      where e.employee_id = ${employeeId} and e.occurred_at between to_timestamp(${from / 1000}) and to_timestamp(${to / 1000})
      order by e.occurred_at, e.created_at`)) as unknown as { id: string; type: string; occurred_at: string | Date; source: string; removed: boolean }[];
    return { ok: true, data: { zone, events: rows.map((r) => ({ id: r.id, type: r.type, at: new Date(r.occurred_at).toISOString(), source: r.source, removed: r.removed })) } };
  });
}

/**
 * Removes events and adds events for one person, with a reason. HR and Super Admin: applied at once (any date up to a year back, not in
 * the future). Team Lead (their team): filed as a change for HR or Super Admin to approve. Returns whether it was applied.
 */
export async function editAttendance(input: unknown): Promise<ActionResult<{ applied: boolean }>> {
  const actor = await requireUser();
  return runAction<{ applied: boolean }>(async () => {
    const scope = scopeFor(actor, "attendance.edit_hours");
    if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.edit_hours");
    const parsed = editAttendanceSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { employeeId, voidEventIds, reason } = parsed.data;
    const events = parsed.data.events.map((e) => ({ type: e.type, at: new Date(e.at).toISOString() }));
    const [target] = await db
      .select({ id: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(employees)
      .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt)));
    if (!target) return fail("That person was not found.");
    await authorize(actor, "attendance.edit_hours", { ownerUserId: target.userId ?? undefined, managerChainUserIds: await timeChainUserIds(db, employeeId) });
    if (target.userId === actor.id) return fail("Someone else must change your own time. Ask HR or your lead.");
    const maxAgeMs = scope === "all" ? MAX_EDIT_AGE_MS : MAX_APPEAL_AGE_MS;
    const opts = { voidIds: voidEventIds, maxAgeMs };

    // The events to remove must be on this person's record and not already removed.
    const effective = async (executor: Pick<typeof db, "execute">) =>
      voidEventIds.length === 0 ? 0 : (((await executor.execute(sql`select count(*)::int as n from time.v_clock_events where employee_id = ${employeeId} and id = any(${`{${voidEventIds.join(",")}}`}::uuid[])`)) as unknown as { n: number }[])[0]?.n ?? 0);
    if ((await effective(db)) !== voidEventIds.length) return fail("One of those events is not on this person's record, or it was already removed.");
    const problem = await checkProposal(employeeId, events, Date.now(), undefined, opts);
    if (problem) return fail(problem);

    const name = reportName({ first: target.first, last: target.last, preferred: target.preferred });
    const times = [...events.map((e) => Date.parse(e.at))];

    if (scope === "team") {
      // A lead proposes; HR or Super Admin decides (the existing correction queue).
      const hrIds = await hrUserIds();
      await db.transaction(async (tx) => {
        const [{ n }] = (await tx.execute(sql`select count(*)::int as n from time.clock_corrections where employee_id = ${employeeId} and status = 'pending'`)) as unknown as { n: number }[];
        if (n >= 3) throw new ActionFailure("They already have 3 changes waiting.");
        const [row] = await tx.insert(clockCorrections).values({ employeeId, requestedBy: actor.id, reason, kind: "other", proposed: events, voidEventIds }).returning({ id: clockCorrections.id });
        if (target.userId) await notify(tx, { userId: target.userId, kind: "attendance.correction_filed_for_you", title: "A change to your recorded time was proposed", body: reason, link: "/attendance" });
        await notify(tx, hrIds.filter((id) => id !== actor.id && id !== target.userId).map((userId) => ({ userId, kind: "attendance.correction_needed", title: `A change to ${name}'s recorded time was proposed`, body: reason, link: "/attendance?tab=corrections" })));
        await writeAudit({ actor, action: "clock.edit_hours_proposed", targetType: "employee", targetId: employeeId, metadata: { correctionId: row.id, removes: voidEventIds.length, adds: events.length } }, tx);
      });
      refresh();
      return { ok: true, data: { applied: false } };
    }

    // HR / Super Admin: applied now, in one transaction (the person's clock is locked, so a clock click cannot slip in between).
    let earliest = Math.min(...times, Date.now());
    await db.transaction(async (tx) => {
      await lockEmployeeClock(tx, employeeId);
      if ((await effective(tx)) !== voidEventIds.length) throw new ActionFailure("One of those events was changed by someone else a moment ago. Load the day again.");
      const again = await checkProposal(employeeId, events, Date.now(), tx, opts);
      if (again) throw new ActionFailure(again);
      const removedRows = voidEventIds.length === 0 ? [] : ((await tx.execute(sql`select id, type, occurred_at from time.clock_events where id = any(${`{${voidEventIds.join(",")}}`}::uuid[])`)) as unknown as { id: string; type: string; occurred_at: string | Date }[]);
      earliest = Math.min(earliest, ...removedRows.map((r) => new Date(r.occurred_at).getTime()));
      const [row] = await tx
        .insert(clockCorrections)
        .values({ employeeId, requestedBy: actor.id, reason, kind: "other", proposed: events, voidEventIds, status: "approved", decidedBy: actor.id, decidedAt: new Date(), decisionNote: "Changed directly by HR" })
        .returning({ id: clockCorrections.id });
      if (voidEventIds.length > 0) await tx.insert(clockEventVoids).values(voidEventIds.map((eventId) => ({ eventId, reason, voidedBy: actor.id, correctionId: row.id })));
      if (events.length > 0) {
        await tx.insert(clockEvents).values(events.map((e) => ({ employeeId, type: e.type, occurredAt: new Date(e.at), source: "admin_correction", correctionId: row.id, correctionReason: reason, createdBy: actor.id })));
      }
      if (target.userId) await notify(tx, { userId: target.userId, kind: "attendance.time_changed", title: "Your recorded time was changed", body: reason, link: "/attendance" });
      await writeAudit(
        {
          actor,
          action: "clock.edit_hours",
          targetType: "employee",
          targetId: employeeId,
          before: { removed: removedRows.map((r) => ({ id: r.id, type: r.type, at: new Date(r.occurred_at).toISOString() })) },
          after: { added: events },
          metadata: { correctionId: row.id, reason },
        },
        tx,
      );
    });
    await rebuildAfterChange(employeeId, earliest);
    refresh();
    return { ok: true, data: { applied: true } };
  });
}
