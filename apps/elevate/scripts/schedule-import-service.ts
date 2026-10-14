import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { redact } from "../src/lib/redact";
import { auditLog } from "../src/modules/audit/schema";
import { clientAssignments, employmentHistory } from "../src/modules/people/schema";
import { schedules } from "../src/modules/attendance/schema";
import { digest, mappingSchema, type Mapping } from "./schedule-import-core";

type Database = ReturnType<typeof drizzle>;
export type ApprovedTarget = { host: string; name: string; projectRef: string };
type Operation = { employeeId: string; clientId: string; assignment: boolean; schedule: boolean };
export type ImportResult = { digest: string; assignments: number; schedules: number; unchanged: number };

// The importer intentionally supports additions only. Historical or conflicting rows require HR's normal correction workflow.
export async function reconcile(client: ReturnType<typeof postgres>, mapping: Mapping, actorEmail: string, earliestAllowed: string, target: ApprovedTarget, sourceDigest: string, approvedDigest?: string): Promise<ImportResult> {
  const parsed = mappingSchema.parse(mapping);
  const database: Database = drizzle(client);
  return database.transaction(async (tx) => {
    if (!approvedDigest) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const [identity] = await tx.execute<{ database: string }>(sql`SELECT current_database() AS database`);
    if (identity?.database !== target.name) throw new Error("Database identity changed.");
    const [actor] = await tx.execute<{ id: string; email: string }>(sql`
      SELECT u.id, u.email FROM core.users u JOIN core.user_roles r ON r.user_id = u.id
      WHERE lower(u.email) = lower(${actorEmail}) AND u.archived_at IS NULL
      AND r.role_slug IN ('hr_admin', 'super_admin') LIMIT 1`);
    if (!actor) throw new Error("An active HR Admin or Super Admin actor is required.");
    const audit = (action: string, targetType: string, targetId: string | null, after?: unknown, metadata?: Record<string, unknown>) =>
      tx.insert(auditLog).values({ actorUserId: actor.id, actorEmail: actor.email, action, targetType, targetId,
        after: after === undefined ? null : redact(after), metadata: metadata === undefined ? null : redact(metadata) });

    const operations: Operation[] = [];
    const identities: { employeeId: string; employeeWorkEmail: string; clientId: string; clientName: string }[] = [];
    for (const entry of parsed.entries) {
      const [person] = await tx.execute<{ id: string; work_email: string }>(sql`
        SELECT id, work_email FROM core.employees WHERE id = ${entry.employeeId} AND archived_at IS NULL AND status <> 'separated'
        ${approvedDigest ? sql`FOR UPDATE` : sql``}`);
      if (!person || person.work_email.toLowerCase() !== entry.employeeWorkEmail.toLowerCase())
        throw new Error("An employee mapping is no longer valid.");
      const [company] = await tx.execute<{ id: string; name: string }>(sql`
        SELECT id, name FROM core.clients WHERE id = ${entry.clientId} AND archived_at IS NULL AND is_active = true
        ${approvedDigest ? sql`FOR SHARE` : sql``}`);
      if (!company || company.name !== entry.clientName) throw new Error("A client mapping is no longer valid.");
      identities.push({ employeeId: person.id, employeeWorkEmail: person.work_email, clientId: company.id, clientName: company.name });
      const assignments = await tx.execute<{ client_id: string; start_date: string; end_date: string | null; hours_per_week: string | null }>(sql`
        SELECT client_id, start_date::text AS start_date, end_date::text AS end_date, hours_per_week FROM core.client_assignments
        WHERE employee_id = ${entry.employeeId} ORDER BY start_date`);
      // Multiple clients are valid in the app, but an attendance sheet cannot resolve an existing other-client assignment.
      if (assignments.some((a) => a.client_id !== entry.clientId && (a.end_date === null || a.end_date >= entry.assignmentStartDate)))
        throw new Error("Other client assignments need manual review.");
      const mappedAssignments = assignments.filter((a) => a.client_id === entry.clientId);
      const exactAssignment = mappedAssignments.length === 1 && mappedAssignments.some((a) => a.start_date === entry.assignmentStartDate && a.end_date === null
        && (a.hours_per_week === null ? null : Number(a.hours_per_week)) === entry.hoursPerWeek);
      if (mappedAssignments.length && !exactAssignment) throw new Error("An assignment needs manual review.");
      const existing = await tx.execute<{ effective_from: string; effective_to: string | null; start_time: string; end_time: string; weekdays: number[]; break_minutes: number; zone: string }>(sql`
        SELECT effective_from::text AS effective_from, effective_to::text AS effective_to, start_time, end_time, weekdays, break_minutes, zone
        FROM time.schedules WHERE employee_id = ${entry.employeeId} ORDER BY effective_from`);
      const shift = entry.shift;
      const exactSchedule = existing.length === 1 && existing.some((s) => s.effective_from === shift.effectiveFrom && s.effective_to === null
        && s.start_time === shift.startTime && s.end_time === shift.endTime && s.zone === shift.zone
        && s.break_minutes === shift.breakMinutes && JSON.stringify(s.weekdays) === JSON.stringify(shift.weekdays));
      if (existing.length && !exactSchedule) throw new Error("A schedule needs manual review.");
      const addAssignment = !exactAssignment, addSchedule = !exactSchedule;
      if ((addAssignment && entry.assignmentStartDate < earliestAllowed) || (addSchedule && shift.effectiveFrom < earliestAllowed))
        throw new Error("Historical changes need manual review.");
      if (addAssignment || addSchedule) {
        const firstChange = addAssignment && addSchedule
          ? (entry.assignmentStartDate < shift.effectiveFrom ? entry.assignmentStartDate : shift.effectiveFrom)
          : addAssignment ? entry.assignmentStartDate : shift.effectiveFrom;
        const [recorded] = await tx.execute(sql`SELECT 1 FROM time.attendance_days
          WHERE employee_id = ${entry.employeeId} AND date >= ${firstChange}::date LIMIT 1`);
        const [clocked] = await tx.execute(sql`SELECT 1 FROM time.clock_events
          WHERE employee_id = ${entry.employeeId} AND occurred_at >= (${firstChange}::date - interval '1 day') LIMIT 1`);
        if (recorded || clocked) throw new Error("Existing attendance needs manual assignment or schedule review.");
      }
      operations.push({ employeeId: entry.employeeId, clientId: entry.clientId, assignment: addAssignment, schedule: addSchedule });
    }

    const planDigest = digest({ sourceDigest, target: { host: target.host, database: identity.database, projectRef: target.projectRef },
      actorId: actor.id, earliestAllowed, mapping: parsed.entries, identities, operations });
    if (approvedDigest && approvedDigest !== planDigest) throw new Error("Preview changed. Review a fresh preview before applying.");
    if (approvedDigest && operations.some((op) => op.assignment || op.schedule)) {
      for (const [index, entry] of parsed.entries.entries()) {
        const op = operations[index];
        if (op.assignment) {
          const [assignment] = await tx.insert(clientAssignments).values({
            employeeId: entry.employeeId, clientId: entry.clientId, startDate: entry.assignmentStartDate,
            hoursPerWeek: entry.hoursPerWeek?.toString() ?? null, createdBy: actor.id,
          }).returning({ id: clientAssignments.id });
          const details = { clientId: entry.clientId, startDate: entry.assignmentStartDate, hoursPerWeek: entry.hoursPerWeek };
          await tx.insert(employmentHistory).values({ employeeId: entry.employeeId, eventType: "client_assigned",
            effectiveDate: entry.assignmentStartDate, summary: "Client assigned from reviewed schedule import",
            after: details, changedBy: actor.id });
          await audit("assignment.create", "employee", entry.employeeId, details,
            { assignmentId: assignment.id, source: "schedule_import" });
        }
        if (op.schedule) {
          const shift = entry.shift;
          await tx.insert(schedules).values({ employeeId: entry.employeeId, effectiveFrom: shift.effectiveFrom,
            startTime: shift.startTime, endTime: shift.endTime, weekdays: shift.weekdays,
            breakMinutes: shift.breakMinutes, zone: shift.zone, createdBy: actor.id });
          await audit("schedule.assign", "employee", entry.employeeId,
            { effectiveFrom: shift.effectiveFrom, startTime: shift.startTime, endTime: shift.endTime,
              weekdays: shift.weekdays, breakMinutes: shift.breakMinutes, zone: shift.zone },
            { source: "schedule_import" });
        }
      }
      await audit("schedule_import.apply", "schedule_import", null, undefined,
        { assignments: operations.filter((o) => o.assignment).length,
          schedules: operations.filter((o) => o.schedule).length, digest: planDigest });
    }
    return { digest: planDigest, assignments: operations.filter((o) => o.assignment).length,
      schedules: operations.filter((o) => o.schedule).length, unchanged: operations.filter((o) => !o.assignment && !o.schedule).length };
  });
}
