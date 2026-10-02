import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { documentTypes } from "@/modules/documents/schema";
import { policies } from "@/modules/announcements/schema";
import { downlineEmployeeIds } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { positions } from "@/modules/org/schema";
import { esignTemplates } from "@/modules/signing/schema";
import { progress, type Kind, type Owner, type TaskStatus } from "./constants";
import { certificates, checklistTasks, checklistTemplateItems, checklistTemplates, exitInterviews, offboardingCases, onboardingCases } from "./schema";
import { satisfiedTasks, todayIn } from "./service";

// Reads for the onboarding and offboarding pages. Each starts with requireUser and works out the scope itself: everyone for HR, the
// downline for a lead, the person's own case for anyone else.

export type CaseRow = {
  id: string;
  employeeId: string;
  name: string;
  position: string | null;
  /** Start date (onboarding) or last working day (offboarding). */
  date: string;
  status: string;
  reason?: string;
  total: number;
  done: number;
  requiredOpen: number;
  overdue: number;
  accessRemoved?: boolean;
};

type Scope = { scope: "all" | "team" | "own"; userId: string; ids: string[] | null };

async function viewScope(action: "onboarding.view" | "offboarding.view"): Promise<Scope> {
  const user = await requireUser();
  const scope = scopeFor(user, action);
  if (!scope) throw new ForbiddenError(action);
  return { scope, userId: user.id, ids: scope === "team" ? await downlineEmployeeIds(db, user.id) : null };
}

const allowed = (s: Scope, e: { id: string; userId: string | null }) => s.scope === "all" || (s.scope === "team" && (s.ids ?? []).includes(e.id)) || (s.scope === "own" && e.userId === s.userId) || (s.scope === "team" && e.userId === s.userId);

async function effective(rows: (typeof checklistTasks.$inferSelect)[], ctx: { employeeId: string; userId: string | null; offboardingCaseId?: string; accessRemoved?: boolean }) {
  return satisfiedTasks(db, rows, { ...ctx, today: todayIn() });
}

async function counts(kind: Kind, caseRows: { id: string; employeeId: string; userId: string | null; accessRemoved?: boolean }[]) {
  if (caseRows.length === 0) return new Map<string, ReturnType<typeof progress>>();
  const col = kind === "onboarding" ? checklistTasks.onboardingCaseId : checklistTasks.offboardingCaseId;
  const tasks = await db.select().from(checklistTasks).where(inArray(col, caseRows.map((c) => c.id)));
  const out = new Map<string, ReturnType<typeof progress>>();
  for (const c of caseRows) {
    const mine = tasks.filter((t) => (kind === "onboarding" ? t.onboardingCaseId : t.offboardingCaseId) === c.id);
    const ok = await effective(mine, { employeeId: c.employeeId, userId: c.userId, offboardingCaseId: kind === "offboarding" ? c.id : undefined, accessRemoved: c.accessRemoved });
    out.set(c.id, progress(mine.map((t) => ({ status: t.status as TaskStatus, required: t.required, dueOn: t.dueOn, satisfied: ok.has(t.id) })), todayIn()));
  }
  return out;
}

export async function listOnboardingCases(): Promise<CaseRow[]> {
  const s = await viewScope("onboarding.view");
  const rows = await db
    .select({ id: onboardingCases.id, status: onboardingCases.status, startDate: onboardingCases.startDate, employeeId: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position })
    .from(onboardingCases)
    .innerJoin(employees, eq(employees.id, onboardingCases.employeeId))
    .orderBy(desc(onboardingCases.startDate));
  const mine = rows.filter((r) => allowed(s, { id: r.employeeId, userId: r.userId }));
  const p = await counts("onboarding", mine.map((r) => ({ id: r.id, employeeId: r.employeeId, userId: r.userId })));
  return mine.map((r) => ({ id: r.id, employeeId: r.employeeId, name: `${r.first} ${r.last}`, position: r.position, date: r.startDate ?? "", status: r.status, ...(p.get(r.id) as ReturnType<typeof progress>) }));
}

export async function listOffboardingCases(): Promise<CaseRow[]> {
  const s = await viewScope("offboarding.view");
  const rows = await db
    .select({ id: offboardingCases.id, status: offboardingCases.status, lastWorkingDay: offboardingCases.lastWorkingDay, reason: offboardingCases.reason, accessRemovedAt: offboardingCases.accessRemovedAt, employeeId: employees.id, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position })
    .from(offboardingCases)
    .innerJoin(employees, eq(employees.id, offboardingCases.employeeId))
    .orderBy(desc(offboardingCases.lastWorkingDay));
  const mine = rows.filter((r) => allowed(s, { id: r.employeeId, userId: r.userId }));
  const p = await counts("offboarding", mine.map((r) => ({ id: r.id, employeeId: r.employeeId, userId: r.userId, accessRemoved: Boolean(r.accessRemovedAt) })));
  return mine.map((r) => ({ id: r.id, employeeId: r.employeeId, name: `${r.first} ${r.last}`, position: r.position, date: r.lastWorkingDay, status: r.status, reason: r.reason, accessRemoved: Boolean(r.accessRemovedAt), ...(p.get(r.id) as ReturnType<typeof progress>) }));
}

export type TaskView = {
  id: string;
  title: string;
  details: string | null;
  owner: Owner;
  dueOn: string;
  required: boolean;
  check: string;
  /** Stored status, or "done" when ELEVATE can see it is already satisfied. */
  status: TaskStatus;
  auto: boolean;
  note: string | null;
  href: string | null;
  canAct: boolean;
  canSendAgreement: boolean;
  overdue: boolean;
};

export type CaseDetail = {
  kind: Kind;
  id: string;
  employeeId: string;
  name: string;
  position: string | null;
  date: string;
  status: string;
  reason: string | null;
  note: string | null;
  hiredWithoutOfferReason: string | null;
  accessRemovedAt: Date | null;
  steps: { person?: boolean; account?: boolean };
  isPerson: boolean;
  canManage: boolean;
  tasks: TaskView[];
  progress: ReturnType<typeof progress>;
  exitInterview: { reasonForLeaving: string; wentWell: string | null; toImprove: string | null; wouldReturn: string; submittedAt: Date } | null;
  exitSubmitted: boolean;
  certificates: { id: string; reference: string; issuedAt: Date }[];
};

async function detail(kind: Kind, id: string): Promise<CaseDetail> {
  const user = await requireUser();
  const action = kind === "onboarding" ? "onboarding.view" : "offboarding.view";
  const manageAction = kind === "onboarding" ? "onboarding.manage" : "offboarding.manage";
  const scope = scopeFor(user, action);
  if (!scope) throw new ForbiddenError(action);
  const [c] =
    kind === "onboarding"
      ? await db.select().from(onboardingCases).where(eq(onboardingCases.id, id))
      : await db.select().from(offboardingCases).where(eq(offboardingCases.id, id));
  if (!c) throw new ForbiddenError(action); // shown as not found
  const [e] = await db.select().from(employees).where(eq(employees.id, c.employeeId));
  if (!e) throw new ForbiddenError(action);
  const ids = scope === "team" ? await downlineEmployeeIds(db, user.id) : [];
  const s: Scope = { scope, userId: user.id, ids };
  if (!allowed(s, { id: e.id, userId: e.userId })) throw new ForbiddenError(action);

  const manage = scopeFor(user, manageAction);
  const isHr = manage === "all";
  const inDownline = ids.includes(e.id);
  const off = kind === "offboarding" ? (c as typeof offboardingCases.$inferSelect) : null;
  const on = kind === "onboarding" ? (c as typeof onboardingCases.$inferSelect) : null;
  const col = kind === "onboarding" ? checklistTasks.onboardingCaseId : checklistTasks.offboardingCaseId;
  const rows = await db.select().from(checklistTasks).where(eq(col, id)).orderBy(asc(checklistTasks.dueOn), asc(checklistTasks.createdAt));
  const ok = await effective(rows, { employeeId: e.id, userId: e.userId, offboardingCaseId: off ? id : undefined, accessRemoved: Boolean(off?.accessRemovedAt) });
  const today = todayIn();
  const open = c.status === "open";
  const tasks: TaskView[] = rows.map((t) => {
    const satisfied = ok.has(t.id);
    const status = (satisfied ? "done" : t.status) as TaskStatus;
    const mayAct = isHr || (t.owner === "person" && e.userId === user.id) || (t.owner === "lead" && (t.ownerUserId === user.id || inDownline));
    return {
      id: t.id,
      title: t.title,
      details: t.details,
      owner: t.owner as Owner,
      dueOn: t.dueOn,
      required: t.required,
      check: t.check,
      status,
      auto: satisfied || t.autoCompleted,
      note: t.note,
      href: t.href,
      canAct: open && t.status === "todo" && !satisfied && mayAct && t.check === "manual",
      canSendAgreement: open && isHr && t.check === "signature" && !t.envelopeId && t.status === "todo",
      overdue: status === "todo" && t.dueOn < today,
    };
  });

  let exit: CaseDetail["exitInterview"] = null;
  let exitSubmitted = false;
  let certs: CaseDetail["certificates"] = [];
  if (off) {
    const [x] = await db.select().from(exitInterviews).where(eq(exitInterviews.offboardingCaseId, id));
    exitSubmitted = Boolean(x);
    // The answers are private to HR: the person who wrote them and their lead only learn that it was submitted.
    if (x && isHr) exit = { reasonForLeaving: x.reasonForLeaving, wentWell: x.wentWell, toImprove: x.toImprove, wouldReturn: x.wouldReturn, submittedAt: x.submittedAt };
    if (scopeFor(user, "certificates.issue") === "all") certs = await db.select({ id: certificates.id, reference: certificates.reference, issuedAt: certificates.issuedAt }).from(certificates).where(eq(certificates.employeeId, e.id)).orderBy(desc(certificates.issuedAt));
  }
  return {
    kind,
    id,
    employeeId: e.id,
    name: `${e.legalFirstName} ${e.legalLastName}`,
    position: e.position,
    date: (on ? on.startDate : (off as typeof offboardingCases.$inferSelect).lastWorkingDay) ?? "",
    status: c.status,
    reason: off?.reason ?? null,
    note: off?.note ?? null,
    hiredWithoutOfferReason: on?.hiredWithoutOfferReason ?? null,
    accessRemovedAt: off?.accessRemovedAt ?? null,
    steps: off?.steps ?? {},
    isPerson: e.userId === user.id,
    canManage: isHr,
    tasks,
    progress: progress(tasks.map((t) => ({ status: t.status, required: t.required, dueOn: t.dueOn })), today),
    exitInterview: exit,
    exitSubmitted,
    certificates: certs,
  };
}

export const getOnboardingCase = (id: string) => detail("onboarding", id);
export const getOffboardingCase = (id: string) => detail("offboarding", id);

export type MyTask = { id: string; caseId: string; kind: Kind; title: string; details: string | null; dueOn: string; required: boolean; check: string; href: string | null; overdue: boolean };

/** The signed-in person's own open tasks across their onboarding and offboarding, and the lead tasks that are theirs. */
export async function listMyTasks(): Promise<MyTask[]> {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(checklistTasks)
    .where(and(eq(checklistTasks.ownerUserId, user.id), eq(checklistTasks.status, "todo")))
    .orderBy(asc(checklistTasks.dueOn));
  const today = todayIn();
  const out: MyTask[] = [];
  for (const t of rows) {
    const kind: Kind = t.onboardingCaseId ? "onboarding" : "offboarding";
    const caseId = (t.onboardingCaseId ?? t.offboardingCaseId) as string;
    const [c] = kind === "onboarding" ? await db.select({ status: onboardingCases.status }).from(onboardingCases).where(eq(onboardingCases.id, caseId)) : await db.select({ status: offboardingCases.status }).from(offboardingCases).where(eq(offboardingCases.id, caseId));
    if (c?.status !== "open") continue;
    out.push({ id: t.id, caseId, kind, title: t.title, details: t.details, dueOn: t.dueOn, required: t.required, check: t.check, href: t.href, overdue: t.dueOn < today });
  }
  return out;
}

// ---- Templates (HR) ---------------------------------------------------------------------------------------------------------

export type TemplateView = {
  id: string;
  kind: Kind;
  name: string;
  positionId: string | null;
  positionTitle: string | null;
  items: { title: string; details: string | null; owner: Owner; dueOffsetDays: number; required: boolean; check: string; documentTypeId: string | null; policyId: string | null; policyKind: string | null; signTemplateId: string | null; href: string | null }[];
};

export async function getTemplates() {
  const user = await requireUser();
  if (scopeFor(user, "onboarding.manage_templates") !== "all") throw new ForbiddenError("onboarding.manage_templates");
  const templates = await db.select().from(checklistTemplates).where(isNull(checklistTemplates.archivedAt)).orderBy(asc(checklistTemplates.kind), asc(checklistTemplates.name));
  const items = templates.length ? await db.select().from(checklistTemplateItems).where(inArray(checklistTemplateItems.templateId, templates.map((t) => t.id))).orderBy(asc(checklistTemplateItems.position)) : [];
  const pos = await db.select({ id: positions.id, title: positions.title }).from(positions).where(isNull(positions.archivedAt)).orderBy(asc(positions.title));
  const posTitle = new Map(pos.map((p) => [p.id, p.title]));
  const docTypes = await db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes).where(and(eq(documentTypes.scope, "employee"), isNull(documentTypes.archivedAt))).orderBy(asc(documentTypes.name));
  const signTemplates = await db.select({ id: esignTemplates.id, name: esignTemplates.name }).from(esignTemplates).where(isNull(esignTemplates.archivedAt)).orderBy(asc(esignTemplates.name));
  const policyOptions = await db.select({ id: policies.id, title: policies.title }).from(policies).where(isNull(policies.archivedAt)).orderBy(asc(policies.title));
  const views: TemplateView[] = templates.map((t) => ({
    id: t.id,
    kind: t.kind as Kind,
    name: t.name,
    positionId: t.positionId,
    positionTitle: t.positionId ? (posTitle.get(t.positionId) ?? null) : null,
    items: items.filter((i) => i.templateId === t.id).map((i) => ({ title: i.title, details: i.details, owner: i.owner as Owner, dueOffsetDays: i.dueOffsetDays, required: i.required, check: i.check, documentTypeId: i.documentTypeId, policyId: i.policyId, policyKind: i.policyKind, signTemplateId: i.signTemplateId, href: i.href })),
  }));
  return { templates: views, positions: pos, documentTypes: docTypes, signTemplates, policies: policyOptions };
}

/** People HR can start an offboarding for: current people with no open case. */
export async function listOffboardingCandidates() {
  const user = await requireUser();
  if (scopeFor(user, "offboarding.manage") !== "all") throw new ForbiddenError("offboarding.manage");
  const open = await db.select({ employeeId: offboardingCases.employeeId }).from(offboardingCases).where(eq(offboardingCases.status, "open"));
  const busy = new Set(open.map((o) => o.employeeId));
  const rows = await db
    .select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position, status: employees.status })
    .from(employees)
    .where(and(isNull(employees.archivedAt)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  return rows.filter((r) => r.status !== "separated" && !busy.has(r.id)).map((r) => ({ id: r.id, name: `${r.last}, ${r.first}`, position: r.position }));
}
