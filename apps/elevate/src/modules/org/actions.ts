"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCheckViolation, isUniqueViolation } from "@/lib/db-errors";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { recordHistory } from "@/modules/people/service";
import { departments, positions, teams } from "./schema";
import { activeDirectReports, applyReporting, reportName } from "./service";
import {
  archiveDepartmentSchema,
  archivePositionSchema,
  archiveTeamSchema,
  createDepartmentSchema,
  createPositionSchema,
  createTeamSchema,
  reassignReportsSchema,
  setReportingSchema,
  updateDepartmentSchema,
  updatePositionSchema,
  updateTeamSchema,
} from "./validators";

const BAD = "Check the form and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;
const done = (): ActionResult => ({ ok: true, data: undefined });

function refresh() {
  revalidatePath("/people/structure");
  revalidatePath("/org-chart");
  revalidatePath("/people");
}

// --- Departments ---------------------------------------------------------------

export async function createDepartment(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = createDepartmentSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      await db.transaction(async (tx) => {
        const [d] = await tx.insert(departments).values({ name: p.data.name }).returning({ id: departments.id });
        await writeAudit({ actor, action: "org.department.create", targetType: "department", targetId: d.id, after: p.data }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A department with that name already exists.");
      throw e;
    }
    refresh();
    return done();
  });
}

export async function updateDepartment(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = updateDepartmentSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      const r = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(departments).where(eq(departments.id, p.data.departmentId)).for("update");
        if (!before || before.archivedAt) return fail("That department was not found.");
        await tx.update(departments).set({ name: p.data.name, updatedAt: new Date() }).where(eq(departments.id, before.id));
        await writeAudit({ actor, action: "org.department.update", targetType: "department", targetId: before.id, before: { name: before.name }, after: { name: p.data.name } }, tx);
        return done();
      });
      refresh();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A department with that name already exists.");
      throw e;
    }
  });
}

export async function archiveDepartment(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = archiveDepartmentSchema.safeParse(input);
    if (!p.success) return fail(BAD);
    const r = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(teams).where(and(eq(teams.departmentId, p.data.departmentId), isNull(teams.archivedAt)));
      if (n > 0) return fail(`This department still has ${n} active ${n === 1 ? "team" : "teams"}. Archive or move them first.`);
      const [d] = await tx.update(departments).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(departments.id, p.data.departmentId), isNull(departments.archivedAt))).returning({ name: departments.name });
      if (!d) return fail("That department was not found.");
      await writeAudit({ actor, action: "org.department.archive", targetType: "department", targetId: p.data.departmentId, metadata: { name: d.name } }, tx);
      return done();
    });
    refresh();
    return r;
  });
}

// --- Teams ----------------------------------------------------------------------

export async function createTeam(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = createTeamSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      const r = await db.transaction(async (tx) => {
        const [dept] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, p.data.departmentId), isNull(departments.archivedAt))).limit(1);
        if (!dept) return fail("That department was not found.");
        const [t] = await tx.insert(teams).values(p.data).returning({ id: teams.id });
        await writeAudit({ actor, action: "org.team.create", targetType: "team", targetId: t.id, after: p.data }, tx);
        return done();
      });
      refresh();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A team with that name already exists.");
      throw e;
    }
  });
}

export async function updateTeam(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = updateTeamSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      const r = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(teams).where(eq(teams.id, p.data.teamId)).for("update");
        if (!before || before.archivedAt) return fail("That team was not found.");
        const [dept] = await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, p.data.departmentId), isNull(departments.archivedAt))).limit(1);
        if (!dept) return fail("That department was not found.");
        await tx.update(teams).set({ name: p.data.name, departmentId: p.data.departmentId, updatedAt: new Date() }).where(eq(teams.id, before.id));
        await writeAudit({ actor, action: "org.team.update", targetType: "team", targetId: before.id, before: { name: before.name, departmentId: before.departmentId }, after: { name: p.data.name, departmentId: p.data.departmentId } }, tx);
        return done();
      });
      refresh();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A team with that name already exists.");
      throw e;
    }
  });
}

export async function archiveTeam(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = archiveTeamSchema.safeParse(input);
    if (!p.success) return fail(BAD);
    const r = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.teamId, p.data.teamId), isNull(employees.archivedAt)));
      if (n > 0) return fail(`${n} ${n === 1 ? "person is" : "people are"} still in this team. Move them first.`);
      const [t] = await tx.update(teams).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(teams.id, p.data.teamId), isNull(teams.archivedAt))).returning({ name: teams.name });
      if (!t) return fail("That team was not found.");
      await writeAudit({ actor, action: "org.team.archive", targetType: "team", targetId: p.data.teamId, metadata: { name: t.name } }, tx);
      return done();
    });
    refresh();
    return r;
  });
}

// --- Positions ------------------------------------------------------------------

export async function createPosition(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = createPositionSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      await db.transaction(async (tx) => {
        const [pos] = await tx.insert(positions).values({ title: p.data.title, departmentId: p.data.departmentId ?? null }).returning({ id: positions.id });
        await writeAudit({ actor, action: "org.position.create", targetType: "position", targetId: pos.id, after: p.data }, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A position with that title already exists.");
      throw e;
    }
    refresh();
    return done();
  });
}

export async function updatePosition(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = updatePositionSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    try {
      const r = await db.transaction(async (tx) => {
        const [before] = await tx.select().from(positions).where(eq(positions.id, p.data.positionId)).for("update");
        if (!before || before.archivedAt) return fail("That position was not found.");
        await tx.update(positions).set({ title: p.data.title, departmentId: p.data.departmentId ?? null, updatedAt: new Date() }).where(eq(positions.id, before.id));
        // The display title on people follows the catalog.
        await tx.update(employees).set({ position: p.data.title }).where(eq(employees.positionId, before.id));
        await writeAudit({ actor, action: "org.position.update", targetType: "position", targetId: before.id, before: { title: before.title }, after: { title: p.data.title } }, tx);
        return done();
      });
      refresh();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return fail("A position with that title already exists.");
      throw e;
    }
  });
}

export async function archivePosition(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_structure");
    const p = archivePositionSchema.safeParse(input);
    if (!p.success) return fail(BAD);
    const r = await db.transaction(async (tx) => {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(and(eq(employees.positionId, p.data.positionId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`));
      if (n > 0) return fail(`${n} ${n === 1 ? "person holds" : "people hold"} this position. Change their position first.`);
      const [pos] = await tx.update(positions).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(positions.id, p.data.positionId), isNull(positions.archivedAt))).returning({ title: positions.title });
      if (!pos) return fail("That position was not found.");
      await writeAudit({ actor, action: "org.position.archive", targetType: "position", targetId: p.data.positionId, metadata: { title: pos.title } }, tx);
      return done();
    });
    refresh();
    return r;
  });
}

// --- Reporting lines ------------------------------------------------------------

export async function setReporting(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_reporting");
    const p = setReportingSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));

    try {
      const r = await db.transaction(async (tx) => {
        const result = await applyReporting(tx, p.data, actor.id);
        if (!result.ok) return fail(result.error);
        if (result.changed.length === 0) return fail("No changes to save.");
        await writeAudit(
          {
            actor,
            action: "org.reporting.update",
            targetType: "employee",
            targetId: p.data.employeeId,
            after: { changed: result.changed, teamId: p.data.teamId, managerId: p.data.managerId, effectiveDate: p.data.effectiveDate },
          },
          tx,
        );
        return done();
      });
      if (r.ok) {
        refresh();
        revalidatePath(`/people/${p.data.employeeId}`);
      }
      return r;
    } catch (e) {
      // The database trigger caught a loop the pre-check could not see (a concurrent change).
      if (isCheckViolation(e)) return fail("That would make a loop in the reporting lines.");
      throw e;
    }
  });
}

/** Moves every active direct report of one manager to another (or to no one), in one step. */
export async function reassignReports(input: unknown): Promise<ActionResult<{ moved: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "org.manage_reporting");
    const p = reassignReportsSchema.safeParse(input);
    if (!p.success) return fail(first(p.error));
    const { fromManagerId, toManagerId, effectiveDate } = p.data;
    if (toManagerId === fromManagerId) return fail("Choose a different manager.");

    try {
      const r = await db.transaction(async (tx) => {
        const reports = await activeDirectReports(tx, fromManagerId);
        if (reports.length === 0) return fail("That person has no active direct reports.");
        for (const person of reports) {
          const result = await applyReporting(tx, { employeeId: person.id, managerId: toManagerId, effectiveDate }, actor.id);
          if (!result.ok) return fail(`${reportName(person)}: ${result.error}`);
        }
        await recordHistory(tx, { employeeId: fromManagerId, eventType: "profile_changed", summary: `${reports.length} direct ${reports.length === 1 ? "report" : "reports"} reassigned`, changedBy: actor.id, effectiveDate });
        await writeAudit({ actor, action: "org.reporting.reassign", targetType: "employee", targetId: fromManagerId, after: { toManagerId, count: reports.length, effectiveDate } }, tx);
        return { ok: true, data: { moved: reports.length } } as const;
      });
      if (r.ok) refresh();
      return r;
    } catch (e) {
      if (isCheckViolation(e)) return fail("That would make a loop in the reporting lines.");
      throw e;
    }
  });
}
