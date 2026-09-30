import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { can, type AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { clientAssignments, clients } from "@/modules/people/schema";

// Server-only helpers. They are NOT server actions (they live outside the "use server" files), so the
// browser cannot call them and they may take the acting user as an argument.

/**
 * Clients a document may be tied to. HR picks from all active clients; a person only from the
 * clients they are (or were) assigned to, so client names are not exposed to everyone.
 */
export async function clientChoices(actor: AuthzUser, employeeId: string) {
  if (can(actor, "people.manage_assignments")) {
    return db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.isActive, true), isNull(clients.archivedAt))).orderBy(clients.name);
  }
  return db
    .selectDistinct({ id: clients.id, name: clients.name })
    .from(clientAssignments)
    .innerJoin(clients, eq(clients.id, clientAssignments.clientId))
    .where(eq(clientAssignments.employeeId, employeeId))
    .orderBy(clients.name);
}
