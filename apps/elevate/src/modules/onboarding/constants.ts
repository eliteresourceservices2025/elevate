import { fromZonedTime } from "date-fns-tz";

// Pure rules for onboarding and offboarding checklists. No database: used by the actions, the pages and the tests.

export const OWNERS = ["hr", "lead", "person"] as const;
export type Owner = (typeof OWNERS)[number];
export const OWNER_LABELS: Record<Owner, string> = { hr: "HR", lead: "Their lead", person: "The person" };

/** What lets ELEVATE decide a task is done by itself. "manual" tasks are ticked by whoever owns them. */
export const CHECKS = ["manual", "document", "required_documents", "policy", "account", "signature", "exit_interview", "access", "assets_returned"] as const;
export type Check = (typeof CHECKS)[number];
export const CHECK_LABELS: Record<Check, string> = {
  manual: "Ticked by hand",
  document: "A specific document is uploaded",
  required_documents: "All required documents are uploaded",
  policy: "A policy is acknowledged",
  account: "They have an ELEVATE account",
  signature: "An agreement is signed",
  exit_interview: "The exit interview is submitted",
  access: "Their access is removed",
  assets_returned: "All their equipment is returned",
};

export const KINDS = ["onboarding", "offboarding"] as const;
export type Kind = (typeof KINDS)[number];

export const TASK_STATUSES = ["todo", "done", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const LEAVING_REASONS = ["resignation", "end_of_contract", "termination", "other"] as const;
export type LeavingReason = (typeof LEAVING_REASONS)[number];
export const LEAVING_LABELS: Record<LeavingReason, string> = { resignation: "Resignation", end_of_contract: "End of contract", termination: "Termination", other: "Other" };

export type ItemDef = {
  title: string;
  details?: string | null;
  owner: Owner;
  /** Days from the anchor date (the start date for onboarding, the last working day for offboarding). Negative = before. */
  dueOffsetDays: number;
  required: boolean;
  check: Check;
  documentTypeId?: string | null;
  policyId?: string | null;
  /** "privacy_notice" or "monitoring": the published policy of that kind, whatever its id is in this environment. */
  policyKind?: "privacy_notice" | "monitoring" | null;
  signTemplateId?: string | null;
  /** An in-app page the task points to, e.g. the hours export. Always a relative path. */
  href?: string | null;
};

export const DEFAULT_ONBOARDING_ITEMS: ItemDef[] = [
  { title: "Sign the contractor agreement and NDA", details: "HR sends it from Signing, then ticks this when it is signed.", owner: "hr", dueOffsetDays: 0, required: true, check: "manual", href: "/signing" },
  { title: "Acknowledge the privacy notice", owner: "person", dueOffsetDays: 0, required: true, check: "policy", policyKind: "privacy_notice" },
  { title: "Acknowledge the monitoring policy", details: "Needed before the time clock can use screenshots, location or selfies.", owner: "person", dueOffsetDays: 0, required: true, check: "policy", policyKind: "monitoring" },
  { title: "Upload your required documents", details: "Government ID and any clearance HR asks for. Please do not upload client or patient records.", owner: "person", dueOffsetDays: 3, required: true, check: "required_documents", href: "/people/me?tab=documents" },
  { title: "Create your ELEVATE account and set up your sign-in code", owner: "person", dueOffsetDays: 0, required: true, check: "account" },
  { title: "Equipment is ready and issued", details: "Computer, headset and any software access.", owner: "hr", dueOffsetDays: -1, required: true, check: "manual" },
  { title: "Meet your lead and your team", owner: "lead", dueOffsetDays: 3, required: true, check: "manual" },
  { title: "Welcome meeting", owner: "lead", dueOffsetDays: 0, required: false, check: "manual" },
];

export const DEFAULT_OFFBOARDING_ITEMS: ItemDef[] = [
  { title: "Write and hand over turnover notes", details: "What is in progress, where files are, who to ask. Please do not include client or patient information.", owner: "person", dueOffsetDays: -3, required: true, check: "manual" },
  { title: "Exit interview", details: "A short, private form. Optional for the person; HR can skip it.", owner: "person", dueOffsetDays: -2, required: false, check: "exit_interview" },
  { title: "Lead confirms the handover and the clearance", owner: "lead", dueOffsetDays: 0, required: true, check: "manual" },
  { title: "Equipment and assets returned", details: "Ticked by ELEVATE when nothing is still assigned to them. Record each return in Assets.", owner: "hr", dueOffsetDays: 0, required: true, check: "assets_returned", href: "/assets" },
  { title: "Access removed at the end of the last working day", details: "Done automatically (or with Remove access now).", owner: "hr", dueOffsetDays: 0, required: true, check: "access" },
  { title: "Final hours are approved and exported", details: "Approve the last week, then export the pay period.", owner: "hr", dueOffsetDays: 2, required: true, check: "manual", href: "/hours-review" },
  { title: "Certificate of engagement, if they ask for one", owner: "hr", dueOffsetDays: 5, required: false, check: "manual" },
];

/** YYYY-MM-DD plus a number of days (calendar days). */
export function dueOn(anchor: string, offsetDays: number): string {
  return new Date(Date.parse(`${anchor}T00:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export type TaskRow = {
  title: string;
  details: string | null;
  owner: Owner;
  ownerUserId: string | null;
  dueOn: string;
  required: boolean;
  check: Check;
  documentTypeId: string | null;
  policyId: string | null;
  policyKind: string | null;
  signTemplateId: string | null;
  href: string | null;
  position: number;
};

/** The tasks of a case from a template's items: due dates from the anchor, owners resolved (HR tasks belong to every HR admin). */
export function buildTasks(items: ItemDef[], ctx: { anchor: string; leadUserId: string | null; personUserId: string | null }): TaskRow[] {
  return items.map((it, i) => ({
    title: it.title,
    details: it.details ?? null,
    owner: it.owner,
    ownerUserId: it.owner === "lead" ? ctx.leadUserId : it.owner === "person" ? ctx.personUserId : null,
    dueOn: dueOn(ctx.anchor, it.dueOffsetDays),
    required: it.required,
    check: it.check,
    documentTypeId: it.documentTypeId ?? null,
    policyId: it.policyId ?? null,
    policyKind: it.policyKind ?? null,
    signTemplateId: it.signTemplateId ?? null,
    href: it.href && it.href.startsWith("/") && !it.href.startsWith("//") ? it.href : null,
    position: i + 1,
  }));
}

export type TaskLike = { status: TaskStatus; required: boolean; dueOn: string };

/** A task counts as done when it was ticked, skipped, or ELEVATE can see it is satisfied. */
export const isClosed = (status: TaskStatus, satisfied: boolean) => status !== "todo" || satisfied;

export function progress(tasks: (TaskLike & { satisfied?: boolean })[], today: string) {
  const closed = (t: TaskLike & { satisfied?: boolean }) => isClosed(t.status, t.satisfied ?? false);
  const done = tasks.filter(closed).length;
  const requiredOpen = tasks.filter((t) => t.required && !closed(t)).length;
  const overdue = tasks.filter((t) => !closed(t) && t.dueOn < today).length;
  return { total: tasks.length, done, requiredOpen, overdue, ready: requiredOpen === 0 && tasks.length > 0 };
}

/**
 * Whether the last working day has fully ended in the person's zone (so access can be removed): the next day has begun there.
 * The day is the person's own: someone who works US hours from Manila is cut off at the end of their Manila day.
 */
export function separationDue(lastWorkingDay: string, zone: string, now: Date): boolean {
  const next = dueOn(lastWorkingDay, 1);
  return now.getTime() >= fromZonedTime(`${next}T00:00:00`, zone).getTime();
}

export const EXIT_RETURN = ["yes", "maybe", "no"] as const;
