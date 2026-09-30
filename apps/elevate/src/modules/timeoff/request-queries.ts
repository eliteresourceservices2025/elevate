import "server-only";
import { eq, sql } from "drizzle-orm";
import { authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { downlineEmployeeIds, managerChainUserIds, reportName, todayInZone } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import type { RequestStatus } from "./schema";
import { peerEmployeeIds } from "./request-service";
import { holidayCalendarsFor } from "./service";
import { eachDate } from "./workdays";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

type Row = Record<string, unknown>;
const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export type ApprovalStep = { level: "lead" | "hr"; decision: "approved" | "declined" | "escalated"; note: string | null; at: string; by: "You" | "Lead" | "HR" | "System" };

export type RequestItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  note: string | null;
  status: RequestStatus;
  createdAt: string;
  cancelReason: string | null;
  steps: ApprovalStep[];
  /** Whether the signed-in person can approve or decline it right now. */
  canDecide: boolean;
  /** Whether the signed-in person can cancel it. */
  canCancel: boolean;
};

async function stepsFor(requestIds: string[], viewerId: string): Promise<Map<string, ApprovalStep[]>> {
  const out = new Map<string, ApprovalStep[]>();
  if (requestIds.length === 0) return out;
  const rows = (await db.execute(sql`
    select request_id, level, decision, note, decided_at, decided_by from time.leave_approvals
    where request_id in (${list(requestIds)}) order by decided_at, id`)) as unknown as Row[];
  for (const r of rows) {
    const by = r.decided_by === null ? "System" : r.decided_by === viewerId ? "You" : r.level === "lead" ? "Lead" : "HR";
    const step: ApprovalStep = { level: r.level as "lead" | "hr", decision: r.decision as ApprovalStep["decision"], note: (r.note as string | null) ?? null, at: new Date(r.decided_at as string | Date).toISOString(), by };
    out.set(String(r.request_id), [...(out.get(String(r.request_id)) ?? []), step]);
  }
  return out;
}

const SELECT = sql`
  select r.id, r.employee_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred,
         e.employee_number, t.name as type_name, r.start_date::text as start_date, r.end_date::text as end_date, r.half_day,
         r.days::float8 as days, r.note, r.status, r.filed_by, r.created_at, r.cancel_reason
  from time.leave_requests r
  join core.employees e on e.id = r.employee_id
  join time.leave_types t on t.id = r.leave_type_id`;

async function toItems(rows: Row[], viewer: Awaited<ReturnType<typeof requireUser>>, decidable: (row: Row) => Promise<boolean>): Promise<RequestItem[]> {
  const steps = await stepsFor(rows.map((r) => String(r.id)), viewer.id);
  const today = todayInZone();
  const isHr = scopeFor(viewer, "timeoff.cancel") === "all";
  const items: RequestItem[] = [];
  for (const r of rows) {
    const status = r.status as RequestStatus;
    const own = r.user_id === viewer.id;
    const live = status === "pending_lead" || status === "pending_hr" || status === "approved";
    items.push({
      id: String(r.id),
      employeeId: String(r.employee_id),
      employeeName: reportName({ first: String(r.first), last: String(r.last), preferred: (r.preferred as string | null) ?? null }),
      employeeNumber: String(r.employee_number),
      leaveTypeName: String(r.type_name),
      startDate: String(r.start_date),
      endDate: String(r.end_date),
      halfDay: Boolean(r.half_day),
      days: Number(r.days),
      note: (r.note as string | null) ?? null,
      status,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
      cancelReason: (r.cancel_reason as string | null) ?? null,
      steps: steps.get(String(r.id)) ?? [],
      canDecide: (status === "pending_lead" || status === "pending_hr") && !own && r.filed_by !== viewer.id && (await decidable(r)),
      canCancel: live && (isHr || (own && (status !== "approved" || String(r.start_date) > today))),
    });
  }
  return items;
}

/** The signed-in person's own requests, newest first. */
export async function listMyRequests(): Promise<RequestItem[]> {
  const user = await requireUser();
  await authorize(user, "timeoff.request", { ownerUserId: user.id });
  const rows = (await db.execute(sql`${SELECT} where e.user_id = ${user.id} order by r.created_at desc limit 100`)) as unknown as Row[];
  return toItems(rows, user, async () => false);
}

/**
 * Requests waiting on someone. A Team Lead sees their downline's (and can decide the lead step); HR sees all
 * pending ones (and can decide the HR step). Each carries whether the viewer may act on it now.
 */
export async function listApprovalQueue(): Promise<{ items: RequestItem[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const approve = scopeFor(user, "timeoff.approve");
  if (approve !== "all" && approve !== "team") await authorize(user, "timeoff.approve"); // throws
  const scope = approve === "all" ? "all" : "team";

  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { items: [], scope };
  const filter = restrict ? sql`and r.employee_id in (${list(restrict)})` : sql``;
  const rows = (await db.execute(sql`${SELECT} where r.status in ('pending_lead', 'pending_hr') ${filter} order by r.step_started_on, r.created_at limit 200`)) as unknown as Row[];

  const canFinal = scopeFor(user, "timeoff.approve_final") === "all";
  const items = await toItems(rows, user, async (r) => {
    if (r.status === "pending_hr") return canFinal;
    // Lead step: the viewer must be above the person in the chain.
    return (await managerChainUserIds(db, String(r.employee_id))).includes(user.id);
  });
  return { items, scope };
}

/** One person's requests, for HR or their lead (used by the person's time off page). */
export async function listRequestsFor(employeeId: string): Promise<RequestItem[]> {
  const user = await requireUser();
  const [e] = await db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!e) return [];
  await authorize(user, "timeoff.view_requests", { ownerUserId: e.userId ?? undefined, managerChainUserIds: await managerChainUserIds(db, employeeId) });
  const rows = (await db.execute(sql`${SELECT} where r.employee_id = ${employeeId} order by r.created_at desc limit 100`)) as unknown as Row[];
  return toItems(rows, user, async () => false);
}

// --- Team calendar -------------------------------------------------------------------------------

export type CalendarMode = "all" | "team" | "peers" | "counts";
export type CalendarEntry = { employeeId: string; name: string; /** Null when the viewer may not see the type. */ leaveType: string | null; startDate: string; endDate: string; days: number; pending: boolean };
export type CalendarView = {
  month: string;
  mode: CalendarMode;
  dates: string[];
  entries: CalendarEntry[];
  /** Counts mode only: people off per date. */
  counts: Record<string, number>;
  holidays: { date: string; name: string; calendar: string }[];
};

/**
 * A month of who is off. HR sees everyone with the leave type; a Team Lead their downline (and themselves) with the
 * type; an Executive only counts per day; everyone else their own team, by name, without the leave type of others.
 */
export async function getTeamCalendar(month: string): Promise<CalendarView> {
  const user = await requireUser();
  await authorize(user, "timeoff.view_calendar");
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : todayInZone().slice(0, 7);
  const first = `${ym}-01`;
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const last = `${ym}-${String(lastDay).padStart(2, "0")}`;

  const view = scopeFor(user, "timeoff.view_requests");
  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  let mode: CalendarMode;
  let visible: string[] | null; // employee ids; null = everyone
  if (view === "all") {
    mode = "all";
    visible = null;
  } else if (view === "team") {
    mode = "team";
    visible = [...(await downlineEmployeeIds(db, user.id)), ...(me ? [me.id] : [])];
  } else if (user.roles.includes("executive")) {
    mode = "counts";
    visible = null;
  } else {
    mode = "peers";
    visible = me ? [...(await peerEmployeeIds(db, me.id)), me.id] : [];
  }

  const live = mode === "all" || mode === "team" ? sql`r.status in ('approved', 'pending_lead', 'pending_hr')` : sql`r.status = 'approved'`;
  const scope = visible ? (visible.length ? sql`and r.employee_id in (${list(visible)})` : sql`and false`) : sql``;
  const rows = (await db.execute(sql`${SELECT}
    where ${live} ${scope} and r.start_date <= ${last}::date and r.end_date >= ${first}::date
    order by r.start_date, e.legal_last_name limit 500`)) as unknown as Row[];

  const dates = eachDate(first, last);
  const counts = new Map<string, number>();
  const entries: CalendarEntry[] = [];
  for (const r of rows) {
    const start = String(r.start_date);
    const end = String(r.end_date);
    if (mode === "counts") {
      for (const d of eachDate(start < first ? first : start, end > last ? last : end)) counts.set(d, (counts.get(d) ?? 0) + 1);
      continue;
    }
    const own = r.user_id === user.id;
    entries.push({
      employeeId: String(r.employee_id),
      name: reportName({ first: String(r.first), last: String(r.last), preferred: (r.preferred as string | null) ?? null }),
      leaveType: mode === "all" || mode === "team" || own ? String(r.type_name) : null,
      startDate: start,
      endDate: end,
      days: Number(r.days),
      pending: r.status !== "approved",
    });
  }

  // Holidays: HR sees both calendars; everyone else the Philippines and their clients'.
  const cals = mode === "all" || !me ? ["PH", "US"] : await holidayCalendarsFor(db, me.id);
  const holidays = (await db.execute(sql`
    select date::text as date, name, calendar from time.holidays
    where archived_at is null and date between ${first}::date and ${last}::date and calendar in (${list(cals)}) order by date, calendar`)) as unknown as { date: string; name: string; calendar: string }[];

  return { month: ym, mode, dates, entries, counts: Object.fromEntries(counts), holidays };
}

/** Leave types a request can use. */
export async function listRequestTypes(): Promise<{ id: string; name: string; tracksBalance: boolean }[]> {
  const user = await requireUser();
  await authorize(user, "timeoff.request", { ownerUserId: user.id });
  return (await db.execute(sql`select id, name, tracks_balance from time.leave_types where archived_at is null order by tracks_balance desc, name`)).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    tracksBalance: Boolean(r.tracks_balance),
  }));
}
