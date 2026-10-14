import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { redact } from "../src/lib/redact";
import { auditLog } from "../src/modules/audit/schema";
import { schedules } from "../src/modules/attendance/schema";
import { clientAssignments, employmentHistory } from "../src/modules/people/schema";
import { digest, historicalSchema, type HistoricalMapping } from "./schedule-import-core";
import type { ApprovedTarget } from "./schedule-import-service";

type Assignment = { id: string; clientId: string; startDate: string; endDate: string | null; hoursPerWeek: number | null };
type Schedule = { id: string; effectiveFrom: string; effectiveTo: string | null; startTime: string; endTime: string; zone: string; weekdays: number[]; breakMinutes: number };
type Impact = { attendanceDays: number; clockEvents: number; approvals: number; leaveRequests: number; extraHoursRequests: number };
type Change = { employeeId: string; assignment: "add" | "correct" | "unchanged"; schedule: "add" | "correct" | "unchanged"; before: { assignment: Assignment | null; schedule: Schedule | null }; after: { assignment: Omit<Assignment, "id">; schedule: Omit<Schedule, "id"> }; impact: Impact };
export type HistoricalReport = { digest: string; period: { from: string; to: string }; changes: Change[]; totals: { assignments: number; schedules: number; unchanged: number; attendanceDays: number; clockEvents: number; approvals: number; leaveRequests: number; extraHoursRequests: number }; applied: boolean };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Deliberately narrow: an existing historical timeline with multiple rows or another overlapping client cannot be inferred from this sheet.
export async function reconcileHistorical(client: ReturnType<typeof postgres>, mapping: HistoricalMapping, actorEmail: string,
  target: ApprovedTarget, sourceDigest: string, approvedDigest?: string): Promise<HistoricalReport> {
  const parsed = historicalSchema.parse(mapping);
  if (new Set(parsed.entries.map((entry) => entry.employeeId)).size !== parsed.entries.length ||
      parsed.entries.some((entry, index) => index > 0 && parsed.entries[index - 1].employeeId > entry.employeeId))
    throw new Error("Historical entries must be unique and sorted by employee ID.");
  if (parsed.entries.length !== parsed.decisions.length ||
      parsed.entries.some((entry) => !parsed.decisions.some((decision) => decision.employeeId === entry.employeeId) ||
        entry.assignmentStartDate < parsed.period.from || entry.assignmentStartDate > parsed.period.to ||
        entry.shift.effectiveFrom < parsed.period.from || entry.shift.effectiveFrom > parsed.period.to) ||
      new Set(parsed.decisions.map((decision) => decision.employeeId)).size !== parsed.decisions.length)
    throw new Error("Historical decisions or dates do not match the reviewed October mapping.");
  const db = drizzle(client);
  return db.transaction(async (tx) => {
    if (!approvedDigest) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const [identity] = await tx.execute<{ database: string }>(sql`SELECT current_database() AS database`);
    if (identity?.database !== target.name) throw new Error("Database identity changed.");
    const [actor] = await tx.execute<{ id: string; email: string }>(sql`
      SELECT u.id, u.email FROM core.users u JOIN core.user_roles r ON r.user_id = u.id
      WHERE lower(u.email) = lower(${actorEmail}) AND u.archived_at IS NULL
        AND r.role_slug IN ('hr_admin', 'super_admin') LIMIT 1`);
    if (!actor) throw new Error("An active HR Admin or Super Admin actor is required.");
    const changes: Change[] = [];
    const inventory: unknown[] = [];
    for (const entry of parsed.entries) {
      const decision = parsed.decisions.find((item) => item.employeeId === entry.employeeId)!;
      if (approvedDigest) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`clock:${entry.employeeId}`}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`hours:${entry.employeeId}`}))`);
      }
      const [person] = await tx.execute<{ id: string; work_email: string }>(sql`
        SELECT id, work_email FROM core.employees WHERE id = ${entry.employeeId}
        AND archived_at IS NULL AND status <> 'separated' ${approvedDigest ? sql`FOR UPDATE` : sql``}`);
      if (!person || person.work_email.toLowerCase() !== entry.employeeWorkEmail.toLowerCase())
        throw new Error("An employee mapping is no longer valid.");
      const [company] = await tx.execute<{ id: string; name: string }>(sql`
        SELECT id, name FROM core.clients WHERE id = ${entry.clientId} AND archived_at IS NULL AND is_active = true
        ${approvedDigest ? sql`FOR SHARE` : sql``}`);
      if (!company || company.name !== entry.clientName) throw new Error("A client mapping is no longer valid.");
      const assignmentRows = await tx.execute<{ id: string; client_id: string; start_date: string; end_date: string | null; hours_per_week: string | null }>(sql`
        SELECT id, client_id, start_date::text, end_date::text, hours_per_week::text
        FROM core.client_assignments WHERE employee_id = ${entry.employeeId} ORDER BY start_date, id`);
      const scheduleRows = await tx.execute<{ id: string; effective_from: string; effective_to: string | null; start_time: string; end_time: string; zone: string; weekdays: number[]; break_minutes: number }>(sql`
        SELECT id, effective_from::text, effective_to::text, start_time, end_time, zone, weekdays, break_minutes
        FROM time.schedules WHERE employee_id = ${entry.employeeId} ORDER BY effective_from, id`);
      const assignments = assignmentRows.map((row): Assignment => ({ id: row.id, clientId: row.client_id, startDate: row.start_date,
        endDate: row.end_date, hoursPerWeek: row.hours_per_week === null ? null : Number(row.hours_per_week) }));
      const shifts = scheduleRows.map((row): Schedule => ({ id: row.id, effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to, startTime: row.start_time, endTime: row.end_time, zone: row.zone,
        weekdays: row.weekdays, breakMinutes: row.break_minutes }));
      if (assignments.length > 1 || shifts.length > 1 || assignments.some((row) => row.clientId !== entry.clientId))
        throw new Error("Existing dated or other-client history needs individual HR review.");
      const beforeAssignment = assignments[0] ?? null, beforeSchedule = shifts[0] ?? null;
      // A correction is limited to one currently open row. Closed intervals and later dated rows are never overwritten.
      if (beforeSchedule && beforeSchedule.effectiveFrom > entry.shift.effectiveFrom)
        throw new Error("A later dated schedule cannot be overwritten.");
      if ((beforeAssignment && beforeAssignment.endDate !== null) || (beforeSchedule && beforeSchedule.effectiveTo !== null))
        throw new Error("Closed historical intervals need individual HR review.");
      const expectedAssignment = decision.expectedAssignment;
      const expectedSchedule = decision.expectedSchedule;
      if (!same(beforeAssignment, expectedAssignment) || !same(beforeSchedule, expectedSchedule))
        throw new Error("A reviewed before-state changed. Prepare a new private mapping and preview.");
      const afterAssignment = { clientId: entry.clientId, startDate: entry.assignmentStartDate, endDate: null,
        hoursPerWeek: entry.hoursPerWeek };
      const afterSchedule = { effectiveFrom: entry.shift.effectiveFrom, effectiveTo: null,
        startTime: entry.shift.startTime, endTime: entry.shift.endTime, zone: entry.shift.zone,
        weekdays: entry.shift.weekdays, breakMinutes: entry.shift.breakMinutes };
      const assignment = !beforeAssignment ? "add" : same({ clientId: beforeAssignment.clientId, startDate: beforeAssignment.startDate,
        endDate: beforeAssignment.endDate, hoursPerWeek: beforeAssignment.hoursPerWeek }, afterAssignment) ? "unchanged" : "correct";
      if (assignment === "correct" && beforeAssignment?.startDate < entry.assignmentStartDate)
        throw new Error("Narrowing a prior assignment needs individual HR correction review.");
      if (assignment === "correct" && beforeAssignment?.hoursPerWeek !== entry.hoursPerWeek)
        throw new Error("Changing agreed weekly hours needs individual HR correction review.");
      const schedule = !beforeSchedule ? "add" : same({ effectiveFrom: beforeSchedule.effectiveFrom, effectiveTo: beforeSchedule.effectiveTo,
        startTime: beforeSchedule.startTime, endTime: beforeSchedule.endTime, zone: beforeSchedule.zone,
        weekdays: beforeSchedule.weekdays, breakMinutes: beforeSchedule.breakMinutes }, afterSchedule) ? "unchanged" : "correct";
      // Historical schedules are dated records. This batch may add one or recognize an exact row,
      // but must not rewrite an existing shift or silently close a later approved pattern.
      if (schedule === "correct") throw new Error("An existing schedule needs individual HR correction review.");
      // A changed present-day schedule/assignment must be acknowledged as a change to all dates since October.
      const impactFrom = entry.assignmentStartDate < entry.shift.effectiveFrom ? entry.assignmentStartDate : entry.shift.effectiveFrom;
      const [impact] = await tx.execute<Impact>(sql`
        SELECT
          (SELECT count(*)::int FROM time.attendance_days WHERE employee_id = ${entry.employeeId} AND date >= ${impactFrom}::date)::int AS "attendanceDays",
          (SELECT count(*)::int FROM time.clock_events WHERE employee_id = ${entry.employeeId} AND occurred_at >= (${impactFrom}::date - interval '1 day'))::int AS "clockEvents",
          (SELECT count(*)::int FROM time.hours_approvals WHERE employee_id = ${entry.employeeId} AND date >= ${impactFrom}::date)::int AS approvals,
          (SELECT count(*)::int FROM time.leave_requests WHERE employee_id = ${entry.employeeId} AND end_date >= ${impactFrom}::date)::int AS "leaveRequests",
          (SELECT count(*)::int FROM time.extra_hours_requests WHERE employee_id = ${entry.employeeId} AND window_end >= ${impactFrom}::date)::int AS "extraHoursRequests"`);
      // The reviewed digest must change if dependent rows change, even when their counts stay the same.
      const [dependencies] = await tx.execute<{ fingerprint: string }>(sql`
        SELECT md5(coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date, d.id)::text
          FROM time.attendance_days d WHERE d.employee_id = ${entry.employeeId} AND d.date >= ${impactFrom}::date), '[]') ||
          coalesce((SELECT jsonb_agg(to_jsonb(ev) ORDER BY ev.occurred_at, ev.id)::text
          FROM time.clock_events ev WHERE ev.employee_id = ${entry.employeeId} AND ev.occurred_at >= (${impactFrom}::date - interval '1 day')), '[]') ||
          coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.date, a.id)::text
          FROM time.hours_approvals a WHERE a.employee_id = ${entry.employeeId} AND a.date >= ${impactFrom}::date), '[]') ||
          coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id)::text
          FROM time.leave_requests l WHERE l.employee_id = ${entry.employeeId} AND l.end_date >= ${impactFrom}::date), '[]') ||
          coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text
          FROM time.extra_hours_requests x WHERE x.employee_id = ${entry.employeeId} AND x.window_end >= ${impactFrom}::date), '[]')) AS fingerprint`);
      if (!dependencies) throw new Error("Dependent records could not be fingerprinted.");
      if (!impact) throw new Error("Dependent records could not be checked.");
      // Prior approvals are immutable snapshots; the review report identifies them for follow-up after rebuilding.

      changes.push({ employeeId: entry.employeeId, assignment, schedule, before: { assignment: beforeAssignment, schedule: beforeSchedule },
        after: { assignment: afterAssignment, schedule: afterSchedule }, impact });
      inventory.push({ employeeId: person.id, email: person.work_email, clientId: company.id, clientName: company.name,
        assignments, shifts, impact, dependencyFingerprint: dependencies.fingerprint });
    }
    const planDigest = digest({ mode: "historical-october-2026", sourceDigest, target: { ...target, database: identity.database },
      actorId: actor.id, mapping: parsed, inventory, changes });
    if (approvedDigest && approvedDigest !== planDigest) throw new Error("Preview changed. Review a fresh preview before applying.");
    if (approvedDigest) {
      for (const [i, change] of changes.entries()) {
        const entry = parsed.entries[i];
        const metadata = { source: "reviewed_historical_schedule_import", digest: planDigest };
        if (change.assignment === "add") {
          const [row] = await tx.insert(clientAssignments).values({ employeeId: entry.employeeId, clientId: entry.clientId,
            startDate: entry.assignmentStartDate, hoursPerWeek: entry.hoursPerWeek?.toString() ?? null, createdBy: actor.id })
            .returning({ id: clientAssignments.id });
          await tx.insert(employmentHistory).values({ employeeId: entry.employeeId, eventType: "client_assigned", effectiveDate: entry.assignmentStartDate,
            summary: "Reviewed historical client assignment", after: change.after.assignment, changedBy: actor.id });
          await tx.insert(auditLog).values({ actorUserId: actor.id, actorEmail: actor.email, action: "assignment.create", targetType: "employee",
            targetId: entry.employeeId, after: redact(change.after.assignment), metadata: redact({ ...metadata, assignmentId: row.id }) });
        } else if (change.assignment === "correct") {
          await tx.update(clientAssignments).set({ startDate: entry.assignmentStartDate,
            hoursPerWeek: entry.hoursPerWeek?.toString() ?? null, updatedAt: new Date() })
            .where(sql`${clientAssignments.id} = ${change.before.assignment!.id}`);
          await tx.insert(employmentHistory).values({ employeeId: entry.employeeId, eventType: "profile_changed", effectiveDate: entry.assignmentStartDate,
            summary: "Reviewed historical client assignment correction", before: change.before.assignment, after: change.after.assignment, changedBy: actor.id });
          await tx.insert(auditLog).values({ actorUserId: actor.id, actorEmail: actor.email, action: "assignment.update", targetType: "employee",
            targetId: entry.employeeId, before: redact(change.before.assignment), after: redact(change.after.assignment), metadata: redact(metadata) });
        }
        if (change.schedule === "add") {
          await tx.insert(schedules).values({ employeeId: entry.employeeId, ...change.after.schedule, createdBy: actor.id });
        }
        if (change.schedule !== "unchanged") await tx.insert(auditLog).values({ actorUserId: actor.id, actorEmail: actor.email,
          action: "schedule.assign", targetType: "employee", targetId: entry.employeeId,
          before: change.before.schedule ? redact(change.before.schedule) : null, after: redact(change.after.schedule), metadata: redact(metadata) });
      }
      await tx.insert(auditLog).values({ actorUserId: actor.id, actorEmail: actor.email,
        action: "schedule_import.historical_apply", targetType: "schedule_import", targetId: null,
        metadata: redact({ digest: planDigest, assignments: changes.filter((c) => c.assignment !== "unchanged").length,
          schedules: changes.filter((c) => c.schedule !== "unchanged").length }) });
    }
    return { digest: planDigest, period: parsed.period, changes,
      totals: { assignments: changes.filter((c) => c.assignment !== "unchanged").length,
        schedules: changes.filter((c) => c.schedule !== "unchanged").length,
        unchanged: changes.filter((c) => c.assignment === "unchanged" && c.schedule === "unchanged").length,
        attendanceDays: changes.reduce((n, c) => n + c.impact.attendanceDays, 0),
        clockEvents: changes.reduce((n, c) => n + c.impact.clockEvents, 0),
        approvals: changes.reduce((n, c) => n + c.impact.approvals, 0),
        leaveRequests: changes.reduce((n, c) => n + c.impact.leaveRequests, 0),
        extraHoursRequests: changes.reduce((n, c) => n + c.impact.extraHoursRequests, 0) },
      applied: Boolean(approvedDigest) };
  });
}
