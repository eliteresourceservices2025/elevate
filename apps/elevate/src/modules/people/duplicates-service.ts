import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { BASE_ROLE } from "@/lib/roles";
import { writeAudit } from "@/modules/audit/write";
import { userRoles, users } from "@/modules/core/schema";
import { applyReporting, activeDirectReports, todayInZone } from "@/modules/org/service";
import { groupPossibleDuplicates, type PersonLike } from "./duplicates";
import { employees } from "./schema";
import { recordHistory, type Tx } from "./service";

// Putting two records of the same person right. Nothing is deleted: the duplicate is archived (so it leaves the directory and the
// org chart) and its sign-in account, if it had one, moves to the record that stays. All its history stays on the archived record.

type Reader = Pick<typeof db, "select">;

export type DuplicateRow = PersonLike & { status: string; hasAccount: boolean; createdAt: Date; position: string | null; archivedAt: Date | null };

/** Everyone still in the directory, as the duplicate finder needs them. */
export async function loadPeopleForDuplicates(tx: Reader): Promise<DuplicateRow[]> {
  const rows = await tx
    .select({
      id: employees.id,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      workEmail: employees.workEmail,
      personalEmail: employees.personalEmail,
      mobile: employees.mobile,
      birthDate: employees.birthDate,
      status: employees.status,
      userId: employees.userId,
      createdAt: employees.createdAt,
      position: employees.position,
      archivedAt: employees.archivedAt,
    })
    .from(employees)
    .where(and(isNull(employees.archivedAt), ne(employees.status, "separated")));
  return rows.map((r) => ({ id: r.id, first: r.first, last: r.last, workEmail: r.workEmail, personalEmail: r.personalEmail, mobile: r.mobile, birthDate: r.birthDate, status: r.status, hasAccount: r.userId !== null, createdAt: r.createdAt, position: r.position, archivedAt: r.archivedAt }));
}

export async function findDuplicateGroups(tx: Reader) {
  return groupPossibleDuplicates(await loadPeopleForDuplicates(tx));
}

/** Sign-in accounts that have no people record: someone who signed in with an email HR did not have, or whose record was archived. */
export async function accountsWithoutRecord(tx: Reader): Promise<{ userId: string; email: string; createdAt: Date }[]> {
  const rows = await tx
    .select({ userId: users.id, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(and(isNull(users.archivedAt), sql`not exists (select 1 from core.employees e where e.user_id = ${users.id} and e.archived_at is null)`));
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

type Actor = { id: string; email: string; roles?: readonly string[] };

/**
 * Merges the duplicate into the record that stays. The sign-in account follows the person: if the duplicate had the account in use,
 * it moves to the keeper (the account the keeper had before loses the link, and its roles are copied to the account now in use, so
 * nothing is lost; Super Admin only when the actor is one). With `adoptEmail` the keeper takes the duplicate's work email (the
 * address the person now uses); the duplicate gets a placeholder so the address is free. Direct reports move to the keeper.
 */
export async function mergeEmployees(tx: Tx, actor: Actor, p: { keepId: string; duplicateId: string; adoptEmail: boolean }): Promise<{ accountMoved: boolean; rolesCopied: number; reportsMoved: number; emailAdopted: boolean }> {
  if (p.keepId === p.duplicateId) throw new ActionFailure("Choose two different records.");
  // Lock both in a fixed order so two people merging the same pair cannot deadlock
  const [a, b] = p.keepId < p.duplicateId ? [p.keepId, p.duplicateId] : [p.duplicateId, p.keepId];
  const locked = new Map<string, typeof employees.$inferSelect>();
  for (const id of [a, b]) {
    const [row] = await tx.select().from(employees).where(eq(employees.id, id)).for("update");
    if (row) locked.set(id, row);
  }
  const keep = locked.get(p.keepId);
  const dup = locked.get(p.duplicateId);
  if (!keep || !dup) throw new ActionFailure("One of those records was not found.");
  if (keep.archivedAt || dup.archivedAt) throw new ActionFailure("Both records must be current (not archived).");
  if (keep.status === "separated" && dup.status !== "separated") throw new ActionFailure("The record that stays has left the company. Keep the other one, or restore this one first.");
  if (actor.id === dup.userId) throw new ActionFailure("You cannot merge away the record your own account uses. Ask another HR admin.");

  // The account in use follows the person
  let accountMoved = false;
  let rolesCopied = 0;
  if (dup.userId) {
    const inUse = dup.userId;
    const oldKeepUser = keep.userId;
    await tx.update(employees).set({ userId: null, updatedAt: new Date() }).where(eq(employees.id, dup.id)); // the unique index allows one record per account
    await tx.update(employees).set({ userId: inUse, updatedAt: new Date() }).where(eq(employees.id, keep.id));
    accountMoved = true;
    if (oldKeepUser && oldKeepUser !== inUse) {
      const held = await tx.select({ roleSlug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, oldKeepUser));
      const have = new Set((await tx.select({ roleSlug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, inUse))).map((r) => r.roleSlug));
      const actorIsSuper = actor.roles?.includes("super_admin") ?? false;
      for (const r of held) {
        if (r.roleSlug === BASE_ROLE || have.has(r.roleSlug)) continue;
        if (r.roleSlug === "super_admin" && !actorIsSuper) continue; // only a Super Admin hands on that role
        await tx.insert(userRoles).values({ userId: inUse, roleSlug: r.roleSlug, grantedBy: actor.id }).onConflictDoNothing();
        rolesCopied += 1;
      }
    }
  }

  // The person's work email: the keeper takes the one they use now
  let emailAdopted = false;
  if (p.adoptEmail && dup.workEmail.toLowerCase() !== keep.workEmail.toLowerCase()) {
    await tx.update(employees).set({ workEmail: `merged-${dup.id}@merged.invalid`, updatedAt: new Date() }).where(eq(employees.id, dup.id));
    await tx.update(employees).set({ workEmail: dup.workEmail, updatedAt: new Date() }).where(eq(employees.id, keep.id));
    emailAdopted = true;
    await recordHistory(tx, { employeeId: keep.id, eventType: "profile_changed", summary: "Work email taken from the merged duplicate record", before: { workEmail: keep.workEmail }, after: { workEmail: dup.workEmail }, changedBy: actor.id });
  }

  // Their direct reports now report to the keeper (through the dated rules)
  const reports = await activeDirectReports(tx, dup.id);
  const today = todayInZone();
  for (const r of reports) {
    const moved = await applyReporting(tx, { employeeId: r.id, managerId: keep.id, effectiveDate: today }, actor.id);
    if (!moved.ok) throw new ActionFailure(moved.error);
  }

  await tx.update(employees).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(employees.id, dup.id));
  await recordHistory(tx, { employeeId: dup.id, eventType: "archived", summary: "Merged into another record of the same person and archived", changedBy: actor.id });
  await recordHistory(tx, { employeeId: keep.id, eventType: "merged", summary: `A duplicate record was merged in${accountMoved ? "; the sign-in account now belongs to this record" : ""}`, changedBy: actor.id });
  await writeAudit(
    { actor, action: "people.merge", targetType: "employee", targetId: keep.id, after: { mergedFrom: dup.id, accountMoved, emailAdopted, reportsMoved: reports.length, rolesCopied } },
    tx,
  );
  return { accountMoved, rolesCopied, reportsMoved: reports.length, emailAdopted };
}

/**
 * Links a sign-in account that has no people record to a person's record (someone signed in with a different email than the one HR had).
 * If the record already has another account, that account is detached (it stays, without a record), with `replaceExisting`.
 */
export async function relinkAccount(tx: Tx, actor: Actor, p: { userId: string; employeeId: string; replaceExisting: boolean }): Promise<{ replaced: boolean }> {
  const [user] = await tx.select({ id: users.id, archivedAt: users.archivedAt }).from(users).where(eq(users.id, p.userId));
  if (!user || user.archivedAt) throw new ActionFailure("That account was not found or is deactivated.");
  const [taken] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.userId, p.userId), isNull(employees.archivedAt))).limit(1);
  if (taken) throw new ActionFailure("That account already belongs to a people record.");
  const [emp] = await tx.select().from(employees).where(eq(employees.id, p.employeeId)).for("update");
  if (!emp || emp.archivedAt) throw new ActionFailure("That people record was not found or is archived.");
  if (emp.userId && !p.replaceExisting) throw new ActionFailure("That record already has a sign-in account. Confirm to replace it.");
  if (emp.userId === actor.id) throw new ActionFailure("You cannot replace the account you are using. Ask another HR admin.");
  const replaced = emp.userId !== null;
  // An archived record may still hold the account; free it first
  await tx.update(employees).set({ userId: null, updatedAt: new Date() }).where(and(eq(employees.userId, p.userId)));
  await tx.update(employees).set({ userId: p.userId, updatedAt: new Date() }).where(eq(employees.id, emp.id));
  await recordHistory(tx, { employeeId: emp.id, eventType: "account_linked", summary: replaced ? "Sign-in account replaced by HR" : "Sign-in account linked by HR", changedBy: actor.id });
  await writeAudit({ actor, action: "people.relink_account", targetType: "employee", targetId: emp.id, after: { userId: p.userId, replaced } }, tx);
  return { replaced };
}
