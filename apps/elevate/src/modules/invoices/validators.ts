import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { parseDollars } from "./calc";

const uuid = z.uuid();

export const previewInvoiceRunSchema = z.object({ runId: uuid });

export const createInvoiceSchema = z.object({ runId: uuid, clientId: uuid });

/** The hourly billing rate is typed in US dollars ("25", "25.50"): positive, at most 999.99, two decimals. */
export const addBillRateSchema = z.object({
  clientId: uuid,
  /** Blank is the client's default rate; a person's id is that person's own rate at the client. */
  employeeId: z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional()),
  effectiveFrom: isoDate,
  rate: z.string().trim().refine((v) => parseDollars(v) !== null, "Enter a rate in dollars, for example 25.50"),
});

const optionalReason = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional());

export const archiveInvoiceSchema = z.object({ invoiceId: uuid, reason: optionalReason });

export const restoreInvoiceSchema = z.object({ invoiceId: uuid });

/** A real invoice is voided with a reason, kept in the encrypted event and never in an audit row. */
export const voidInvoiceSchema = z.object({ invoiceId: uuid, reason: z.string().trim().min(1, "Give a reason").max(500) });
