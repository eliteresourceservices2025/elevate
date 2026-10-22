import "server-only";
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { candidates } from "@/modules/recruiting/schema";
import { employees } from "@/modules/people/schema";
import { GENDER_LABELS, MIN_GROUP, RELIGION_LABELS, SEXUAL_ORIENTATION_LABELS, sharedAnswerText } from "./constants";
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
export type SelfIdAnswers = {
  gender?: string;
  genderOther?: string;
  pronouns?: string;
  pronounsOther?: string;
  orientation?: string;
  orientationOther?: string;
  religion?: string;
  religionOther?: string;
  showGender?: boolean;
  showOrientation?: boolean;
  showReligion?: boolean;
};

export type SelfIdentification = {
  gender: string | null;
  genderOther: string | null;
  pronouns: string | null;
  pronounsOther: string | null;
  orientation: string | null;
  orientationOther: string | null;
  religion: string | null;
  religionOther: string | null;
  showGender: boolean;
  showOrientation: boolean;
  showReligion: boolean;
};
export const EMPTY_SELF_ID: SelfIdentification = {
  gender: null,
  genderOther: null,
  pronouns: null,
  pronounsOther: null,
  orientation: null,
  orientationOther: null,
  religion: null,
  religionOther: null,
  showGender: false,
  showOrientation: false,
  showReligion: false,
};

/** Saves the person's answers (replacing the old ones). With no answer at all, nothing is kept. Returns the field names answered and the ones shared. */
export async function saveEmployeeSelfId(tx: Writer, employeeId: string, v: SelfIdAnswers): Promise<{ answered: string[]; shared: string[] }> {
  const answered = Object.entries({ gender: v.gender, pronouns: v.pronouns, orientation: v.orientation, religion: v.religion })
    .filter(([, x]) => x)
    .map(([k]) => k);
  if (answered.length === 0) {
    await tx.delete(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId));
    return { answered: [], shared: [] };
  }
  // Sharing an answer nobody gave (or "prefer not to say") shows nothing, so the switch is kept off for it.
  const canShow = (value: string | undefined) => Boolean(value) && value !== "prefer_not_to_say";
  const showGender = Boolean(v.showGender) && canShow(v.gender);
  const showOrientation = Boolean(v.showOrientation) && canShow(v.orientation);
  const showReligion = Boolean(v.showReligion) && canShow(v.religion);
  const row = {
    gender: v.gender ?? null,
    genderOtherEnc: v.gender === "self_described" ? enc(v.genderOther, empCtx("gender_other", employeeId)) : null,
    pronouns: v.pronouns ?? null,
    pronounsOther: v.pronouns === "self_described" ? (v.pronounsOther ?? null) : null,
    sexualOrientationEnc: enc(v.orientation, empCtx("sexual_orientation", employeeId)),
    sexualOrientationOtherEnc: v.orientation === "self_described" ? enc(v.orientationOther, empCtx("sexual_orientation_other", employeeId)) : null,
    religionEnc: enc(v.religion, empCtx("religion", employeeId)),
    religionOtherEnc: v.religion === "self_described" ? enc(v.religionOther, empCtx("religion_other", employeeId)) : null,
    showGender,
    showOrientation,
    showReligion,
    updatedAt: new Date(),
  };
  await tx.insert(employeeDemographics).values({ employeeId, ...row }).onConflictDoUpdate({ target: employeeDemographics.employeeId, set: row });
  return { answered, shared: Object.entries({ gender: showGender, orientation: showOrientation, religion: showReligion }).filter(([, on]) => on).map(([k]) => k) };
}

export async function readEmployeeSelfId(employeeId: string): Promise<SelfIdentification> {
  const [r] = await db.select().from(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId)).limit(1);
  if (!r) return EMPTY_SELF_ID;
  return {
    gender: r.gender,
    genderOther: dec(r.genderOtherEnc, empCtx("gender_other", employeeId)),
    pronouns: r.pronouns,
    pronounsOther: r.pronounsOther,
    orientation: dec(r.sexualOrientationEnc, empCtx("sexual_orientation", employeeId)),
    orientationOther: dec(r.sexualOrientationOtherEnc, empCtx("sexual_orientation_other", employeeId)),
    religion: dec(r.religionEnc, empCtx("religion", employeeId)),
    religionOther: dec(r.religionOtherEnc, empCtx("religion_other", employeeId)),
    showGender: r.showGender,
    showOrientation: r.showOrientation,
    showReligion: r.showReligion,
  };
}

/** What the person chose to let colleagues read (gender, sexual orientation, religion), as words. A switch that is off, "prefer not to say" and no answer give null. */
export type SharedIdentity = { gender: string | null; orientation: string | null; religion: string | null };
export async function readSharedIdentity(employeeId: string): Promise<SharedIdentity> {
  const [r] = await db.select().from(employeeDemographics).where(eq(employeeDemographics.employeeId, employeeId)).limit(1);
  if (!r) return { gender: null, orientation: null, religion: null };
  return {
    gender: r.showGender ? sharedAnswerText(r.gender, dec(r.genderOtherEnc, empCtx("gender_other", employeeId)), GENDER_LABELS) : null,
    orientation: r.showOrientation
      ? sharedAnswerText(dec(r.sexualOrientationEnc, empCtx("sexual_orientation", employeeId)), dec(r.sexualOrientationOtherEnc, empCtx("sexual_orientation_other", employeeId)), SEXUAL_ORIENTATION_LABELS)
      : null,
    religion: r.showReligion ? sharedAnswerText(dec(r.religionEnc, empCtx("religion", employeeId)), dec(r.religionOtherEnc, empCtx("religion_other", employeeId)), RELIGION_LABELS) : null,
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
  if (!v.gender && !v.religion && !v.orientation) return;
  const row = {
    gender: v.gender ?? null,
    genderOtherEnc: v.gender === "self_described" ? enc(v.genderOther, candCtx("gender_other", candidateId)) : null,
    sexualOrientationEnc: enc(v.orientation, candCtx("sexual_orientation", candidateId)),
    sexualOrientationOtherEnc: v.orientation === "self_described" ? enc(v.orientationOther, candCtx("sexual_orientation_other", candidateId)) : null,
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
    .select({ id: employeeDemographics.employeeId, gender: employeeDemographics.gender, religionEnc: employeeDemographics.religionEnc, orientationEnc: employeeDemographics.sexualOrientationEnc })
    .from(employeeDemographics)
    .innerJoin(employees, eq(employees.id, employeeDemographics.employeeId))
    .where(sql`${employees.archivedAt} is null and ${employees.anonymizedAt} is null and ${employees.status} <> 'separated'`);
  const app = await db
    .select({ id: candidateSelfIdentification.candidateId, gender: candidateSelfIdentification.gender, religionEnc: candidateSelfIdentification.religionEnc, orientationEnc: candidateSelfIdentification.sexualOrientationEnc })
    .from(candidateSelfIdentification)
    .innerJoin(candidates, eq(candidates.id, candidateSelfIdentification.candidateId))
    .where(isNull(candidates.anonymizedAt));
  return {
    employees: summarizeAnswers(
      emp.map((r) => r.gender),
      emp.map((r) => dec(r.religionEnc, empCtx("religion", r.id))),
      emp.map((r) => dec(r.orientationEnc, empCtx("sexual_orientation", r.id))),
    ),
    applicants: summarizeAnswers(
      app.map((r) => r.gender),
      app.map((r) => dec(r.religionEnc, candCtx("religion", r.id))),
      app.map((r) => dec(r.orientationEnc, candCtx("sexual_orientation", r.id))),
    ),
    minGroup: MIN_GROUP,
  };
}
