import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { parseDollars } from "./calc";

const uuid = z.uuid();

export const previewInvoiceRunSchema = z.object({ runId: uuid });

export const createInvoiceSchema = z.object({ runId: uuid, clientId: uuid });

/** The hourly billing rate is typed in US dollars ("25", "25.50"): positive, at most 999.99, two decimals. */
export const addBillRateSchema = z.object({
  clientId: uuid,
  effectiveFrom: isoDate,
  rate: z.string().trim().refine((v) => parseDollars(v) !== null, "Enter a rate in dollars, for example 25.50"),
});
