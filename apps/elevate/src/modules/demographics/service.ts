import "server-only";
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { candidates } from "@/modules/recruiting/schema";
import { employees } from "@/modules/people/schema";
import { MIN_GROUP } from "./constants";
import { candidateSelfIdentification, employeeDemographics } from "./schema";
import { summarizeAnswers, type Group, type SummaryBlock } from "./summary";

export type { Group, SummaryBlock };

// Plain functions, no authorization: the callers (actions.ts, queries.ts, the apply flow) authorize first.
// Nothing here logs a value.

type Writer = Pick<typeof db, "insert" | "delete">;

const empCtx = (field: string, employeeId: string) => `employee_demographics:${field}:${employeeId}`;
const candCtx = (field: string, candidateId: string) => `candidate_self_id:${field}:${candidateId}`;
const enc = (value: string | undefined, context: string) => (value ? fieldCrypto().encrypt(value, context) : null);
const dec = (value: string | null, context: string) => (value ? fieldCrypto().decrypt(value, context) : null);

/** What the person's form held, already validated (a self-description always has its words). */
export type SelfIdAnswers = { gender?: string; genderOther?: string; pronouns?: string; pronounsOther?: string; religion?: string; religionOther?: string };

export type SelfIdentification = {
  gender: string | null;
  genderOther: string | null;
  pronouns: string | null;
  pronounsOther: string | null;
  religion: string | null;
  religionOther: string | null;
};
export const EMPTY_SELF_ID: SelfIdentification = { gender: null, genderOther: null, pronouns: null, pronounsOther: null, religion: null, religionOther: null };

/** Saves the person's answers (replacing the old ones). With no answer at all, nothing is kept. Returns the field names answered. */
export async function saveEmployeeSelfId(tx: Writer, employeeId: string, v: SelfIdAnswers): Promise<string[]> {
  const fields = Object.entries({ gender: v.gender, pronouns: v.pronouns, religion: v.religion })
    .filter(([, x]) => x)
    .map(([k]) => k);
  if (fields.length === 0) {
    await tx.delete(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId));
    return [];
  }
  const row = {
    gender: v.gender ?? null,
    genderOtherEnc: v.gender === "self_described" ? enc(v.genderOther, empCtx("gender_other", employeeId)) : null,
    pronouns: v.pronouns ?? null,
    pronounsOther: v.pronouns === "self_described" ? (v.pronounsOther ?? null) : null,
    religionEnc: enc(v.religion, empCtx("religion", employeeId)),
    religionOtherEnc: v.religion === "self_described" ? enc(v.religionOther, empCtx("religion_other", employeeId)) : null,
    updatedAt: new Date(),
  };
  await tx.insert(employeeDemographics).values({ employeeId, ...row }).onConflictDoUpdate({ target: employeeDemographics.employeeId, set: row });
  return fields;
}

export async function readEmployeeSelfId(employeeId: string): Promise<SelfIdentification> {
  const [r] = await db.select().from(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId)).limit(1);
  if (!r) return EMPTY_SELF_ID;
  return {
    gender: r.gender,
    genderOther: dec(r.genderOtherEnc, empCtx("gender_other", employeeId)),
    pronouns: r.pronouns,
    pronounsOther: r.pronounsOther,
    religion: dec(r.religionEnc, empCtx("religion", employeeId)),
    religionOther: dec(r.religionOtherEnc, empCtx("religion_other", employeeId)),
  };
}

export async function readPronouns(employeeId: string): Promise<{ pronouns: string | null; pronounsOther: string | null }> {
  const [r] = await db
    .select({ pronouns: employeeDemographics.pronouns, pronounsOther: employeeDemographics.pronounsOther })
    .from(employeeDemographics)
    .where(eq(employeeDemographics.employeeId, employeeId))
    .limit(1);
  return r ?? { pronouns: null, pronounsOther: null };
}

export async function clearEmployeeSelfId(tx: Writer, employeeId: string) {
  await tx.delete(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId));
}

/** The optional part of the public application (gender and religion only). Called inside the application's transaction. A later application replaces the answers. */
export async function saveApplicantSelfId(tx: Writer, candidateId: string, v: SelfIdAnswers): Promise<void> {
  if (!v.gender && !v.religion) return;
  const row = {
    gender: v.gender ?? null,
    genderOtherEnc: v.gender === "self_described" ? enc(v.genderOther, candCtx("gender_other", candidateId)) : null,
    religionEnc: enc(v.religion, candCtx("religion", candidateId)),
    religionOtherEnc: v.religion === "self_described" ? enc(v.religionOther, candCtx("religion_other", candidateId)) : null,
  };
  await tx.insert(candidateSelfIdentification).values({ candidateId, ...row }).onConflictDoUpdate({ target: candidateSelfIdentification.candidateId, set: row });
}

export async function deleteApplicantSelfId(tx: Writer, candidateId: string) {
  await tx.delete(candidateSelfIdentification).where(eq(candidateSelfIdentification.candidateId, candidateId));
}

// --- Combined counts (HR) -----------------------------------------------------------------

export type Summary = { employees: SummaryBlock; applicants: SummaryBlock; minGroup: number };

export async function summarize(): Promise<Summary> {
  const emp = await db
    .select({ id: employeeDemographics.employeeId, gender: employeeDemographics.gender, religionEnc: employeeDemographics.religionEnc })
    .from(employeeDemographics)
    .innerJoin(employees, eq(employees.id, employeeDemographics.employeeId))
    .where(sql`${employees.archivedAt} is null and ${employees.anonymizedAt} is null and ${employees.status} <> 'separated'`);
  const app = await db
    .select({ id: candidateSelfIdentification.candidateId, gender: candidateSelfIdentification.gender, religionEnc: candidateSelfIdentification.religionEnc })
    .from(candidateSelfIdentification)
    .innerJoin(candidates, eq(candidates.id, candidateSelfIdentification.candidateId))
    .where(isNull(candidates.anonymizedAt));
  return {
    employees: summarizeAnswers(emp.map((r) => r.gender), emp.map((r) => dec(r.religionEnc, empCtx("religion", r.id)))),
    applicants: summarizeAnswers(app.map((r) => r.gender), app.map((r) => dec(r.religionEnc, candCtx("religion", r.id)))),
    minGroup: MIN_GROUP,
  };
}
