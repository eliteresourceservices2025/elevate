"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { clientIp } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { openOnboardingCase } from "@/modules/onboarding/service";
import { createEmployeeRecord } from "@/modules/people/create";
import { createEmployeeSchema } from "@/modules/people/validators";
import { authorizeForOpening, markHired } from "@/modules/recruiting/service";
import { sendInvitationEmail } from "@/modules/settings/invitation-email";
import { ensureInvitation } from "@/modules/settings/invite";
import { issueExternalLinks } from "@/modules/signing/external-mail";
import { createEnvelope, sendDraft, voidEnvelopeTx } from "@/modules/signing/service";
import { esignSigners } from "@/modules/signing/schema";
import { templateProblem } from "./merge";
import { buildLetter, latestSigned, loadApplicant, loadTemplate, offerById, offerValues, offersFor } from "./service";
import { offerTemplates, offers } from "./schema";
import { renderOfferPdf } from "./offer-pdf";
import { hireSchema, makeOfferSchema, offerIdSchema, offerTemplateSchema, previewSchema, templateIdSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (applicationId?: string) => {
  revalidatePath("/recruiting");
  if (applicationId) revalidatePath(`/recruiting/applications/${applicationId}`);
  revalidatePath("/recruiting/offer-templates");
};
const ipOf = async () => {
  const ip = await clientIp();
  return ip === "unknown" ? null : ip;
};

// ---- Templates (HR) -----------------------------------------------------------------------------------------------------------

export async function saveOfferTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.manage_templates");
    const parsed = offerTemplateSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const problem = templateProblem(v.body);
    if (problem) return fail(problem);
    try {
      const id = await db.transaction(async (tx) => {
        if (v.id) {
          const [row] = await tx.update(offerTemplates).set({ name: v.name, description: v.description ?? null, body: v.body, updatedAt: new Date() }).where(eq(offerTemplates.id, v.id)).returning({ id: offerTemplates.id });
          if (!row) throw new ActionFailure("That template was not found.");
          await writeAudit({ actor, action: "offers.template_update", targetType: "offer_template", targetId: v.id }, tx);
          return v.id;
        }
        const [row] = await tx.insert(offerTemplates).values({ name: v.name, description: v.description ?? null, body: v.body, createdBy: actor.id }).returning({ id: offerTemplates.id });
        await writeAudit({ actor, action: "offers.template_create", targetType: "offer_template", targetId: row.id }, tx);
        return row.id;
      });
      refresh();
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("A template with that name already exists.");
      throw error;
    }
  });
}

export async function archiveOfferTemplate(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.manage_templates");
    const parsed = templateIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.update(offerTemplates).set({ archivedAt: new Date() }).where(eq(offerTemplates.id, parsed.data.templateId)).returning({ id: offerTemplates.id });
      if (!row) throw new ActionFailure("That template was not found.");
      await writeAudit({ actor, action: "offers.template_archive", targetType: "offer_template", targetId: row.id }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// ---- Offers -------------------------------------------------------------------------------------------------------------------

/** The letter as plain text with the fields filled, so the recruiter can read it before sending. */
export async function previewOffer(input: unknown): Promise<ActionResult<{ text: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.make");
    const parsed = previewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const [applicant, template] = await Promise.all([loadApplicant(v.applicationId), loadTemplate(v.templateId)]);
    if (!applicant || !template) return fail("That applicant or template was not found.");
    await authorizeForOpening(actor, "recruiting.view", applicant.app.openingId);
    const letter = buildLetter(template.body, offerValues(applicant.name, v));
    if (!letter.ok) return fail(letter.error);
    return { ok: true, data: { text: letter.text } };
  });
}

export async function makeOffer(input: unknown): Promise<ActionResult<{ offerId: string; emailed: boolean | null }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.make");
    const parsed = makeOfferSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const [applicant, template] = await Promise.all([loadApplicant(v.applicationId), loadTemplate(v.templateId)]);
    if (!applicant) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.view", applicant.app.openingId);
    if (!template) return fail("That template was not found or is archived.");
    if (applicant.anonymized) return fail("This applicant's data was removed, so no offer can be made.");
    if (applicant.app.stage !== "offer") return fail("Move the applicant to the Offer stage first.");
    if ((await offersFor(v.applicationId)).some((o) => o.status === "draft" || o.status === "sent")) return fail("There is already an offer waiting for this applicant. Withdraw it first.");

    const letter = buildLetter(template.body, offerValues(applicant.name, v));
    if (!letter.ok) return fail(letter.error);
    const pdf = await renderOfferPdf({ title: `Offer: ${v.roleTitle}`, blocks: letter.blocks, footer: "Elite Resource Services" });

    const signers = [{ external: { name: applicant.name, email: applicant.email }, role: "Applicant" }, ...(v.counterSignerUserId ? [{ userId: v.counterSignerUserId, role: "ERS representative" }] : [])];
    const created = await createEnvelope(actor, { title: `Offer: ${v.roleTitle}`, pdf, fileName: "offer.pdf", signers, order: "sequential", expiryDays: v.expiryDays, send: v.send, ip: await ipOf() });
    let offerId: string;
    try {
      offerId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(offers)
          .values({ applicationId: v.applicationId, templateId: template.id, templateName: template.name, fields: { role_title: v.roleTitle, start_date: v.startDate, client_name: v.clientName ?? "", pay_note: v.payNote ?? "" }, renderedBody: letter.text, envelopeId: created.id, createdBy: actor.id })
          .returning({ id: offers.id });
        await writeAudit({ actor, action: "offers.make", targetType: "application", targetId: v.applicationId, after: { offerId: row.id, sent: v.send, counterSigner: Boolean(v.counterSignerUserId) } }, tx);
        return row.id;
      });
    } catch (error) {
      // Do not leave a sent envelope with no offer behind it
      await db.transaction((tx) => voidEnvelopeTx(tx, actor, created.id, "Offer could not be saved", null)).catch(() => undefined);
      throw error;
    }
    refresh(v.applicationId);
    return { ok: true, data: { offerId, emailed: v.send ? (created.links ? created.links.failed === 0 && created.links.sent > 0 : false) : null } };
  });
}

/** Sends a saved draft: the applicant is emailed their link. */
export async function sendOffer(input: unknown): Promise<ActionResult<{ emailed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.make");
    const parsed = offerIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const offer = await offerById(parsed.data.offerId);
    if (!offer?.envelopeId) return fail("That offer was not found.");
    const applicant = await loadApplicant(offer.applicationId);
    if (!applicant) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.view", applicant.app.openingId);
    if (offer.status !== "draft") return fail("That offer was already sent.");
    const ip = await ipOf();
    const sent = await db.transaction((tx) => sendDraft(tx, actor, offer.envelopeId as string, ip));
    const links = await issueExternalLinks(sent.externalIds, "turn");
    refresh(offer.applicationId);
    return { ok: true, data: { emailed: links.sent > 0 && links.failed === 0 } };
  });
}

export async function withdrawOffer(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.make");
    const parsed = offerIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const offer = await offerById(parsed.data.offerId);
    if (!offer?.envelopeId) return fail("That offer was not found.");
    const applicant = await loadApplicant(offer.applicationId);
    if (!applicant) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.view", applicant.app.openingId);
    if (offer.status !== "draft" && offer.status !== "sent") return fail("Only an offer that is waiting can be withdrawn.");
    const ip = await ipOf();
    await db.transaction(async (tx) => {
      await voidEnvelopeTx(tx, actor, offer.envelopeId as string, "Offer withdrawn", ip);
      await writeAudit({ actor, action: "offers.withdraw", targetType: "application", targetId: offer.applicationId, after: { offerId: offer.id } }, tx);
    });
    refresh(offer.applicationId);
    return { ok: true, data: undefined };
  });
}

/** A new link and code flow for the applicant (the earlier link stops working). */
export async function resendOfferLink(input: unknown): Promise<ActionResult<{ emailed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.make");
    const parsed = offerIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const offer = await offerById(parsed.data.offerId);
    if (!offer?.envelopeId || offer.status !== "sent") return fail("Only a sent offer that is still waiting can be sent again.");
    const applicant = await loadApplicant(offer.applicationId);
    if (!applicant) return fail("That application was not found.");
    await authorizeForOpening(actor, "recruiting.view", applicant.app.openingId);
    const signers = await db.select({ id: esignSigners.id, status: esignSigners.status, externalEmail: esignSigners.externalEmail }).from(esignSigners).where(eq(esignSigners.envelopeId, offer.envelopeId));
    const outside = signers.filter((s) => s.externalEmail !== null && s.status === "pending");
    if (outside.length === 0) return fail("The applicant has already signed, so there is nothing to resend.");
    const links = await issueExternalLinks(outside.map((s) => s.id), "turn");
    await db.transaction((tx) => writeAudit({ actor, action: "offers.resend", targetType: "application", targetId: offer.applicationId, after: { offerId: offer.id } }, tx));
    refresh(offer.applicationId);
    return { ok: true, data: { emailed: links.sent > 0 && links.failed === 0 } };
  });
}

// ---- Hiring (HR) --------------------------------------------------------------------------------------------------------------

/**
 * Hires an applicant: creates their person record, marks the application Hired, opens an onboarding case and (when they have no
 * ELEVATE account) saves an invitation and emails it. Needs a signed offer, or a written reason (HR and Super Admin only anyway).
 */
export async function hireCandidate(input: unknown): Promise<ActionResult<{ employeeId: string; invited: boolean; emailed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offers.hire");
    const parsed = hireSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const applicant = await loadApplicant(v.applicationId);
    if (!applicant) return fail("That application was not found.");
    if (applicant.anonymized) return fail("This applicant's data was removed, so they cannot be hired.");
    if (applicant.app.stage === "hired") return fail("They were already hired.");
    if (applicant.app.stage === "rejected") return fail("Reopen the application before hiring.");
    const signed = await latestSigned(v.applicationId);
    if (!signed && !v.withoutOfferReason) return fail("There is no signed offer. Give a reason to hire without one.");

    const person = createEmployeeSchema.safeParse({
      legalFirstName: v.legalFirstName,
      legalLastName: v.legalLastName,
      workEmail: v.workEmail,
      personalEmail: v.workEmail.toLowerCase() === applicant.email.toLowerCase() ? undefined : applicant.email,
      positionId: v.positionId,
      teamId: v.teamId,
      startDate: v.startDate,
      status: "onboarding",
      workerType: "contractor",
    });
    if (!person.success) return fail(first(person.error));

    try {
      const result = await db.transaction(async (tx) => {
        const created = await createEmployeeRecord(tx, actor, person.data, `Hired from the ${applicant.title} application`);
        await markHired(tx, actor, v.applicationId);
        await openOnboardingCase(tx, actor, { employeeId: created.id, applicationId: v.applicationId, offerId: signed?.id ?? null, startDate: v.startDate, withoutOfferReason: signed ? null : (v.withoutOfferReason ?? null) });
        // Someone with no ELEVATE account yet is invited (an existing account is linked by email when the record is created)
        const invite = created.linkedAccount ? ({ exists: true } as const) : await ensureInvitation(tx, actor, v.workEmail);
        await writeAudit({ actor, action: "offers.hire", targetType: "application", targetId: v.applicationId, after: { employeeId: created.id, signedOffer: Boolean(signed), withoutOfferReason: signed ? null : v.withoutOfferReason } }, tx);
        return { employeeId: created.id, invite };
      });
      let emailed = false;
      if (!result.invite.exists) emailed = await sendInvitationEmail(v.workEmail, result.invite.expiresAt);
      refresh(v.applicationId);
      revalidatePath("/people");
      return { ok: true, data: { employeeId: result.employeeId, invited: !result.invite.exists, emailed } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("Someone with that work email already exists.");
      throw error;
    }
  });
}
