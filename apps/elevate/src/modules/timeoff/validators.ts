import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { MAX_AWARD_DAYS, isHalfDayStep } from "./ledger";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);
const reason = (label: string) => z.string().trim().min(3, `Enter ${label}`).max(200, "Use 200 characters or fewer");
const name = (max = 80) => z.string().trim().min(2, "Enter a name").max(max, `Use ${max} characters or fewer`);

const halfDays = (min: number, max: number) =>
  z.preprocess(
    toNumber,
    z
      .number({ error: "Enter a number of days" })
      .refine(isHalfDayStep, "Use whole or half days")
      .refine((n) => n >= min && n <= max, `Use between ${min} and ${max} days`),
  );

export const awardSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  days: halfDays(0.5, MAX_AWARD_DAYS),
  reason: reason("the game or reason"),
  expiresOn: z.preprocess(blankToUndefined, isoDate.optional()),
});

export const adjustSchema = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  /** Negative removes days. */
  days: z
    .preprocess(toNumber, z.number({ error: "Enter a number of days" }).refine(isHalfDayStep, "Use whole or half days"))
    .refine((n) => n !== 0, "Enter more or less than zero")
    .refine((n) => Math.abs(n) <= MAX_AWARD_DAYS, `Use at most ${MAX_AWARD_DAYS} days at a time`),
  reason: reason("the reason for the correction"),
});

export const leaveTypeSchema = z.object({
  name: name(),
  tracksBalance: z.boolean(),
  skipHr: z.boolean().default(false),
});
export const updateLeaveTypeSchema = z.object({ leaveTypeId: uuid, name: name(), skipHr: z.boolean().default(false) });
export const archiveLeaveTypeSchema = z.object({ leaveTypeId: uuid });

export const holidaySchema = z.object({
  calendar: z.enum(["PH", "US"]),
  date: isoDate,
  name: name(120),
  kind: z.enum(["regular", "special_non_working", "special_working", "federal", "observed", "other"]),
  verified: z.boolean().default(false),
});
export const updateHolidaySchema = holidaySchema.extend({ holidayId: uuid });
export const archiveHolidaySchema = z.object({ holidayId: uuid });
