import { sql } from "drizzle-orm";
import { check, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { core } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { candidates, talent } from "@/modules/recruiting/schema";

// Voluntary self-identification, kept in tables of their own so no ordinary profile or applicant query can pick it up
// by accident (never `select *` from employees or candidates and find it). The gender key is plain so it can be counted
// in SQL; religion and every self-described text are encrypted (src/lib/crypto.ts), contexts
// "employee_demographics:<field>:<employeeId>" and "candidate_self_id:<field>:<candidateId>".
// Nobody but the person reads their own values; HR reads combined counts only (see service.ts).

export const employeeDemographics = core
  .table(
    "employee_demographics",
    {
      employeeId: uuid("employee_id")
        .primaryKey()
        .references(() => employees.id),
      gender: text("gender"),
      genderOtherEnc: text("gender_other_enc"),
      /** Shown next to the person's name, so it is plain text, not encrypted. */
      pronouns: text("pronouns"),
      pronounsOther: text("pronouns_other"),
      religionEnc: text("religion_enc"),
      religionOtherEnc: text("religion_other_enc"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check("employee_demographics_gender_chk", sql`${t.gender} is null or ${t.gender} in ('woman','man','non_binary','self_described','prefer_not_to_say')`),
      check("employee_demographics_pronouns_chk", sql`${t.pronouns} is null or ${t.pronouns} in ('she_her','he_him','they_them','she_they','he_they','ask_me','self_described','prefer_not_to_say')`),
    ],
  )
  .enableRLS();

export const candidateSelfIdentification = talent
  .table(
    "candidate_self_identification",
    {
      candidateId: uuid("candidate_id")
        .primaryKey()
        .references(() => candidates.id),
      gender: text("gender"),
      genderOtherEnc: text("gender_other_enc"),
      religionEnc: text("religion_enc"),
      religionOtherEnc: text("religion_other_enc"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("candidate_self_identification_gender_chk", sql`${t.gender} is null or ${t.gender} in ('woman','man','non_binary','self_described','prefer_not_to_say')`)],
  )
  .enableRLS();
