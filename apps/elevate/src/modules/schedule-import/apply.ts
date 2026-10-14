import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { rebuildAttendanceDays } from "@/modules/attendance/jobs";
import { schedules } from "@/modules/attendance/schema";
import { loadSchedules } from "@/modules/attendance/schedule-service";
import { lockEmployeeClock } from "@/modules/attendance/service";
import { notify } from "@/modules/notifications/service";
import { todayInZone } from "@/modules/org/service";
import { clientAssignments, clients, employees } from "@/modules/people/schema";
import { recordHistory } from "@/modules/people/service";
import { buildPlan, type Impact, type Plan, type PlanRow } from "./plan";
import type { Observation } from "./reader";
import { scheduleImportBatches } from "./schema";
import { loadLiveData, type Actor } from "./service";

// APPLYING a reviewed attendance-sheet import (phase 2). It sets client assignments, schedules and hours per week, and ends the old
// records the person ticked. It never touches clock events, approvals or worked hours. Everything is re-read under a lock and
// re-checked at apply time; a row that no longer fits is SKIPPED with the reason instead of being forced, and the rest go ahead.

const MAX_ROWS = 300;
const REBUILD_DAYS_MAX = 35;
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export type Accepted = { key: string; breakMinutes?: number; hoursPerWeek?: number };
export type ApplyInput = {
  batchId: string;
  digest: string;
  accepted: Accepted[];
  endAssignmentIds: string[];
  endDate: string | null;
  acknowledgeBackdated: boolean;
};
export type SkippedRow = { key: string; sheetName: string; sheetClient: string; reason: string };
export type ApplyResult = {
  assignmentsAdded: number;
  assignmentsEnded: number;
  hoursUpdated: number;
  schedulesAdded: number;
  rowsSkipped: SkippedRow[];
  endedByTick: number;
  /** People whose attendance should be rebuilt, and from when. */
  rebuild: { employeeIds: string[]; from: string | null };
};

/** A fingerprint of everything the reviewer was shown: if ELEVATE changed since, the apply is refused and the preview reloaded. */
export function planDigest(plan: Plan): string {
  const shown = {
    rows: plan.rows.map((r) => [r.key, r.personId, r.clientId, r.assignment, r.schedule, r.status, r.hoursNote, r.startTime, r.endTime, r.zone, r.weekdays, r.breakMinutes, r.hoursPerWeek, r.firstDay, r.current, r.impact]),
    decisions: plan.decisions.map((d) => [d.key, d.reasons]),
    gone: plan.notOnSheet.map((n) => [n.assignmentId, n.assignmentStart]),
  };
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
}

/** Counts of dated records that already exist from a date on (read-only). Used for the backdated review. */
async function impactFrom(employeeId: string, from: string): Promise<Impact> {
  const [r] = (await db.execute(sql`
    select
      (select count(*)::int from time.attendance_days where employee_id = ${employeeId} and date >= ${from}::date) as "attendanceDays",
      (select count(*)::int from time.clock_events where employee_id = ${employeeId} and occurred_at >= (${from}::date - interval '1 day')) as "clockEvents",
      (select count(*)::int from time.hours_approvals where employee_id = ${employeeId} and date >= ${from}::date) as approvals,
      (select count(*)::int from time.leave_requests where employee_id = ${employeeId} and end_date >= ${from}::date) as "leaveRequests",
      (select count(*)::int from time.extra_hours_requests where employee_id = ${employeeId} and window_end >= ${from}::date) as "extraHoursRequests"`)) as unknown as Impact[];
  return r;
}

/** The plan as it is right now, with the impact counts filled in for backdated rows. */
export async function currentPlan(observations: Observation[]): Promise<Plan> {
  const plan = buildPlan(observations, await loadLiveData(), { today: todayInZone() });
  for (const row of plan.rows) if (row.backdated) row.impact = await impactFrom(row.personId, row.firstDay);
  return plan;
}

class RowConflict extends Error {}

export async function applyBatch(actor: Actor, input: ApplyInput): Promise<ApplyResult> {
  if (input.accepted.length > MAX_ROWS || input.endAssignmentIds.length > MAX_ROWS) throw new ActionFailure("Too many rows at once. Apply in smaller groups.");
  if (input.accepted.length === 0 && input.endAssignmentIds.length === 0) throw new ActionFailure("Choose at least one change to apply.");

  const [batch] = await db.select().from(scheduleImportBatches).where(eq(scheduleImportBatches.id, input.batchId));
  if (!batch || batch.status !== "preview" || !batch.payloadEnc) throw new ActionFailure("That upload is no longer available. Upload the sheet again.");
  const observations = JSON.parse(fieldCrypto().decrypt(batch.payloadEnc, `schedule_import:${batch.id}`)) as Observation[];

  const plan = await currentPlan(observations);
  if (planDigest(plan) !== input.digest) throw new ActionFailure("ELEVATE changed since you opened this preview. Reload it and review again.");

  const today = todayInZone();
  const byKey = new Map(plan.rows.map((r) => [r.key, r]));
  const chosen: { row: PlanRow; accepted: Accepted }[] = [];
  const seen = new Set<string>();
  for (const a of input.accepted) {
    const row = byKey.get(a.key);
    if (!row || row.status !== "update") throw new ActionFailure("One of the chosen rows is no longer a change. Reload the preview.");
    if (seen.has(a.key)) throw new ActionFailure("A row was chosen twice.");
    seen.add(a.key);
    chosen.push({ row, accepted: a });
  }
  if (chosen.some((c) => c.row.backdated) && !input.acknowledgeBackdated) throw new ActionFailure("Some changes start more than 7 days back. Confirm that you reviewed what they affect.");

  const goneById = new Map(plan.notOnSheet.map((n) => [n.assignmentId, n]));
  for (const id of input.endAssignmentIds) if (!goneById.has(id)) throw new ActionFailure("One of the assignments to end is no longer listed. Reload the preview.");
  if (input.endAssignmentIds.length > 0) {
    if (!input.endDate) throw new ActionFailure("Choose the last day for the assignments you are ending.");
    if (input.endDate > today) throw new ActionFailure("The last day cannot be in the future.");
  }

  const result: ApplyResult = { assignmentsAdded: 0, assignmentsEnded: 0, hoursUpdated: 0, schedulesAdded: 0, rowsSkipped: [], endedByTick: 0, rebuild: { employeeIds: [], from: null } };
  const rebuild = new Map<string, string>();

  await db.transaction(async (tx) => {
    for (const { row, accepted } of chosen) {
      const breakMinutes = accepted.breakMinutes ?? row.breakMinutes;
      const hours = accepted.hoursPerWeek ?? row.hoursPerWeek;
      // Counts are collected per row and added only when the row's savepoint commits (a skipped row is rolled back whole).
      const delta = { added: 0, ended: 0, hours: 0, schedules: 0 };
      try {
        // One savepoint per person: a row that does not fit is skipped and rolled back alone.
        await tx.transaction(async (sp) => {
          await lockEmployeeClock(sp, row.personId);
          const [person] = await sp.select({ userId: employees.userId, status: employees.status }).from(employees).where(and(eq(employees.id, row.personId), isNull(employees.archivedAt))).for("update");
          if (!person || person.status === "separated") throw new RowConflict("The person is no longer active.");
          const [client] = await sp.select({ name: clients.name, isActive: clients.isActive }).from(clients).where(and(eq(clients.id, row.clientId), isNull(clients.archivedAt)));
          if (!client || !client.isActive) throw new RowConflict("The client is no longer active.");

          const open = await sp.select().from(clientAssignments).where(and(eq(clientAssignments.employeeId, row.personId), isNull(clientAssignments.endDate))).for("update");
          const sameClient = open.find((a) => a.clientId === row.clientId) ?? null;
          const others = open.filter((a) => a.clientId !== row.clientId);
          const dayBefore = addDays(row.firstDay, -1);

          // Assignments
          if (others.length > 0 && row.assignment !== "change_client") throw new RowConflict("The person's current assignments changed since the preview.");
          for (const old of others) {
            if (old.startDate > dayBefore) throw new RowConflict("The current assignment started on or after the new start date: correct it on the person's Clients tab.");
            await sp.update(clientAssignments).set({ endDate: dayBefore, updatedAt: new Date() }).where(eq(clientAssignments.id, old.id));
            await recordHistory(sp, { employeeId: row.personId, eventType: "client_ended", summary: "Assignment ended by the attendance sheet import", before: { endDate: null }, after: { endDate: dayBefore }, changedBy: actor.id, effectiveDate: dayBefore });
            await writeAudit({ actor, action: "assignment.end", targetType: "employee", targetId: row.personId, metadata: { assignmentId: old.id, source: "schedule_import" } }, sp);
            delta.ended += 1;
          }
          if (!sameClient) {
            // never overlap a past assignment to the same client
            const clash = (await sp.execute(sql`
              select 1 from core.client_assignments where employee_id = ${row.personId} and client_id = ${row.clientId}
                and start_date <= ${row.firstDay}::date and (end_date is null or end_date >= ${row.firstDay}::date) limit 1`)) as unknown as unknown[];
            if (clash.length > 0) throw new RowConflict("The person already has an assignment to this client that overlaps the start date.");
            const [made] = await sp.insert(clientAssignments).values({ employeeId: row.personId, clientId: row.clientId, startDate: row.firstDay, hoursPerWeek: String(hours), createdBy: actor.id }).returning({ id: clientAssignments.id });
            await recordHistory(sp, { employeeId: row.personId, eventType: "client_assigned", summary: `Assigned to ${client.name} (${hours} h/week) by the attendance sheet import`, after: { clientId: row.clientId, startDate: row.firstDay, hoursPerWeek: hours }, changedBy: actor.id, effectiveDate: row.firstDay });
            await writeAudit({ actor, action: "assignment.create", targetType: "employee", targetId: row.personId, metadata: { assignmentId: made.id, clientId: row.clientId, source: "schedule_import" } }, sp);
            delta.added += 1;
          } else if (row.hoursNote !== null && Number(sameClient.hoursPerWeek ?? -1) !== hours) {
            await sp.update(clientAssignments).set({ hoursPerWeek: String(hours), updatedAt: new Date() }).where(eq(clientAssignments.id, sameClient.id));
            await recordHistory(sp, {
              employeeId: row.personId, eventType: "profile_changed", summary: "Hours per week set by the attendance sheet import",
              before: { hoursPerWeek: sameClient.hoursPerWeek === null ? null : Number(sameClient.hoursPerWeek) }, after: { hoursPerWeek: hours }, changedBy: actor.id, effectiveDate: today,
            });
            await writeAudit({ actor, action: "assignment.update", targetType: "employee", targetId: row.personId, before: { hoursPerWeek: sameClient.hoursPerWeek }, after: { hoursPerWeek: hours }, metadata: { assignmentId: sameClient.id, source: "schedule_import" } }, sp);
            delta.hours += 1;
          }

          // Schedule
          if (row.schedule !== "same") {
            const existing = await loadSchedules(sp, row.personId);
            const later = existing.find((s) => s.effectiveFrom >= row.firstDay);
            if (later) throw new RowConflict("The person already has a schedule starting on or after that date.");
            const current = existing.find((s) => s.effectiveTo === null || s.effectiveTo >= row.firstDay);
            if (current) await sp.update(schedules).set({ effectiveTo: dayBefore }).where(eq(schedules.id, current.id));
            await sp.insert(schedules).values({ employeeId: row.personId, effectiveFrom: row.firstDay, effectiveTo: null, startTime: row.startTime, endTime: row.endTime, weekdays: row.weekdays, breakMinutes, zone: row.zone, createdBy: actor.id });
            await writeAudit(
              { actor, action: "schedule.assign", targetType: "employee", targetId: row.personId, before: current ? { effectiveFrom: current.effectiveFrom, startTime: current.startTime, endTime: current.endTime, weekdays: current.weekdays, zone: current.zone } : null,
                after: { effectiveFrom: row.firstDay, startTime: row.startTime, endTime: row.endTime, weekdays: row.weekdays, breakMinutes, zone: row.zone }, metadata: { source: "schedule_import" } },
              sp,
            );
            delta.schedules += 1;
            if (person.userId) {
              await notify(sp, { userId: person.userId, kind: "schedule.assigned", title: "Your schedule was set", body: `Your shift and client were updated from ${row.firstDay}. See Schedules for the details.`, link: "/schedules" });
            }
          }
        });
        result.assignmentsAdded += delta.added;
        result.assignmentsEnded += delta.ended;
        result.hoursUpdated += delta.hours;
        result.schedulesAdded += delta.schedules;
        const was = rebuild.get(row.personId);
        if (!was || row.firstDay < was) rebuild.set(row.personId, row.firstDay);
      } catch (error) {
        if (error instanceof RowConflict) {
          result.rowsSkipped.push({ key: row.key, sheetName: row.sheetName, sheetClient: row.sheetClient, reason: error.message });
          continue;
        }
        // A constraint (overlapping schedule, duplicate open assignment) is a reason, not a crash.
        const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
        if (code === "23P01" || code === "23505") {
          result.rowsSkipped.push({ key: row.key, sheetName: row.sheetName, sheetClient: row.sheetClient, reason: "The change overlaps an existing record: correct it on the person's profile." });
          continue;
        }
        throw error;
      }
    }

    for (const id of input.endAssignmentIds) {
      const gone = goneById.get(id)!;
      await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, gone.employeeId)).for("update");
      const [a] = await tx.select().from(clientAssignments).where(eq(clientAssignments.id, id)).for("update");
      if (!a || a.endDate) continue;
      if (input.endDate! < a.startDate) {
        result.rowsSkipped.push({ key: id, sheetName: gone.personName, sheetClient: gone.clientName, reason: "The last day is before the assignment started." });
        continue;
      }
      await tx.update(clientAssignments).set({ endDate: input.endDate, updatedAt: new Date() }).where(eq(clientAssignments.id, id));
      await recordHistory(tx, { employeeId: a.employeeId, eventType: "client_ended", summary: "Assignment ended after the attendance sheet import", before: { endDate: null }, after: { endDate: input.endDate }, changedBy: actor.id, effectiveDate: input.endDate! });
      await writeAudit({ actor, action: "assignment.end", targetType: "employee", targetId: a.employeeId, metadata: { assignmentId: id, source: "schedule_import" } }, tx);
      result.endedByTick += 1;
      const was = rebuild.get(a.employeeId);
      if (!was || input.endDate! < was) rebuild.set(a.employeeId, input.endDate!);
    }

    await tx
      .update(scheduleImportBatches)
      .set({
        status: "applied", payloadEnc: null, appliedAt: new Date(), appliedBy: actor.id,
        result: { assignmentsAdded: result.assignmentsAdded, assignmentsEnded: result.assignmentsEnded, hoursUpdated: result.hoursUpdated, schedulesAdded: result.schedulesAdded, endedByTick: result.endedByTick, skipped: result.rowsSkipped.length },
      })
      .where(eq(scheduleImportBatches.id, batch.id));
    // Counts only: never a name, a client or a schedule.
    await writeAudit(
      { actor, action: "scheduleimport.apply", targetType: "schedule_import_batch", targetId: batch.id,
        after: { assignmentsAdded: result.assignmentsAdded, assignmentsEnded: result.assignmentsEnded, hoursUpdated: result.hoursUpdated, schedulesAdded: result.schedulesAdded, endedByTick: result.endedByTick, skipped: result.rowsSkipped.length, backdated: chosen.filter((c) => c.row.backdated).length } },
      tx,
    );
  });

  const from = [...rebuild.values()].sort()[0] ?? null;
  result.rebuild = { employeeIds: [...rebuild.keys()], from };
  return result;
}

/**
 * Recomputes attendance days for the people an apply changed, from their clock events (never from the sheet), so late, absence and
 * extra-hours flags follow the new schedule. Bounded to the last 35 days; older dates need the maintenance command. Safe to repeat.
 */
export async function rebuildAfterApply(employeeIds: string[], from: string | null, now = new Date()): Promise<{ rebuilt: number; failed: number; limitedFrom: string | null }> {
  if (!from) return { rebuilt: 0, failed: 0, limitedFrom: null };
  const today = todayInZone();
  const wanted = Math.max(1, daysBetween(from, today) + 1);
  const daysBack = Math.min(wanted, REBUILD_DAYS_MAX);
  const limitedFrom = wanted > REBUILD_DAYS_MAX ? addDays(today, -REBUILD_DAYS_MAX) : null;
  let rebuilt = 0;
  let failed = 0;
  for (const id of employeeIds) {
    try {
      await rebuildAttendanceDays(now, daysBack, id);
      rebuilt += 1;
    } catch (error) {
      failed += 1;
      console.error("schedule import rebuild failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  return { rebuilt, failed, limitedFrom };
}

/** The preview the page shows: the plan with impact counts for backdated rows, and the digest the apply must present. */
export async function previewForBatch(batchId: string): Promise<{ batch: { id: string; fileName: string; layout: string; createdAt: Date; observations: number }; plan: Plan; digest: string } | null> {
  const [b] = await db.select().from(scheduleImportBatches).where(eq(scheduleImportBatches.id, batchId));
  if (!b || b.status !== "preview" || !b.payloadEnc) return null;
  const observations = JSON.parse(fieldCrypto().decrypt(b.payloadEnc, `schedule_import:${b.id}`)) as Observation[];
  const plan = await currentPlan(observations);
  return { batch: { id: b.id, fileName: b.fileName, layout: b.layout, createdAt: b.createdAt, observations: b.observationCount }, plan, digest: planDigest(plan) };
}
