import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { departments, positions, teams } from "./schema";
import { reportName } from "./service";

// --- Structure (HR) --------------------------------------------------------------

export async function listStructure() {
  const user = await requireUser();
  await authorize(user, "org.manage_structure");

  const [depts, teamRows, positionRows] = await Promise.all([
    db.select().from(departments).where(isNull(departments.archivedAt)).orderBy(departments.name),
    db
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
        members: sql<number>`(select count(*)::int from core.employees e where e.team_id = ${teams.id} and e.archived_at is null)`,
      })
      .from(teams)
      .where(isNull(teams.archivedAt))
      .orderBy(teams.name),
    db
      .select({
        id: positions.id,
        title: positions.title,
        departmentId: positions.departmentId,
        holders: sql<number>`(select count(*)::int from core.employees e where e.position_id = ${positions.id} and e.archived_at is null and e.status <> 'separated')`,
      })
      .from(positions)
      .where(isNull(positions.archivedAt))
      .orderBy(positions.title),
  ]);
  return { departments: depts, teams: teamRows, positions: positionRows };
}

/** Teams, positions and possible managers for the HR forms. */
export async function listOrgOptions() {
  const user = await requireUser();
  await authorize(user, "org.manage_reporting");

  const [teamRows, positionRows, people] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(teams.name),
    db.select({ id: positions.id, title: positions.title }).from(positions).where(isNull(positions.archivedAt)).orderBy(positions.title),
    db
      .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, number: employees.employeeNumber })
      .from(employees)
      .where(and(isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
      .orderBy(employees.legalLastName, employees.legalFirstName),
  ]);
  return {
    teams: teamRows,
    positions: positionRows,
    managers: people.map((p) => ({ id: p.id, label: `${reportName(p)} (${p.number})` })),
  };
}

// --- Org chart (everyone) ---------------------------------------------------------

export type ChartNode = {
  id: string;
  managerId: string | null;
  name: string;
  position: string | null;
  team: string | null;
  status: string;
  /** Whether the viewer may open this person's profile. Everyone else sees directory details only. */
  canOpen: boolean;
};

/**
 * Everyone still with ERS and their manager. Only directory-level fields are returned; the
 * `canOpen` flag is computed here, per person, so the page never has to guess permissions.
 */
export async function getOrgChart(): Promise<ChartNode[]> {
  const user = await requireUser();
  await authorize(user, "org.view_chart");

  const rows = await db
    .select({
      id: employees.id,
      managerId: employees.managerId,
      userId: employees.userId,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
      position: employees.position,
      status: employees.status,
      team: teams.name,
    })
    .from(employees)
    .leftJoin(teams, eq(teams.id, employees.teamId))
    .where(and(isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
    .orderBy(employees.legalLastName, employees.legalFirstName);

  const byId = new Map(rows.map((r) => [r.id, r]));

  // The accounts above each person, found by walking up the in-memory tree (no extra queries).
  const chainUsers = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = byId.get(id)?.managerId ?? null;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const m = byId.get(cur);
      if (!m) break;
      if (m.userId) out.push(m.userId);
      cur = m.managerId;
    }
    return out;
  };

  return rows.map((r) => ({
    id: r.id,
    // A manager who is no longer listed (separated) leaves their reports as top-level people.
    managerId: r.managerId && byId.has(r.managerId) ? r.managerId : null,
    name: reportName(r),
    position: r.position,
    team: r.team,
    status: r.status,
    canOpen: can(user, "people.view_profile", { ownerUserId: r.userId ?? undefined, managerChainUserIds: chainUsers(r.id) }),
  }));
}

/** Team names for the directory filter. Everyone may see team names (they are on the org chart too). */
export async function listTeamFilterOptions() {
  const user = await requireUser();
  await authorize(user, "org.view_chart");
  return db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(teams.name);
}
