import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { authorize, ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, userRoles } from "@/modules/core/schema";
import { positions, teams } from "@/modules/org/schema";
import { applications } from "@/modules/recruiting/schema";
import { authorizeForOpening } from "@/modules/recruiting/service";
import { legalNames } from "@/modules/signing/service";
import { esignSigners } from "@/modules/signing/schema";
import { loadApplicant, offersFor, type OfferStatus } from "./service";
import { offerTemplates, onboardingCases } from "./schema";

export type TemplateRow = { id: string; name: string; description: string | null; body: string; updatedAt: Date };

export async function listOfferTemplates(): Promise<TemplateRow[]> {
  const user = await requireUser();
  await authorize(user, "offers.manage_templates");
  const rows = await db.select().from(offerTemplates).where(isNull(offerTemplates.archivedAt)).orderBy(asc(offerTemplates.name));
  return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, body: t.body, updatedAt: t.updatedAt }));
}

export type OfferRow = { id: string; templateName: string; status: OfferStatus; roleTitle: string; startDate: string; createdAt: Date; envelopeId: string | null; applicantOpened: boolean; counterSigned: boolean | null; hasCounterSigner: boolean };

/**
 * Everything the applicant page needs about offers and hiring: the offers so far (with where each stands), the templates to pick
 * from, who can countersign, and the positions and teams for the hire form. Seen by the hiring team and HR; only some may act.
 */
export async function getOfferPanel(applicationId: string) {
  const user = await requireUser();
  const applicant = await loadApplicant(applicationId);
  if (!applicant) throw new ForbiddenError("offers.view"); // shown as not found, like no access
  await authorizeForOpening(user, "offers.view", applicant.app.openingId);
  const canMake = scopeFor(user, "offers.make") !== null;
  const canHire = scopeFor(user, "offers.hire") !== null;

  const list = await offersFor(applicationId);
  const envelopeIds = list.flatMap((o) => (o.envelopeId ? [o.envelopeId] : []));
  const signers = envelopeIds.length ? await db.select().from(esignSigners).where(inArray(esignSigners.envelopeId, envelopeIds)) : [];
  const rows: OfferRow[] = list.map((o) => {
    const mine = signers.filter((s) => s.envelopeId === o.envelopeId);
    const outside = mine.find((s) => s.userId === null);
    const counter = mine.find((s) => s.userId !== null);
    return {
      id: o.id,
      templateName: o.templateName,
      status: o.status,
      roleTitle: o.fields.role_title ?? "",
      startDate: o.fields.start_date ?? "",
      createdAt: o.createdAt,
      envelopeId: o.envelopeId,
      applicantOpened: Boolean(outside?.viewedAt),
      counterSigned: counter ? counter.status === "signed" : null,
      hasCounterSigner: Boolean(counter),
    };
  });

  const templates = canMake ? await db.select({ id: offerTemplates.id, name: offerTemplates.name }).from(offerTemplates).where(isNull(offerTemplates.archivedAt)).orderBy(asc(offerTemplates.name)) : [];
  let counterSigners: { userId: string; name: string }[] = [];
  if (canMake) {
    const eligible = await db.select({ id: users.id }).from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).where(and(isNull(users.archivedAt), inArray(userRoles.roleSlug, ["super_admin", "hr_admin", "executive"])));
    const ids = [...new Set(eligible.map((e) => e.id))];
    const names = await legalNames(db, ids);
    counterSigners = ids.map((id) => ({ userId: id, name: names.get(id) ?? "Unknown" })).sort((a, b) => a.name.localeCompare(b.name));
  }
  const [hired] = await db.select({ employeeId: onboardingCases.employeeId }).from(onboardingCases).where(eq(onboardingCases.applicationId, applicationId));
  const positionRows = canHire ? await db.select({ id: positions.id, title: positions.title }).from(positions).where(isNull(positions.archivedAt)).orderBy(asc(positions.title)) : [];
  const teamRows = canHire ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.name)) : [];

  const stage = (await db.select({ stage: applications.stage }).from(applications).where(eq(applications.id, applicationId)))[0]?.stage ?? applicant.app.stage;
  const [first, ...rest] = applicant.name.trim().split(/\s+/);
  return {
    stage,
    offers: rows,
    templates,
    counterSigners,
    canMake,
    canHire,
    hiredEmployeeId: hired?.employeeId ?? null,
    hasSignedOffer: rows.some((r) => r.status === "signed"),
    positions: positionRows,
    teams: teamRows,
    hireDefaults: { legalFirstName: first ?? "", legalLastName: rest.join(" "), workEmail: applicant.email },
  };
}
