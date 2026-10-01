import { z } from "zod";
import { isValidRange } from "./clock";
import { isValidTime } from "./schedule";
import { isValidTimeZone } from "@/lib/time";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const toNumber = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v);

export const clockSchema = z.object({
  /** Only used when the person has turned location on; the server rounds it. */
  latitude: z.preprocess(toNumber, z.number().min(-90).max(90).optional()),
  longitude: z.preprocess(toNumber, z.number().min(-180).max(180).optional()),
  /** The path returned by requestClockSelfie, for teams that require a selfie. */
  selfiePath: z.preprocess(blankToUndefined, z.string().max(200).optional()),
  /** For a break: how long it is meant to be (15, 30 or 60 minutes). Leave out for a break with no limit. */
  breakMinutes: z.preprocess(toNumber, z.union([z.literal(15), z.literal(30), z.literal(60)]).optional()),
});

export const preferencesSchema = z.object({
  shareLocation: z.boolean(),
  timeZone: z.preprocess(blankToUndefined, z.string().refine(isValidTimeZone, "Choose a valid time zone").optional()),
});

export const idleReportSchema = z.object({ source: z.enum(["idle_api", "fallback"]) });
export const idleAnswerSchema = z.object({ promptId: uuid });

const CLOCK_TYPES = z.enum(["clock_in", "break_start", "break_end", "clock_out"]);

const reason = z.string().trim().min(5, "Explain what happened in a few words").max(300, "Use 300 characters or fewer");
const proposedEvents = z
  .array(z.object({ type: CLOCK_TYPES, at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a real date and time") }))
  .min(1, "Add at least one event")
  .max(6, "Add six events at most");
const kind = z.enum(["forgot", "connection_problem", "device_problem", "other"]);

export const correctionRequestSchema = z.object({
  reason,
  events: proposedEvents,
  kind: kind.default("other"),
  /** Screenshots uploaded with requestEvidenceUpload. Required when the claim adds a clock-in. */
  evidenceIds: z.array(uuid).max(3, "Attach three screenshots at most").default([]),
});
/** A lead or HR files a correction for someone else. */
export const fileForOthersSchema = z.object({ employeeId: uuid, reason, events: proposedEvents, kind: kind.default("other") });
export const EVIDENCE_MAX_BYTES = 5_000_000;
export const evidenceUploadSchema = z.object({ mime: z.enum(["image/jpeg", "image/png"]), size: z.number().int().min(1).max(EVIDENCE_MAX_BYTES, "Each screenshot must be 5 MB or smaller") });
export const evidenceIdSchema = z.object({ evidenceId: uuid });
export const noteSchema = z.object({ sessionId: uuid, body: z.string().trim().min(1, "Write a short note first").max(5000, "Use 5,000 characters or fewer") });
export const correctionIdSchema = z.object({ correctionId: uuid });
export const decideCorrectionSchema = z.object({
  correctionId: uuid,
  decision: z.enum(["approve", "reject"]),
  note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
  /** The reviewer changed the times before approving. */
  events: proposedEvents.optional(),
});

const cidr = z.string().trim().refine(isValidRange, "Use an IPv4 address or range such as 203.0.113.0/24");
export const rulesSchema = z.object({
  teamId: uuid,
  allowedCidrs: z.array(cidr).max(50, "Fifty ranges at most"),
  selfieRequired: z.boolean(),
  /** Empty turns the idle prompt off. */
  idleMinutes: z.preprocess(toNumber, z.number().int().min(5, "At least 5 minutes").max(240, "At most 240 minutes").optional()),
  graceMinutes: z.preprocess(toNumber, z.number().int().min(0).max(240)).default(60),
  /** Flag a missing end-of-day report. Never blocks clocking out. */
  eodExpected: z.boolean().default(false),
  /** Use Jibble screenshots for this team. Needs the monitoring policy. */
  jibbleMirror: z.boolean().default(false),
  /** Minutes after the shift start (or before its end) before a late arrival or early leave is flagged. */
  lateGraceMinutes: z.preprocess(toNumber, z.number().int().min(0, "Zero or more").max(120, "120 at most")).default(10),
});

export const weekSchema = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a real date");
const hhmm = z.string().refine(isValidTime, "Use a time like 09:00");

/** HR gives one or many people the same shift pattern from a date. */
export const assignScheduleSchema = z.object({
  employeeIds: z.array(uuid).min(1, "Choose at least one person").max(200, "Choose 200 people at most"),
  effectiveFrom: ymd,
  startTime: hhmm,
  endTime: hhmm,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one working day").max(7).transform((d) => [...new Set(d)].sort((a, b) => a - b)),
  breakMinutes: z.preprocess(toNumber, z.number().int().min(0, "Zero or more").max(240, "240 at most")).default(0),
  /** Empty = each person's client zone (or the company zone). */
  zone: z.preprocess(blankToUndefined, z.string().refine(isValidTimeZone, "Choose a valid time zone").optional()),
});
export const endScheduleSchema = z.object({ employeeId: uuid, endDate: ymd });

const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a real date and time");
const text = (min: number, max: number, minMessage: string) => z.string().trim().min(min, minMessage).max(max, `Use ${max} characters or fewer`);

/** A VA asks to work extra hours for a client; the client's approval is shown as proof. */
export const extraRequestSchema = z.object({
  clientId: uuid,
  windowStart: instant,
  windowEnd: instant,
  contactName: text(2, 120, "Who at the client approved it?"),
  reason: text(5, 300, "Explain why in a few words"),
  evidenceIds: z.array(uuid).min(1, "Attach a screenshot of the client's approval").max(3, "Attach three screenshots at most"),
});

/** A lead or HR files extra hours the client asked for; the VA then confirms or declines. */
export const fileExtraForSchema = z
  .object({
    employeeId: uuid,
    clientId: uuid,
    windowStart: instant,
    windowEnd: instant,
    contactName: text(2, 120, "Who at the client asked?"),
    reason: text(5, 300, "Explain why in a few words"),
    confirmedByPhone: z.boolean().default(false),
    evidenceIds: z.array(uuid).max(3, "Attach three screenshots at most").default([]),
  })
  .refine((v) => v.confirmedByPhone || v.evidenceIds.length > 0, { message: "Attach the client's request, or confirm that you spoke to the client.", path: ["evidenceIds"] });

export const answerExtraSchema = z.object({ requestId: uuid, answer: z.enum(["confirm", "decline"]), note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()) });
export const decideExtraSchema = z.object({
  requestId: uuid,
  decision: z.enum(["approve", "decline"]),
  note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
  /** The reviewer changed the window before approving. */
  windowStart: z.preprocess(blankToUndefined, instant.optional()),
  windowEnd: z.preprocess(blankToUndefined, instant.optional()),
});
export const cancelExtraSchema = z.object({ requestId: uuid });
/** A screenshot upload for an extra hours request; employeeId when a lead or HR uploads for someone else. */
export const extraUploadSchema = evidenceUploadSchema.extend({ employeeId: z.preprocess(blankToUndefined, uuid.optional()) });
