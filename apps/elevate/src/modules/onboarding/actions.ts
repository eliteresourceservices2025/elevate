"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import { clientIp } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatDateOnly } from "@/lib/time";
import { parseMarkdown } from "@/lib/markdown";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { renderOfferPdf } from "@/modules/offers/offer-pdf";
import { activeDirectReports, managerChainUserIds, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { changeEmployeeStatus } from "@/modules/people/status";
import { createEnvelope, loadTemplatePdf } from "@/modules/signing/service";
import { sha256Hex } from "@/modules/signing/chain";
import { itemsFor, personContext, executeSeparation, insertTasks, announce, satisfiedTasks, syncCase, todayIn } from "./service";
import { certificates, checklistTasks, checklistTemplateItems, checklistTemplates, exitInterviews, offboardingCases, onboardingCases } from "./schema";
import { caseIdSchema, certificateSchema, checklistTemplateSchema, completeTaskSchema, exitInterviewSchema, skipTaskSchema, startOffboardingSchema, taskIdSchema, templateIdSchema } from "./validators";
import { progress } from "./constants";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (...paths: string[]) => {
  revalidatePath("/onboarding");
  revalidatePath("/offboarding");
  for (const p of paths) revalidatePath(p);
};

// ---- Templates (HR) ---------------------------------------------------------------------------------------------------------

export async function saveChecklistTemplate(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "onboarding.manage_templates");
    const parsed = checklistTemplateSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    try {
      const id = await db.transaction(async (tx) => {
        let templateId = v.id;
        if (templateId) {
          const [row] = await tx.update(checklistTemplates).set({ name: v.name, positionId: v.positionId ?? null }).where(and(eq(checklistTemplates.id, templateId), isNull(checklistTemplates.archivedAt))).returning({ id: checklistTemplates.id });
          if (!row) throw new ActionFailure("That template was not found.");
          await tx.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, templateId));
        } else {
          const [row] = await tx.insert(checklistTemplates).values({ kind: v.kind, name: v.name, positionId: v.positionId ?? null, createdBy: actor.id }).returning({ id: checklistTemplates.id });
          templateId = row.id;
        }
        await tx.insert(checklistTemplateItems).values(
          v.items.map((it, i) => ({ templateId: templateId as string, position: i + 1, title: it.title, details: it.details ?? null, owner: it.owner, dueOffsetDays: it.dueOffsetDays, required: it.required, check: it.check, documentTypeId: it.documentTypeId ?? null, policyId: it.policyId ?? null, policyKind: it.policyKind ?? null, signTemplateId: it.signTemplateId ?? null, href: it.href ?? null })),
        );
        await writeAudit({ actor, action: v.id ? "checklist.template_update" : "checklist.template_create", targetType: "checklist_template", targetId: templateId, after: { kind: v.kind, items: v.items.length } }, tx);
        return templateId;
      });
      refresh("/onboarding/templates");
      return { ok: true, data: { id } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("There is already a template for that position. Edit it, or archive it first.");
      throw error;
    }
  });
}

export async function archiveChecklistTemplate(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "onboarding.manage_templates");
    const parsed = templateIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [row] = await tx.update(checklistTemplates).set({ archivedAt: new Date() }).where(and(eq(checklistTemplates.id, parsed.data.templateId), isNull(checklistTemplates.archivedAt))).returning({ id: checklistTemplates.id });
      if (!row) throw new ActionFailure("That template was not found.");
      await writeAudit({ actor, action: "checklist.template_archive", targetType: "checklist_template", targetId: row.id }, tx);
    });
    refresh("/onboarding/templates");
    return { ok: true, data: undefined };
  });
}

// ---- Tasks ------------------------------------------------------------------------------------------------------------------

/** Who may act on a task: HR and Super Admin any task; a lead their downline's lead tasks; the person their own; nobody else. */
async function mayActOnTask(actor: AuthUser, task: typeof checklistTasks.$inferSelect): Promise<boolean> {
  const manage = task.onboardingCaseId ? "onboarding.manage" : "offboarding.manage";
  if (scopeFor(actor, manage) === "all") return true;
  const [e] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, task.employeeId));
  if (task.owner === "person") return Boolean(e?.userId && e.userId === actor.id);
  if (task.owner === "lead") {
    if (task.ownerUserId === actor.id) return true;
    return (await managerChainUserIds(db, task.employeeId)).includes(actor.id);
  }
  return false;
}

export async function completeTask(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = completeTaskSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [task] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, parsed.data.taskId));
    // Not yours looks the same as not there
    if (!task || !(await mayActOnTask(actor, task))) return fail("You do not have access to do that.");
    const kind = task.onboardingCaseId ? "onboarding" : "offboarding";
    await authorize(actor, kind === "onboarding" ? "onboarding.view" : "offboarding.view", { ownerUserId: actor.id, managerChainUserIds: [actor.id] });
    if (task.check !== "manual") return fail("ELEVATE completes this one by itself when it is done.");
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(checklistTasks).where(eq(checklistTasks.id, task.id)).for("update");
      if (!fresh || fresh.status !== "todo") throw new ActionFailure("That task is already closed.");
      const [c] = fresh.onboardingCaseId ? await tx.select({ status: onboardingCases.status }).from(onboardingCases).where(eq(onboardingCases.id, fresh.onboardingCaseId)) : await tx.select({ status: offboardingCases.status }).from(offboardingCases).where(eq(offboardingCases.id, fresh.offboardingCaseId as string));
      if (c?.status !== "open") throw new ActionFailure("This checklist is closed.");
      await tx.update(checklistTasks).set({ status: "done", completedBy: actor.id, completedAt: new Date(), note: parsed.data.note ?? null }).where(eq(checklistTasks.id, task.id));
      await writeAudit({ actor, action: "checklist.task_done", targetType: "checklist_task", targetId: task.id, after: { title: task.title } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** HR closes a task without doing it (with a reason), or reopens one. */
export async function skipTask(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = skipTaskSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [task] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, parsed.data.taskId));
    if (!task) return fail("That task was not found.");
    await authorize(actor, task.onboardingCaseId ? "onboarding.manage" : "offboarding.manage");
    if (scopeFor(actor, task.onboardingCaseId ? "onboarding.manage" : "offboarding.manage") !== "all") return fail("You do not have access to do that.");
    await db.transaction(async (tx) => {
      const [row] = await tx.update(checklistTasks).set({ status: "skipped", completedBy: actor.id, completedAt: new Date(), note: parsed.data.reason }).where(and(eq(checklistTasks.id, task.id), eq(checklistTasks.status, "todo"))).returning({ id: checklistTasks.id });
      if (!row) throw new ActionFailure("That task is already closed.");
      await writeAudit({ actor, action: "checklist.task_skip", targetType: "checklist_task", targetId: task.id, after: { reason: parsed.data.reason } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function reopenTask(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = taskIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [task] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, parsed.data.taskId));
    if (!task) return fail("That task was not found.");
    await authorize(actor, task.onboardingCaseId ? "onboarding.manage" : "offboarding.manage");
    if (scopeFor(actor, task.onboardingCaseId ? "onboarding.manage" : "offboarding.manage") !== "all") return fail("You do not have access to do that.");
    await db.transaction(async (tx) => {
      const [row] = await tx.update(checklistTasks).set({ status: "todo", completedBy: null, completedAt: null, autoCompleted: false }).where(and(eq(checklistTasks.id, task.id), eq(checklistTasks.status, "done"))).returning({ id: checklistTasks.id });
      if (!row) throw new ActionFailure("Only a finished task can be reopened.");
      await writeAudit({ actor, action: "checklist.task_reopen", targetType: "checklist_task", targetId: task.id }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** For a signature task: sends the agreement template to the person (by sign-in if they have an account, else by emailed link and code). */
export async function sendTaskAgreement(input: unknown): Promise<ActionResult<{ envelopeId: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "onboarding.manage");
    if (scopeFor(actor, "onboarding.manage") !== "all") return fail("You do not have access to do that.");
    const parsed = taskIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [task] = await db.select().from(checklistTasks).where(eq(checklistTasks.id, parsed.data.taskId));
    if (!task || task.check !== "signature" || !task.signTemplateId) return fail("That task is not an agreement to send.");
    if (task.envelopeId) return fail("The agreement was already sent.");
    const [e] = await db.select({ userId: employees.userId, email: employees.workEmail, first: employees.legalFirstName, last: employees.legalLastName }).from(employees).where(eq(employees.id, task.employeeId));
    if (!e) return fail("That person was not found.");
    const template = await loadTemplatePdf(task.signTemplateId);
    const ip = await clientIp();
    const created = await createEnvelope(actor, { title: `${template.name}: ${e.first} ${e.last}`, pdf: template.bytes, fileName: template.fileName, templateId: task.signTemplateId, signers: [e.userId ? { userId: e.userId, role: "Signer" } : { external: { name: `${e.first} ${e.last}`, email: e.email }, role: "Signer" }], order: "sequential", expiryDays: 14, send: true, ip: ip === "unknown" ? null : ip });
    await db.transaction(async (tx) => {
      await tx.update(checklistTasks).set({ envelopeId: created.id }).where(eq(checklistTasks.id, task.id));
      await writeAudit({ actor, action: "checklist.agreement_sent", targetType: "checklist_task", targetId: task.id, after: { envelopeId: created.id } }, tx);
    });
    refresh();
    return { ok: true, data: { envelopeId: created.id } };
  });
}

// ---- Onboarding case --------------------------------------------------------------------------------------------------------

/** HR confirms onboarding is done: every required task is closed, and the person moves from onboarding to active. */
export async function completeOnboarding(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "onboarding.manage");
    if (scopeFor(actor, "onboarding.manage") !== "all") return fail("You do not have access to do that.");
    const parsed = caseIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await syncCase("onboarding", parsed.data.caseId);
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(onboardingCases).where(eq(onboardingCases.id, parsed.data.caseId)).for("update");
      if (!c) throw new ActionFailure("That case was not found.");
      if (c.status !== "open") throw new ActionFailure("This onboarding is already closed.");
      const tasks = await tx.select().from(checklistTasks).where(eq(checklistTasks.onboardingCaseId, c.id));
      const [e] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, c.employeeId));
      const ok = await satisfiedTasks(tx, tasks, { employeeId: c.employeeId, userId: e?.userId ?? null, today: todayIn() });
      const p = progress(tasks.map((t) => ({ status: t.status as "todo" | "done" | "skipped", required: t.required, dueOn: t.dueOn, satisfied: ok.has(t.id) })), todayIn());
      if (p.requiredOpen > 0) throw new ActionFailure(`${p.requiredOpen} required ${p.requiredOpen === 1 ? "task is" : "tasks are"} still open.`);
      await tx.update(onboardingCases).set({ status: "completed", completedAt: new Date(), completedBy: actor.id }).where(eq(onboardingCases.id, c.id));
      await changeEmployeeStatus(tx, actor, c.employeeId, "active", { summary: "Onboarding completed" });
      await writeAudit({ actor, action: "onboarding.complete", targetType: "employee", targetId: c.employeeId, after: { caseId: c.id } }, tx);
      if (e?.userId) await notify(tx, { userId: e.userId, kind: "onboarding.completed", title: "Onboarding complete", body: "You are all set. Welcome to the team.", link: "/dashboard" });
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// ---- Offboarding ------------------------------------------------------------------------------------------------------------

export async function startOffboarding(input: unknown): Promise<ActionResult<{ caseId: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offboarding.manage");
    const parsed = startOffboardingSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const today = todayInZone();
    const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    if (v.lastWorkingDay < earliest) return fail("The last working day cannot be more than 7 days ago.");
    try {
      const caseId = await db.transaction(async (tx) => {
        const person = await personContext(tx, v.employeeId);
        const [e] = await tx.select({ status: employees.status, archivedAt: employees.archivedAt }).from(employees).where(eq(employees.id, v.employeeId));
        if (!e || e.archivedAt || e.status === "separated") throw new ActionFailure("That person has already left.");
        const reports = await activeDirectReports(tx, v.employeeId);
        if (reports.length > 0) throw new ActionFailure(`${person.name} still has ${reports.length} active ${reports.length === 1 ? "report" : "reports"}. Reassign them first (People > their profile > Employment).`);
        const { templateId, items } = await itemsFor(tx, "offboarding", person.positionId);
        const [c] = await tx.insert(offboardingCases).values({ employeeId: v.employeeId, lastWorkingDay: v.lastWorkingDay, reason: v.reason, note: v.note ?? null, templateId, createdBy: actor.id }).returning({ id: offboardingCases.id });
        const tasks = await insertTasks(tx, { kind: "offboarding", caseId: c.id, employeeId: v.employeeId, items, anchor: v.lastWorkingDay, leadUserId: person.leadUserId, personUserId: person.userId });
        await announce(tx, { kind: "offboarding", caseId: c.id, person, tasks, hrIds: await hrUserIds() });
        await writeAudit({ actor, action: "offboarding.start", targetType: "employee", targetId: v.employeeId, after: { caseId: c.id, lastWorkingDay: v.lastWorkingDay, reason: v.reason } }, tx);
        return c.id;
      });
      refresh();
      return { ok: true, data: { caseId } };
    } catch (error) {
      if (isUniqueViolation(error)) return fail("There is already an open offboarding for that person.");
      throw error;
    }
  });
}

export async function cancelOffboarding(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offboarding.manage");
    const parsed = caseIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(offboardingCases).where(eq(offboardingCases.id, parsed.data.caseId)).for("update");
      if (!c || c.status !== "open") throw new ActionFailure("Only an open offboarding can be cancelled.");
      if (c.accessRemovedAt || c.steps.person) throw new ActionFailure("Their access was already removed, so this cannot be cancelled.");
      await tx.update(offboardingCases).set({ status: "cancelled" }).where(eq(offboardingCases.id, c.id));
      await writeAudit({ actor, action: "offboarding.cancel", targetType: "employee", targetId: c.employeeId, after: { caseId: c.id } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** HR removes access now instead of waiting for the end of the last working day (the last day becomes today if it was later). */
export async function removeAccessNow(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offboarding.manage");
    const parsed = caseIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [c] = await db.select().from(offboardingCases).where(eq(offboardingCases.id, parsed.data.caseId));
    if (!c || c.status !== "open") return fail("Only an open offboarding can do this.");
    const today = todayInZone();
    if (c.lastWorkingDay > today) await db.update(offboardingCases).set({ lastWorkingDay: today }).where(and(eq(offboardingCases.id, c.id), isNull(offboardingCases.accessRemovedAt)));
    const result = await executeSeparation(c.id, actor);
    refresh();
    return result.done ? { ok: true, data: undefined } : fail(result.reason ?? "Access could not be removed. Try again.");
  });
}

export async function completeOffboarding(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offboarding.manage");
    const parsed = caseIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await syncCase("offboarding", parsed.data.caseId);
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(offboardingCases).where(eq(offboardingCases.id, parsed.data.caseId)).for("update");
      if (!c || c.status !== "open") throw new ActionFailure("Only an open offboarding can be completed.");
      if (!c.accessRemovedAt) throw new ActionFailure("Their access has not been removed yet.");
      const tasks = await tx.select().from(checklistTasks).where(eq(checklistTasks.offboardingCaseId, c.id));
      const open = tasks.filter((t) => t.required && t.status === "todo").length;
      if (open > 0) throw new ActionFailure(`${open} required ${open === 1 ? "task is" : "tasks are"} still open.`);
      await tx.update(offboardingCases).set({ status: "completed", completedAt: new Date(), completedBy: actor.id }).where(eq(offboardingCases.id, c.id));
      await writeAudit({ actor, action: "offboarding.complete", targetType: "employee", targetId: c.employeeId, after: { caseId: c.id } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** The person's own exit interview: private to HR. */
export async function submitExitInterview(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "offboarding.exit_interview", { ownerUserId: actor.id });
    const parsed = exitInterviewSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const [c] = await db.select().from(offboardingCases).where(eq(offboardingCases.id, v.caseId));
    const [e] = c ? await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, c.employeeId)) : [];
    if (!c || !e?.userId || e.userId !== actor.id) return fail("You do not have access to do that."); // only the person it is about
    if (c.status !== "open" || c.accessRemovedAt) return fail("The exit interview is closed.");
    try {
      await db.transaction(async (tx) => {
        await tx.insert(exitInterviews).values({ offboardingCaseId: c.id, employeeId: c.employeeId, reasonForLeaving: v.reasonForLeaving, wentWell: v.wentWell ?? null, toImprove: v.toImprove ?? null, wouldReturn: v.wouldReturn });
        await tx.update(checklistTasks).set({ status: "done", autoCompleted: true, completedAt: new Date() }).where(and(eq(checklistTasks.offboardingCaseId, c.id), eq(checklistTasks.check, "exit_interview"), eq(checklistTasks.status, "todo")));
        await writeAudit({ actor, action: "offboarding.exit_interview", targetType: "employee", targetId: c.employeeId, after: { caseId: c.id } }, tx); // never the answers
        await notify(tx, (await hrUserIds()).map((userId) => ({ userId, kind: "offboarding.exit_interview", title: "An exit interview was submitted", body: "Open the offboarding to read it.", link: `/offboarding/${c.id}` })));
      });
    } catch (error) {
      if (isUniqueViolation(error)) return fail("You already submitted your exit interview.");
      throw error;
    }
    refresh();
    return { ok: true, data: undefined };
  });
}

// ---- Certificate of engagement ----------------------------------------------------------------------------------------------

/** HR issues a certificate of engagement (a PDF with a reference number) for someone leaving or gone. Kept and audited. */
export async function issueCertificate(input: unknown): Promise<ActionResult<{ certificateId: string; reference: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "certificates.issue");
    const parsed = certificateSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const [e] = await db.select({ first: employees.legalFirstName, last: employees.legalLastName, position: employees.position, startDate: employees.startDate, endDate: employees.endDate, status: employees.status }).from(employees).where(eq(employees.id, parsed.data.employeeId));
    if (!e) return fail("That person was not found.");
    const [open] = await db.select({ lastWorkingDay: offboardingCases.lastWorkingDay }).from(offboardingCases).where(and(eq(offboardingCases.employeeId, parsed.data.employeeId), eq(offboardingCases.status, "open")));
    const end = e.endDate ?? open?.lastWorkingDay ?? null;
    if (!end) return fail("Start an offboarding first, so there is a last working day to put on the certificate.");
    const reference = `CE-${new Date().getUTCFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const role = e.position ? ` in the role of ${e.position}` : "";
    const body = `# Certificate of engagement\n\nThis certifies that **${e.first} ${e.last}** was engaged by Elite Resource Services as an independent contractor${role}${e.startDate ? ` from ${formatDateOnly(e.startDate)}` : ""} to ${formatDateOnly(end)}.\n\nThis certificate states the dates and role of the engagement only. It was issued on request.\n\nReference: ${reference}\n\nElite Resource Services`;
    const pdf = await renderOfferPdf({ title: "Certificate of engagement", blocks: parseMarkdown(body), footer: `Reference ${reference}` });
    const path = `certificates/${randomUUID()}.pdf`;
    const storage = getDocumentStorage();
    await storage.write(BUCKETS.signed, path, pdf, "application/pdf");
    try {
      const id = await db.transaction(async (tx) => {
        const [row] = await tx.insert(certificates).values({ employeeId: parsed.data.employeeId, reference, storagePath: path, sha256: sha256Hex(pdf), issuedBy: actor.id }).returning({ id: certificates.id });
        await writeAudit({ actor, action: "certificate.issue", targetType: "employee", targetId: parsed.data.employeeId, after: { reference } }, tx);
        return row.id;
      });
      refresh();
      return { ok: true, data: { certificateId: id, reference } };
    } catch (error) {
      await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
      throw error;
    }
  });
}

/** Runs when a case page opens: closes what ELEVATE can see is done, so the page is current. */
export async function refreshChecklist(input: unknown): Promise<ActionResult<{ closed: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = caseIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await authorize(actor, "onboarding.view", { ownerUserId: actor.id, managerChainUserIds: [actor.id] });
    const [on] = await db.select({ id: onboardingCases.id }).from(onboardingCases).where(eq(onboardingCases.id, parsed.data.caseId));
    const closed = await syncCase(on ? "onboarding" : "offboarding", parsed.data.caseId);
    if (closed) refresh();
    return { ok: true, data: { closed } };
  });
}
