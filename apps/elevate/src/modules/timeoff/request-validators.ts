import { z } from "zod";
import { isoDate } from "@/modules/people/validators";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const note = z.preprocess(blankToUndefined, z.string().trim().max(300, "Use 300 characters or fewer").optional());

const range = { startDate: isoDate, endDate: isoDate, halfDay: z.boolean().default(false) };
const inOrder = (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate;
const notTooLong = (v: { startDate: string; endDate: string }) => Date.parse(v.endDate) - Date.parse(v.startDate) <= 365 * 86_400_000;
const ORDER = { message: "The end date cannot be before the start date", path: ["endDate"] };
const LENGTH = { message: "A request can cover a year at most", path: ["endDate"] };

export const requestLeaveSchema = z
  .object({
    leaveTypeId: uuid,
    ...range,
    note,
    /** HR filing for someone else. Omit for your own request. */
    employeeId: z.preprocess(blankToUndefined, uuid.optional()),
  })
  .refine(inOrder, ORDER)
  .refine(notTooLong, LENGTH);

export const previewRequestSchema = z.object({ leaveTypeId: uuid, ...range }).refine(inOrder, ORDER).refine(notTooLong, LENGTH);

export const decideRequestSchema = z.object({
  requestId: uuid,
  decision: z.enum(["approve", "decline"]),
  note,
});

export const cancelRequestSchema = z.object({ requestId: uuid, reason: note });
export const requestIdSchema = z.object({ requestId: uuid });
