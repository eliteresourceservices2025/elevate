import "server-only";
import { eq } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor, type AuthzUser } from "@/lib/authz";
import type { ActionName } from "@/lib/authz";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { timeChainUserIds } from "@/modules/org/service";

/** Throws unless the person holds the action in some scope. Called first, so a role with no access never reaches the database. */
export function requireScope(user: AuthzUser, action: ActionName): void {
  if (!scopeFor(user, action)) throw new ForbiddenError(action);
}

/**
 * Checks an action on one person's record: own, the time chain (a manager or attendance lead, for team scope) or everyone.
 * Returns the person's sign-in id so callers can tell "own" from "someone else".
 */
export async function authorizeForEmployee(user: AuthzUser, action: ActionName, employeeId: string): Promise<{ ownerUserId: string | null }> {
  requireScope(user, action);
  const [e] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!e) throw new ForbiddenError(action);
  await authorize(user, action, { ownerUserId: e.userId ?? undefined, managerChainUserIds: await timeChainUserIds(db, employeeId) });
  return { ownerUserId: e.userId };
}
