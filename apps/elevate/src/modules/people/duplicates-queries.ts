import "server-only";
import { and, asc, isNull, ne } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { accountsWithoutRecord, findDuplicateGroups } from "./duplicates-service";
import { employees } from "./schema";

export type DuplicateReport = {
  groups: { key: string; signals: string[]; people: { id: string; name: string; workEmail: string; status: string; position: string | null; hasAccount: boolean; createdAt: Date }[] }[];
  accounts: { userId: string; email: string; createdAt: Date }[];
  /** Everyone in the directory, to choose which record an account belongs to. */
  records: { id: string; name: string; workEmail: string; hasAccount: boolean }[];
};

/** HR and Super Admin: people who may be in the directory twice, and sign-in accounts with no record. */
export async function getDuplicateReport(): Promise<DuplicateReport> {
  const user = await requireUser();
  await authorize(user, "people.merge");
  const groups = await findDuplicateGroups(db);
  const accounts = await accountsWithoutRecord(db);
  const records = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, workEmail: employees.workEmail, userId: employees.userId })
    .from(employees)
    .where(and(isNull(employees.archivedAt), ne(employees.status, "separated")))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  return {
    groups: groups.map((g) => ({
      key: g.key,
      signals: g.signals,
      people: [...g.people].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((p) => ({ id: p.id, name: `${p.first} ${p.last}`, workEmail: p.workEmail, status: p.status, position: p.position, hasAccount: p.hasAccount, createdAt: p.createdAt })),
    })),
    accounts,
    records: records.map((r) => ({ id: r.id, name: `${r.last}, ${r.first}`, workEmail: r.workEmail, hasAccount: r.userId !== null })),
  };
}
