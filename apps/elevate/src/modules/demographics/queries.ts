import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import { pronounText } from "./constants";
import { readEmployeeSelfId, readPronouns, readSharedIdentity, summarize, type SelfIdentification, type SharedIdentity, type Summary } from "./service";

/** The signed-in person's own answers, or null when they have no people record. Nobody else's are ever returned. */
export async function getMySelfIdentification(): Promise<SelfIdentification | null> {
  const user = await requireUser();
  await authorize(user, "demographics.view_own", { ownerUserId: user.id });
  const [me] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.userId, user.id), isNull(employees.archivedAt))).limit(1);
  return me ? readEmployeeSelfId(me.id) : null;
}

/** The pronouns to show next to a person's name (for example "she/her"), or null. Anyone who can see the directory may see them. */
export async function getPronounsFor(employeeId: string): Promise<string | null> {
  const user = await requireUser();
  await authorize(user, "demographics.view_pronouns");
  const p = await readPronouns(employeeId);
  return pronounText(p.pronouns, p.pronounsOther);
}

/** The gender, sexual orientation and religion this person chose to share on their profile, as words (null for anything they kept private). */
export async function getSharedIdentityFor(employeeId: string): Promise<SharedIdentity> {
  const user = await requireUser();
  await authorize(user, "demographics.view_shared");
  return readSharedIdentity(employeeId);
}

/** Combined counts for HR (groups under 5 are left out on the server). Viewing it is audited, without any value. */
export async function getSelfIdentificationSummary(): Promise<Summary> {
  const user = await requireUser();
  await authorize(user, "demographics.view_summary");
  const summary = await summarize();
  await writeAudit({ actor: user, action: "demographics.view_summary" });
  return summary;
}
