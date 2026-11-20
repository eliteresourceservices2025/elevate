import "server-only";
import { eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { birthdayPreferences, employees } from "./schema";

// Birthday visibility. Not a "use server" file: the functions take the acting user, so the action signs them in first.

async function ownEmployeeId(userId: string): Promise<string | null> {
  const [row] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
  return row?.id ?? null;
}

/** Whether the person has hidden their birthday from colleagues' dashboards (false when they never chose). Null without a people record. */
export async function getOwnBirthdayHidden(actor: AuthUser): Promise<boolean | null> {
  await authorize(actor, "people.set_birthday_visibility", { ownerUserId: actor.id });
  const employeeId = await ownEmployeeId(actor.id);
  if (!employeeId) return null;
  const [row] = await db.select({ hidden: birthdayPreferences.hidden }).from(birthdayPreferences).where(eq(birthdayPreferences.employeeId, employeeId)).limit(1);
  return row?.hidden ?? false;
}

export type BirthdayResult = { ok: true } | { ok: false; error: string };

/** Hides or shows the person's own birthday (month and day) on colleagues' dashboards. Audited with the field name only. */
export async function setOwnBirthdayHidden(actor: AuthUser, hidden: boolean): Promise<BirthdayResult> {
  await authorize(actor, "people.set_birthday_visibility", { ownerUserId: actor.id });
  const employeeId = await ownEmployeeId(actor.id);
  if (!employeeId) return { ok: false, error: "You don't have a people record yet." };
  await db.transaction(async (tx) => {
    await tx
      .insert(birthdayPreferences)
      .values({ employeeId, hidden })
      .onConflictDoUpdate({ target: birthdayPreferences.employeeId, set: { hidden, updatedAt: sql`now()` } });
    await writeAudit({ actor, action: "profile.birthday_visibility", targetType: "employee", targetId: employeeId, after: { field: "birthday_visibility", hidden } }, tx);
  });
  return { ok: true };
}
