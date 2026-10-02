import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone, DEFAULT_TIMEZONE, resolveTimeZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { archiveUserAccount } from "@/modules/core/users";
import { acknowledgments, policies, policyVersions } from "@/modules/announcements/schema";
import { clockPrefs } from "@/modules/attendance/schema";
import { openSession, wrapUpAttendance } from "@/modules/attendance/separation";
import { documents, documentTypes } from "@/modules/documents/schema";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { changeEmployeeStatus, endClientAssignments } from "@/modules/people/status";
import { esignEnvelopes } from "@/modules/signing/schema";
import { cancelWaitingLeave } from "@/modules/timeoff/separation";
import { disableLogin } from "./accounts";
import { DEFAULT_OFFBOARDING_ITEMS, DEFAULT_ONBOARDING_ITEMS, buildTasks, separationDue, type ItemDef, type Kind } from "./constants";
import { checklistTasks, checklistTemplateItems, checklistTemplates, exitInterviews, offboardingCases, onboardingCases } from "./schema";

// Internals for onboarding and offboarding (not a "use server" file, so nothing here is a public endpoint). Callers authorize first.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Actor = { id: string; email: string };

export const todayIn = (zone = DEFAULT_TIMEZONE) => formatInZone(new Date(), zone, "yyyy-MM-dd");

/** The items for a case: the template for the person's position, else the default template, else the built-in default list. */
export async function itemsFor(executor: Pick<typeof db, "select">, kind: Kind, positionId: string | null): Promise<{ templateId: string | null; items: ItemDef[] }> {
  const candidates = [
    ...(positionId ? [await executor.select().from(checklistTemplates).where(and(eq(checklistTemplates.kind, kind), eq(checklistTemplates.positionId, positionId), isNull(checklistTemplates.archivedAt)))] : []),
    await executor.select().from(checklistTemplates).where(and(eq(checklistTemplates.kind, kind), isNull(checklistTemplates.positionId), isNull(checklistTemplates.archivedAt))),
  ];
  const template = candidates.flat()[0];
  if (!template) return { templateId: null, items: kind === "onboarding" ? DEFAULT_ONBOARDING_ITEMS : DEFAULT_OFFBOARDING_ITEMS };
  const rows = await executor.select().from(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, template.id)).orderBy(asc(checklistTemplateItems.position));
  return {
    templateId: template.id,
    items: rows.map((r) => ({ title: r.title, details: r.details, owner: r.owner as ItemDef["owner"], dueOffsetDays: r.dueOffsetDays, required: r.required, check: r.check as ItemDef["check"], documentTypeId: r.documentTypeId, policyId: r.policyId, policyKind: r.policyKind as ItemDef["policyKind"], signTemplateId: r.signTemplateId, href: r.href })),
  };
}

async function personContext(tx: Pick<typeof db, "select">, employeeId: string) {
  const [e] = await tx
    .select({ id: employees.id, userId: employees.userId, managerId: employees.managerId, positionId: employees.positionId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!e) throw new ActionFailure("That person was not found.");
  const [lead] = e.managerId ? await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, e.managerId)) : [];
  return { ...e, leadUserId: lead?.userId ?? null, name: `${e.first} ${e.last}` };
}

async function insertTasks(tx: Tx, p: { kind: Kind; caseId: string; employeeId: string; items: ItemDef[]; anchor: string; leadUserId: string | null; personUserId: string | null }) {
  const rows = buildTasks(p.items, { anchor: p.anchor, leadUserId: p.leadUserId, personUserId: p.personUserId });
  if (rows.length === 0) return [];
  return tx
    .insert(checklistTasks)
    .values(rows.map((r) => ({ ...r, onboardingCaseId: p.kind === "onboarding" ? p.caseId : null, offboardingCaseId: p.kind === "offboarding" ? p.caseId : null, employeeId: p.employeeId, check: r.check })))
    .returning({ id: checklistTasks.id, owner: checklistTasks.owner, ownerUserId: checklistTasks.ownerUserId });
}

/** Tell the owners their checklist exists: the person and the lead by name of task count, HR once. */
async function announce(tx: Tx, p: { kind: Kind; caseId: string; person: Awaited<ReturnType<typeof personContext>>; tasks: { owner: string; ownerUserId: string | null }[]; hrIds: string[] }) {
  const link = p.kind === "onboarding" ? `/onboarding/${p.caseId}` : `/offboarding/${p.caseId}`;
  const what = p.kind === "onboarding" ? "Onboarding" : "Offboarding";
  const out: { userId: string; kind: string; title: string; body: string; link: string }[] = [];
  if (p.person.userId && p.tasks.some((t) => t.owner === "person")) out.push({ userId: p.person.userId, kind: `${p.kind}.started`, title: `${what}: you have tasks`, body: "Open it to see what to do and when.", link: p.kind === "onboarding" ? "/onboarding" : "/offboarding" });
  if (p.person.leadUserId && p.tasks.some((t) => t.owner === "lead")) out.push({ userId: p.person.leadUserId, kind: `${p.kind}.started`, title: `${what}: tasks for you`, body: `${p.person.name} has ${what.toLowerCase()} tasks that are yours.`, link });
  for (const userId of p.hrIds) out.push({ userId, kind: `${p.kind}.started`, title: `${what} started for ${p.person.name}`, body: "The checklist is ready.", link });
  await notify(tx, out);
}

/** Opens the onboarding case for a hire (called by hiring): the case, its tasks from the right template, and the notices. */
export async function openOnboardingCase(tx: Tx, actor: Actor, p: { employeeId: string; applicationId: string; offerId: string | null; startDate: string; withoutOfferReason: string | null }): Promise<{ caseId: string }> {
  const person = await personContext(tx, p.employeeId);
  const { templateId, items } = await itemsFor(tx, "onboarding", person.positionId);
  const [c] = await tx
    .insert(onboardingCases)
    .values({ employeeId: p.employeeId, applicationId: p.applicationId, offerId: p.offerId, templateId, startDate: p.startDate, hiredWithoutOfferReason: p.withoutOfferReason, createdBy: actor.id })
    .returning({ id: onboardingCases.id });
  const tasks = await insertTasks(tx, { kind: "onboarding", caseId: c.id, employeeId: p.employeeId, items, anchor: p.startDate, leadUserId: person.leadUserId, personUserId: person.userId });
  await announce(tx, { kind: "onboarding", caseId: c.id, person, tasks, hrIds: await hrUserIds() });
  await writeAudit({ actor, action: "onboarding.open", targetType: "employee", targetId: p.employeeId, after: { caseId: c.id, tasks: tasks.length } }, tx);
  return { caseId: c.id };
}

// ---- Auto checks ------------------------------------------------------------------------------------------------------------

export type TaskRow = typeof checklistTasks.$inferSelect;

/**
 * Which tasks ELEVATE can see are already satisfied: a document uploaded, a policy acknowledged, an account created, an agreement
 * signed, an exit interview submitted, access removed. Read-only: the sync job (or completing the case) is what records it.
 */
export async function satisfiedTasks(tx: Pick<typeof db, "select" | "execute">, tasks: TaskRow[], ctx: { employeeId: string; userId: string | null; today: string; offboardingCaseId?: string | null; accessRemoved?: boolean }): Promise<Set<string>> {
  const done = new Set<string>();
  for (const t of tasks) {
    if (t.status !== "todo") continue;
    if (await isSatisfied(tx, t, ctx)) done.add(t.id);
  }
  return done;
}

async function isSatisfied(tx: Pick<typeof db, "select" | "execute">, t: TaskRow, ctx: { employeeId: string; userId: string | null; today: string; offboardingCaseId?: string | null; accessRemoved?: boolean }): Promise<boolean> {
  switch (t.check) {
    case "manual":
      return false;
    case "account":
      return ctx.userId !== null;
    case "access":
      return Boolean(ctx.accessRemoved);
    case "exit_interview": {
      if (!ctx.offboardingCaseId) return false;
      const [row] = await tx.select({ id: exitInterviews.id }).from(exitInterviews).where(eq(exitInterviews.offboardingCaseId, ctx.offboardingCaseId));
      return Boolean(row);
    }
    case "document": {
      if (!t.documentTypeId) return false;
      const [row] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.employeeId, ctx.employeeId), eq(documents.typeId, t.documentTypeId), eq(documents.status, "active"), isNull(documents.archivedAt), sql`(${documents.expiresOn} is null or ${documents.expiresOn} >= ${ctx.today}::date)`))
        .limit(1);
      return Boolean(row);
    }
    case "required_documents": {
      const required = await tx.select({ id: documentTypes.id }).from(documentTypes).where(and(eq(documentTypes.scope, "employee"), eq(documentTypes.requiredForAll, true), isNull(documentTypes.archivedAt)));
      for (const type of required) {
        const [row] = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(and(eq(documents.employeeId, ctx.employeeId), eq(documents.typeId, type.id), eq(documents.status, "active"), isNull(documents.archivedAt), sql`(${documents.expiresOn} is null or ${documents.expiresOn} >= ${ctx.today}::date)`))
          .limit(1);
        if (!row) return false;
      }
      return true;
    }
    case "policy": {
      if (!ctx.userId) return false;
      const policyRows = t.policyId ? await tx.select({ id: policies.id }).from(policies).where(eq(policies.id, t.policyId)) : t.policyKind ? await tx.select({ id: policies.id }).from(policies).where(and(eq(policies.kind, t.policyKind), isNull(policies.archivedAt))) : [];
      if (!policyRows[0]) return false;
      const [current] = await tx.select({ id: policyVersions.id }).from(policyVersions).where(and(eq(policyVersions.policyId, policyRows[0].id), eq(policyVersions.status, "published"))).orderBy(desc(policyVersions.version)).limit(1);
      if (!current) return false; // nothing published yet: nothing to acknowledge, so it is not satisfied
      const [ack] = await tx.select({ id: acknowledgments.id }).from(acknowledgments).where(and(eq(acknowledgments.userId, ctx.userId), eq(acknowledgments.policyVersionId, current.id))).limit(1);
      return Boolean(ack);
    }
    case "signature": {
      if (!t.envelopeId) return false;
      const [env] = await tx.select({ status: esignEnvelopes.status }).from(esignEnvelopes).where(eq(esignEnvelopes.id, t.envelopeId));
      return env?.status === "completed";
    }
    default:
      return false;
  }
}

/** Records the tasks that ELEVATE sees are satisfied as done (marked automatic) for one open case. Returns how many it closed. */
export async function syncCase(kind: Kind, caseId: string): Promise<number> {
  const [c] =
    kind === "onboarding"
      ? await db.select({ employeeId: onboardingCases.employeeId, status: onboardingCases.status }).from(onboardingCases).where(eq(onboardingCases.id, caseId))
      : await db.select({ employeeId: offboardingCases.employeeId, status: offboardingCases.status, accessRemovedAt: offboardingCases.accessRemovedAt }).from(offboardingCases).where(eq(offboardingCases.id, caseId));
  if (!c || c.status !== "open") return 0;
  const [e] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, c.employeeId));
  const tasks = await db.select().from(checklistTasks).where(and(eq(kind === "onboarding" ? checklistTasks.onboardingCaseId : checklistTasks.offboardingCaseId, caseId), eq(checklistTasks.status, "todo")));
  const ok = await satisfiedTasks(db, tasks, { employeeId: c.employeeId, userId: e?.userId ?? null, today: todayIn(), offboardingCaseId: kind === "offboarding" ? caseId : null, accessRemoved: "accessRemovedAt" in c ? Boolean((c as { accessRemovedAt: Date | null }).accessRemovedAt) : false });
  if (ok.size === 0) return 0;
  await db.update(checklistTasks).set({ status: "done", autoCompleted: true, completedAt: new Date() }).where(inArray(checklistTasks.id, [...ok]));
  return ok.size;
}

// ---- Separation -------------------------------------------------------------------------------------------------------------

export type SeparationResult = { done: boolean; reason?: string };

/**
 * Removes access for someone whose last working day has ended (or on HR's "remove now"): marks them separated with their end date,
 * ends their client assignments, schedule and waiting requests, switches off the sign-in account, and records each step so a retry
 * continues where it stopped. Safe to run again. Refuses (and tells HR) while the person still has active reports.
 */
export async function executeSeparation(caseId: string, actor: Actor | null): Promise<SeparationResult> {
  const [c] = await db.select().from(offboardingCases).where(eq(offboardingCases.id, caseId));
  if (!c || c.status === "cancelled") return { done: false, reason: "That case is not open." };
  if (c.accessRemovedAt) return { done: true };
  const person = await personContext(db, c.employeeId);
  const hr = await hrUserIds();
  const steps = { ...c.steps };

  if (!steps.person) {
    try {
      await db.transaction(async (tx) => {
        await changeEmployeeStatus(tx, actor, c.employeeId, "separated", { endDate: c.lastWorkingDay, summary: `Separated: last working day ${c.lastWorkingDay}` });
        const assignments = await endClientAssignments(tx, c.employeeId, c.lastWorkingDay);
        const attendance = await wrapUpAttendance(tx, c.employeeId, c.lastWorkingDay);
        const leave = await cancelWaitingLeave(tx, c.employeeId, actor?.id ?? null, "The person has left");
        // Someone still clocked in on the way out: their lead and HR are told (nobody is clocked out automatically)
        if (await openSession(tx, c.employeeId)) await notify(tx, [...new Set([...(person.leadUserId ? [person.leadUserId] : []), ...hr])].map((userId) => ({ userId, kind: "offboarding.open_session", title: `${person.name} is still clocked in`, body: "Their access was removed while a clock session is open. Add a correction if needed.", link: `/offboarding/${caseId}` })));
        await tx.update(offboardingCases).set({ steps: { ...steps, person: true } }).where(eq(offboardingCases.id, caseId));
        await writeAudit({ actor, action: "offboarding.separate", targetType: "employee", targetId: c.employeeId, after: { lastWorkingDay: c.lastWorkingDay, assignmentsEnded: assignments, ...attendance, leaveCancelled: leave } }, tx);
      });
      steps.person = true;
    } catch (error) {
      if (error instanceof ActionFailure) {
        await db.transaction((tx) => notify(tx, hr.map((userId) => ({ userId, kind: "offboarding.blocked", title: `Cannot finish ${person.name}'s offboarding`, body: error.message, link: `/offboarding/${caseId}` }))));
        return { done: false, reason: error.message };
      }
      throw error;
    }
  }

  if (!steps.account) {
    if (person.userId) {
      await disableLogin(person.userId); // a failure here is retried by the hourly job; nothing else is lost
      await db.transaction(async (tx) => {
        await archiveUserAccount(tx, person.userId as string);
        await writeAudit({ actor, action: "offboarding.account_disabled", targetType: "employee", targetId: c.employeeId }, tx);
      });
    }
    steps.account = true;
  }

  await db.transaction(async (tx) => {
    await tx.update(offboardingCases).set({ steps, accessRemovedAt: new Date() }).where(and(eq(offboardingCases.id, caseId), isNull(offboardingCases.accessRemovedAt)));
    await tx.update(checklistTasks).set({ status: "done", autoCompleted: true, completedAt: new Date() }).where(and(eq(checklistTasks.offboardingCaseId, caseId), eq(checklistTasks.check, "access"), eq(checklistTasks.status, "todo")));
    await notify(tx, hr.map((userId) => ({ userId, kind: "offboarding.access_removed", title: `${person.name}'s access was removed`, body: "They are marked separated and can no longer sign in.", link: `/offboarding/${caseId}` })));
  });
  return { done: true };
}

/** Whether a case is due for separation now: the last working day has ended in the person's own zone. */
export async function isSeparationDue(caseRow: { employeeId: string; lastWorkingDay: string }, now = new Date()): Promise<boolean> {
  const [prefs] = await db.select({ zone: clockPrefs.timeZone }).from(clockPrefs).where(eq(clockPrefs.employeeId, caseRow.employeeId));
  return separationDue(caseRow.lastWorkingDay, resolveTimeZone(prefs?.zone), now);
}

export { personContext, insertTasks, announce };
