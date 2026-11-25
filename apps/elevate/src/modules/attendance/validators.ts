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
  /** Clock in, or switch client: the client the time belongs to. Left out when the person has one client or none. */
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  /** Clock in, or switch: a project of the client (it also names the client when no clientId is sent). */
  projectId: z.preprocess(blankToUndefined, uuid.optional()),
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
  /** Screenshots uploaded with requestEvidenceUpload. Required (the action checks that there is at least one). */
  evidenceIds: z.array(uuid).max(3, "Attach three screenshots at most").default([]),
});
/** A lead or HR files a correction for someone else. */
export const fileForOthersSchema = z.object({ employeeId: uuid, reason, events: proposedEvents, kind: kind.default("other") });
/** HR or a lead changes someone's recorded time: events to remove (by id) and events to add, with a reason. At least one change. */
export const editAttendanceSchema = z
  .object({
    employeeId: uuid,
    voidEventIds: z.array(uuid).max(6, "Remove six events at most at once").default([]),
    events: z
      .array(z.object({ type: CLOCK_TYPES, at: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Enter a real date and time") }))
      .max(6, "Add six events at most at once")
      .default([]),
    reason,
  })
  .refine((v) => v.voidEventIds.length + v.events.length > 0, { message: "Remove or add at least one event", path: ["events"] });
/** Which person and which calendar day (YYYY-MM-DD in the person's own zone) to show for changing. */
export const loadDaySchema = z.object({ employeeId: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date") });
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

/** One shift pattern: days, times, the unpaid break and (optionally) the client with their hours per day. */
const shiftRow = {
  startTime: hhmm,
  endTime: hhmm,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one working day").max(7).transform((d) => [...new Set(d)].sort((a, b) => a - b)),
  breakMinutes: z.preprocess(toNumber, z.number().int().min(0, "Zero or more").max(240, "240 at most")).default(0),
  /** The client this shift is for (empty = no client), and the minutes a day allotted to that client (empty = no separate limit). */
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  allottedMinutesPerDay: z.preprocess(blankToUndefined, z.preprocess(toNumber, z.number().int().min(1, "At least 1 minute").max(960, "960 minutes (16 hours) at most")).optional()),
};
/** Empty = the client's zone (with no client, the person's current client or company zone). */
const scheduleZone = z.preprocess(blankToUndefined, z.string().refine(isValidTimeZone, "Choose a valid time zone").optional());

/** HR gives one or many people one or more shift patterns from a date. "add" keeps what they have; "replace_all" ends everything else the day before. */
export const assignScheduleSchema = z.object({
  employeeIds: z.array(uuid).min(1, "Choose at least one person").max(200, "Choose 200 people at most"),
  effectiveFrom: ymd,
  zone: scheduleZone,
  mode: z.enum(["add", "replace_all"]).default("add"),
  shifts: z.array(z.object(shiftRow)).min(1, "Add at least one shift").max(14, "14 shifts at most"),
});
/** HR replaces one schedule from a date: it ends the day before and the new shift starts. */
export const replaceScheduleSchema = z.object({ scheduleId: uuid, effectiveFrom: ymd, zone: scheduleZone, ...shiftRow });
/** HR fixes one recent or upcoming schedule in place (a mistake), with a reason. Dates are not changed here. */
export const updateScheduleSchema = z.object({ scheduleId: uuid, zone: scheduleZone, reason: z.string().trim().min(5, "Say why in a few words").max(300, "Use 300 characters or fewer"), ...shiftRow });
/** HR removes one schedule: it stops after the last day, or is dropped when it had not started by then. */
export const removeScheduleSchema = z.object({ scheduleId: uuid, lastDay: ymd });
/**
 * HR sets the hours of specific days for one or many people with no fixed schedule (minutes 0 = a day off, null = back to the usual hours), and
 * optionally their usual hours per day (null = the company default). `preview` counts what would change without writing.
 */
export const setDayHoursSchema = z
  .object({
    employeeIds: z.array(uuid).min(1, "Choose at least one person").max(200, "Choose 200 people at most"),
    days: z.array(z.object({ date: ymd, minutes: z.union([z.number().int("Whole minutes").min(0, "Zero or more").max(960, "16 hours at most"), z.null()]) })).max(152, "152 days at most").default([]),
    usualMinutes: z.union([z.number().int("Whole minutes").min(1, "At least 1 minute").max(960, "16 hours at most"), z.null()]).optional(),
    preview: z.boolean().default(false),
  })
  .refine((v) => v.days.length > 0 || v.usualMinutes !== undefined, { message: "Add at least one day", path: ["days"] })
  .refine((v) => new Set(v.days.map((d) => d.date)).size === v.days.length, { message: "Each day can only be listed once", path: ["days"] });

const reasonField = z.string().trim().min(5, "Say why in a few words").max(300, "Use 300 characters or fewer");
/** HR changes ONE day: for each client listed, its shifts that day (none = off). Clients not listed keep their usual shifts. */
export const dayChangeSchema = z
  .object({
    employeeId: uuid,
    date: ymd,
    reason: reasonField,
    clients: z
      .array(
        z.object({
          clientId: z.preprocess(blankToUndefined, uuid.optional()),
          shifts: z.array(z.object({ startTime: hhmm, endTime: hhmm, breakMinutes: shiftRow.breakMinutes, allottedMinutesPerDay: shiftRow.allottedMinutesPerDay })).max(4, "4 shifts at most"),
        }),
      )
      .min(1, "Change at least one shift")
      .max(14),
  })
  .refine((v) => new Set(v.clients.map((c) => c.clientId ?? "")).size === v.clients.length, { message: "Each client can only be listed once", path: ["clients"] });
export const removeDayChangeSchema = z.object({ employeeId: uuid, date: ymd });
/** HR ends the current schedules of many people on the same date. */
export const endSchedulesSchema = z.object({
  employeeIds: z.array(uuid).min(1, "Choose at least one person").max(200, "Choose 200 people at most"),
  endDate: ymd,
  /** Only this client's schedules (leave out to end every schedule in force that day). */
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  /** Also remove schedules that would start after the end date. */
  includeUpcoming: z.boolean().default(false),
});

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

/** A person asks to make up missed time in another window (before working it). */
export const makeupRequestSchema = z.object({
  absenceDate: ymd,
  windowStart: instant,
  windowEnd: instant,
  reason: text(5, 300, "Explain why in a few words"),
});
export const decideMakeupSchema = z.object({
  requestId: uuid,
  decision: z.enum(["approve", "decline"]),
  note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
});
export const cancelMakeupSchema = z.object({ requestId: uuid });
/** A screenshot upload for an extra hours request; employeeId when a lead or HR uploads for someone else. */
export const extraUploadSchema = evidenceUploadSchema.extend({ employeeId: z.preprocess(blankToUndefined, uuid.optional()) });

/** Approve one person's week (any Monday) through the last finished day. */
export const approveWeekSchema = z.object({ employeeId: uuid, weekStart: ymd, note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()) });
/** Mark one person's day as test only (a note says why), or take the mark off. */
export const markTestDaySchema = z.object({ employeeId: uuid, date: ymd, note: z.string().trim().min(3, "Say why in a few words").max(200, "Use 200 characters or fewer") });
export const clearTestDaySchema = z.object({ employeeId: uuid, date: ymd });
export const reopenHoursSchema = z
  .object({ employeeId: uuid, from: ymd, to: ymd, reason: z.string().trim().min(5, "Say why in a few words").max(300, "Use 300 characters or fewer") })
  .refine((v) => v.from <= v.to && (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <= 6, "Choose one day, or one week at most.");
export const approveCleanSchema = z.object({ weekStart: ymd });
export const payPeriodSchema = z.object({ kind: z.enum(["semi_monthly", "weekly", "biweekly", "monthly"]), biweeklyAnchor: z.preprocess(blankToUndefined, ymd.optional()) });
export const exportHoursSchema = z.object({ periodStart: ymd, kind: z.enum(["daily", "summary"]), includeUnapproved: z.boolean().default(false) });

/** HR files missing clock events for many people from a spreadsheet's text. */
export const bulkCorrectionsSchema = z.object({
  csv: z.string().min(10, "Paste or choose a spreadsheet first").max(200_000, "That file is too big"),
  timeZone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
  reason: z.string().trim().min(5, "Explain what happened in a few words").max(300, "Use 300 characters or fewer"),
  kind: z.enum(["forgot", "connection_problem", "device_problem", "other"]).default("other"),
});
export const decideBatchSchema = z.object({
  batchId: uuid,
  decision: z.enum(["approve", "reject"]),
  note: z.preprocess(blankToUndefined, z.string().trim().max(300).optional()),
});
