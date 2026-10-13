import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { employees } from "@/modules/people/schema";
import { recordHistory, type Tx } from "@/modules/people/service";
import { attendanceLeads, reportingLines, teamMemberships, teams } from "./schema";

// Shared organization rules. Callers authorize first (CLAUDE.md rule 4).

type Db = Pick<typeof db, "execute">;

export const todayInZone = () => formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

/**
 * Sign-in account ids of everyone above this person in the reporting chain, nearest first.
 * This is what "team" scope means: a manager has team access to everyone below them.
 */
export async function managerChainUserIds(executor: Db, employeeId: string): Promise<string[]> {
  const rows = (await executor.execute(sql`
    with recursive up(id, manager_id, user_id, depth) as (
      select m.id, m.manager_id, m.user_id, 1
      from core.employees e join core.employees m on m.id = e.manager_id
      where e.id = ${employeeId}
      union all
      select m.id, m.manager_id, m.user_id, up.depth + 1
      from up join core.employees m on m.id = up.manager_id
      where up.depth < 200
    )
    select user_id from up where user_id is not null order by depth`)) as unknown as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

/** The sign-in account of this person's attendance lead, or null when they have none (or the lead has no account). */
export async function attendanceLeadUserId(executor: Db, employeeId: string): Promise<string | null> {
  const rows = (await executor.execute(sql`
    select l.user_id from core.attendance_leads a join core.employees l on l.id = a.lead_employee_id
    where a.employee_id = ${employeeId} and l.user_id is not null and l.archived_at is null and l.status <> 'separated'`)) as unknown as { user_id: string }[];
  return rows[0]?.user_id ?? null;
}

/**
 * For time matters (hours, corrections, extra hours, time off): the people who count as "above" this person. The attendance lead comes
 * first (attendance matters go to them), then the manager chain. A lead only holds the reach their ROLE gives them, so an attendance
 * lead who is not a Team Lead gains nothing. Use managerChainUserIds for everything that is not about time.
 */
export async function timeChainUserIds(executor: Db, employeeId: string): Promise<string[]> {
  const [lead, chain] = await Promise.all([attendanceLeadUserId(executor, employeeId), managerChainUserIds(executor, employeeId)]);
  return lead ? [lead, ...chain.filter((id) => id !== lead)] : chain;
}

/** The people to tell first about a time matter: the attendance lead and the direct manager (or just the manager). */
export async function timeNoticeUserIds(executor: Db, employeeId: string): Promise<string[]> {
  const [lead, chain] = await Promise.all([attendanceLeadUserId(executor, employeeId), managerChainUserIds(executor, employeeId)]);
  return [...new Set([...(lead ? [lead] : []), ...chain.slice(0, 1)])];
}

/** Friendly pre-check; the database trigger is the real guarantee. */
export async function wouldCreateCycle(executor: Db, employeeId: string, managerId: string): Promise<boolean> {
  if (employeeId === managerId) return true;
  const rows = (await executor.execute(sql`
    with recursive up(id, manager_id, depth) as (
      select id, manager_id, 1 from core.employees where id = ${managerId}
      union all
      select e.id, e.manager_id, up.depth + 1 from core.employees e join up on e.id = up.manager_id where up.depth < 200
    )
    select 1 as hit from up where id = ${employeeId} limit 1`)) as unknown as unknown[];
  return rows.length > 0;
}

/** People who currently report directly to this person and are still with ERS. */
export async function activeDirectReports(tx: Tx, managerId: string) {
  return tx
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(employees)
    .where(and(eq(employees.managerId, managerId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
    .orderBy(employees.legalLastName);
}

export const reportName = (r: { first: string; last: string; preferred: string | null }) =>
  `${r.preferred?.trim() || r.first} ${r.last}`;

const nameOf = async (tx: Tx, id: string | null) => {
  if (!id) return "no one";
  const [p] = await tx
    .select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1);
  return p ? reportName(p) : "unknown";
};

export type ReportingChange = { employeeId: string; teamId?: string | null; managerId?: string | null; effectiveDate: string };
export type ReportingResult = { ok: true; changed: ("manager" | "team")[] } | { ok: false; error: string };

/**
 * Change a person's team and/or manager with an effective date.
 * Rules: not in the future; not before the current assignment began; the manager must be active,
 * not the person themselves and not below them in the chain; the team must exist and be active.
 * Closes the open dated row, opens a new one, updates the current columns and writes history.
 */
export async function applyReporting(tx: Tx, change: ReportingChange, actorId: string): Promise<ReportingResult> {
  if (change.effectiveDate > todayInZone()) return { ok: false, error: "Changes cannot be dated in the future yet." };

  const [emp] = await tx.select().from(employees).where(eq(employees.id, change.employeeId)).for("update");
  if (!emp || emp.archivedAt) return { ok: false, error: "That person was not found." };

  const changed: ("manager" | "team")[] = [];

  // --- manager
  if (change.managerId !== undefined && change.managerId !== emp.managerId) {
    if (change.managerId) {
      const [mgr] = await tx
        .select({ archivedAt: employees.archivedAt, status: employees.status })
        .from(employees)
        .where(eq(employees.id, change.managerId))
        .limit(1);
      if (!mgr) return { ok: false, error: "That manager was not found." };
      if (mgr.archivedAt || mgr.status === "separated") return { ok: false, error: "That manager is no longer with ERS." };
      if (await wouldCreateCycle(tx, emp.id, change.managerId)) {
        return { ok: false, error: "That would make a loop: the manager already reports to this person." };
      }
    }
    const [open] = await tx
      .select()
      .from(reportingLines)
      .where(and(eq(reportingLines.employeeId, emp.id), isNull(reportingLines.effectiveTo)))
      .limit(1);
    if (open && change.effectiveDate < open.effectiveFrom) {
      return { ok: false, error: `The current manager assignment started on ${open.effectiveFrom}. Pick that date or later.` };
    }
    if (open) await tx.update(reportingLines).set({ effectiveTo: change.effectiveDate }).where(eq(reportingLines.id, open.id));
    await tx
      .insert(reportingLines)
      .values({ employeeId: emp.id, managerId: change.managerId, effectiveFrom: change.effectiveDate, createdBy: actorId });
    await tx.update(employees).set({ managerId: change.managerId, updatedAt: new Date() }).where(eq(employees.id, emp.id));
    await recordHistory(tx, {
      employeeId: emp.id,
      eventType: "manager_changed",
      summary: `Reports to ${await nameOf(tx, emp.managerId)} → ${await nameOf(tx, change.managerId)}`,
      before: { managerId: emp.managerId },
      after: { managerId: change.managerId },
      changedBy: actorId,
      effectiveDate: change.effectiveDate,
    });
    changed.push("manager");
  }

  // --- team
  if (change.teamId !== undefined && change.teamId !== emp.teamId) {
    let teamName = "no team";
    if (change.teamId) {
      const [t] = await tx.select({ name: teams.name, archivedAt: teams.archivedAt }).from(teams).where(eq(teams.id, change.teamId)).limit(1);
      if (!t || t.archivedAt) return { ok: false, error: "That team was not found." };
      teamName = t.name;
    }
    const [open] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.employeeId, emp.id), isNull(teamMemberships.effectiveTo)))
      .limit(1);
    if (open && change.effectiveDate < open.effectiveFrom) {
      return { ok: false, error: `The current team assignment started on ${open.effectiveFrom}. Pick that date or later.` };
    }
    const [oldTeam] = emp.teamId ? await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, emp.teamId)).limit(1) : [];
    if (open) await tx.update(teamMemberships).set({ effectiveTo: change.effectiveDate }).where(eq(teamMemberships.id, open.id));
    await tx
      .insert(teamMemberships)
      .values({ employeeId: emp.id, teamId: change.teamId, effectiveFrom: change.effectiveDate, createdBy: actorId });
    await tx.update(employees).set({ teamId: change.teamId, updatedAt: new Date() }).where(eq(employees.id, emp.id));
    await recordHistory(tx, {
      employeeId: emp.id,
      eventType: "team_changed",
      summary: `Team: ${oldTeam?.name ?? "no team"} → ${teamName}`,
      before: { teamId: emp.teamId },
      after: { teamId: change.teamId },
      changedBy: actorId,
      effectiveDate: change.effectiveDate,
    });
    changed.push("team");
  }

  return { ok: true, changed };
}

/** Everyone below this sign-in account in the reporting chain (direct and indirect), as employee ids. Used to filter "team" scope lists. */
/** For time matters: everyone below this person in the chain, plus the people who report their time to them as attendance lead. */
export async function timeDownlineEmployeeIds(executor: Db, userId: string): Promise<string[]> {
  // One after the other: starting both at once leaves the first promise unobserved if the second call throws before it returns.
  const below = await downlineEmployeeIds(executor, userId);
  const direct = (await executor.execute(sql`
    select a.employee_id as id from core.attendance_leads a join core.employees l on l.id = a.lead_employee_id
    where l.user_id = ${userId}`)) as unknown as { id: string }[];
  return [...new Set([...below, ...direct.map((r) => r.id)])];
}

export async function downlineEmployeeIds(executor: Db, userId: string): Promise<string[]> {
  const rows = (await executor.execute(sql`
    with recursive down(id, depth) as (
      select e.id, 1 from core.employees e
      join core.employees m on m.id = e.manager_id
      where m.user_id = ${userId}
      union all
      select e.id, down.depth + 1 from down
      join core.employees e on e.manager_id = down.id
      where down.depth < 200
    )
    select distinct id from down`)) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export type AttendanceLeadResult = { ok: true; changed: boolean } | { ok: false; error: string };

/**
 * Sets (or clears, with null) a person's attendance lead. The lead must be someone still with ERS, not the person, and not below the
 * person in the chain (that would have people approving their own boss's time). Written to the person's history. Callers authorize.
 */
export async function applyAttendanceLead(tx: Tx, input: { employeeId: string; leadEmployeeId: string | null }, actorId: string): Promise<AttendanceLeadResult> {
  const [emp] = await tx.select({ id: employees.id, archivedAt: employees.archivedAt }).from(employees).where(eq(employees.id, input.employeeId)).for("update");
  if (!emp || emp.archivedAt) return { ok: false, error: "That person was not found." };

  const [current] = await tx.select().from(attendanceLeads).where(eq(attendanceLeads.employeeId, emp.id)).limit(1);
  if ((current?.leadEmployeeId ?? null) === input.leadEmployeeId) return { ok: true, changed: false };

  if (input.leadEmployeeId) {
    if (input.leadEmployeeId === emp.id) return { ok: false, error: "A person cannot be their own attendance lead." };
    const [lead] = await tx.select({ archivedAt: employees.archivedAt, status: employees.status }).from(employees).where(eq(employees.id, input.leadEmployeeId)).limit(1);
    if (!lead) return { ok: false, error: "That lead was not found." };
    if (lead.archivedAt || lead.status === "separated") return { ok: false, error: "That lead is no longer with ERS." };
    // The lead must not already report (directly or indirectly) to this person.
    if (await wouldCreateCycle(tx, emp.id, input.leadEmployeeId)) return { ok: false, error: "That person reports to them, so they cannot be their attendance lead." };
  }

  if (input.leadEmployeeId) {
    await tx
      .insert(attendanceLeads)
      .values({ employeeId: emp.id, leadEmployeeId: input.leadEmployeeId, setBy: actorId })
      .onConflictDoUpdate({ target: attendanceLeads.employeeId, set: { leadEmployeeId: input.leadEmployeeId, setBy: actorId, setAt: new Date() } });
  } else {
    await tx.delete(attendanceLeads).where(eq(attendanceLeads.employeeId, emp.id));
  }
  await recordHistory(tx, {
    employeeId: emp.id,
    eventType: "profile_changed",
    summary: `Attendance lead: ${await nameOf(tx, current?.leadEmployeeId ?? null)} → ${await nameOf(tx, input.leadEmployeeId)}`,
    before: { attendanceLeadId: current?.leadEmployeeId ?? null },
    after: { attendanceLeadId: input.leadEmployeeId },
    changedBy: actorId,
  });
  return { ok: true, changed: true };
}
