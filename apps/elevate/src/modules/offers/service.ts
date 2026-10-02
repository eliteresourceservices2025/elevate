import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatDateOnly, formatInZone, DEFAULT_TIMEZONE } from "@/lib/time";
import { applications, candidates, jobOpenings } from "@/modules/recruiting/schema";
import { esignEnvelopes } from "@/modules/signing/schema";
import type { EnvelopeStatus } from "@/modules/signing/constants";
import { cleanValue, missingFields, renderBlocks, renderText, type OfferValues } from "./merge";
import { offers, offerTemplates } from "./schema";

// Internals for offers and hiring (not a "use server" file). Callers authorize first.

export type OfferStatus = "draft" | "sent" | "signed" | "declined" | "expired" | "withdrawn";

/** An offer's status is its envelope's status: no envelope yet = draft, out = sent, completed = signed, and so on. */
export function offerStatus(envelope: EnvelopeStatus | null): OfferStatus {
  switch (envelope) {
    case null:
    case "draft":
      return "draft";
    case "out":
      return "sent";
    case "completed":
      return "signed";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    case "voided":
      return "withdrawn";
  }
}

export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = { draft: "Draft", sent: "Sent, waiting for the applicant", signed: "Signed", declined: "Declined", expired: "Expired", withdrawn: "Withdrawn" };

export type OfferInput = { roleTitle: string; startDate: string; clientName?: string; payNote?: string; expiryDays: number };

export const longDate = (iso: string) => formatDateOnly(iso);

/** The values a letter is filled with: the applicant's name and the dates are set by the system, the rest is typed by the recruiter. */
export function offerValues(candidateName: string, input: OfferInput, now = new Date()): OfferValues {
  const expires = new Date(now.getTime() + input.expiryDays * 86_400_000);
  return {
    candidate_name: cleanValue(candidateName, { name: true }),
    offer_date: formatInZone(now, DEFAULT_TIMEZONE, "MMMM d, yyyy"),
    expires_on: formatInZone(expires, DEFAULT_TIMEZONE, "MMMM d, yyyy"),
    role_title: cleanValue(input.roleTitle),
    start_date: longDate(input.startDate),
    client_name: cleanValue(input.clientName ?? ""),
    pay_note: cleanValue(input.payNote ?? ""),
  };
}

/** Everything needed to draw and store a letter, or the reason it cannot be made yet. */
export function buildLetter(templateBody: string, values: OfferValues): { ok: true; blocks: ReturnType<typeof renderBlocks>; text: string } | { ok: false; error: string } {
  const missing = missingFields(templateBody, values);
  if (missing.length) return { ok: false, error: `Fill in: ${missing.join(", ").replace(/_/g, " ")}.` };
  return { ok: true, blocks: renderBlocks(templateBody, values), text: renderText(templateBody, values) };
}

export async function loadApplicant(applicationId: string) {
  const [row] = await db
    .select({ app: applications, title: jobOpenings.title, name: candidates.fullName, email: candidates.email, phone: candidates.phone, country: candidates.country, anonymized: candidates.anonymizedAt })
    .from(applications)
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.id, applicationId));
  return row ?? null;
}

export async function loadTemplate(templateId: string) {
  const [t] = await db.select().from(offerTemplates).where(eq(offerTemplates.id, templateId));
  return t && !t.archivedAt ? t : null;
}

/** The offers made for an application, newest first, each with its envelope's status. */
export async function offersFor(applicationId: string) {
  const rows = await db
    .select({ offer: offers, envelopeStatus: esignEnvelopes.status, sealedAt: esignEnvelopes.sealedAt })
    .from(offers)
    .leftJoin(esignEnvelopes, eq(esignEnvelopes.id, offers.envelopeId))
    .where(eq(offers.applicationId, applicationId))
    .orderBy(desc(offers.createdAt));
  return rows.map((r) => ({ ...r.offer, status: offerStatus(r.envelopeStatus as EnvelopeStatus | null), sealedAt: r.sealedAt }));
}

export async function offerById(offerId: string) {
  const [row] = await db.select({ offer: offers, envelopeStatus: esignEnvelopes.status }).from(offers).leftJoin(esignEnvelopes, eq(esignEnvelopes.id, offers.envelopeId)).where(eq(offers.id, offerId));
  return row ? { ...row.offer, status: offerStatus(row.envelopeStatus as EnvelopeStatus | null) } : null;
}

export const latestSigned = async (applicationId: string) => (await offersFor(applicationId)).find((o) => o.status === "signed") ?? null;

