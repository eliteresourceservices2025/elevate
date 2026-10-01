import "server-only";
import { eq, sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { downlineEmployeeIds, managerChainUserIds, reportName } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { needsHrForAge } from "./extra-hours";
import { assignedClients } from "./extra-hours-service";
import { prefsFor, rulesFor } from "./service";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

export type ExtraEvidence = { id: string; mime: string; purged: boolean };
export type ExtraItem = {
  id: string;
  employeeId: string;
  employeeName: string;
  clientName: string;
  source: "va" | "client";
  status: string;
  windowStart: string;
  windowEnd: string;
  originalWindowStart: string | null;
  originalWindowEnd: string | null;
  minutes: number;
  contactName: string;
  reason: string;
  afterTheFact: boolean;
  confirmedByPhone: boolean;
  /** The person who filed it for the VA (a lead or HR), when the client asked. */
  filedByName: string | null;
  decisionNote: string | null;
  createdAt: string;
  evidence: ExtraEvidence[];
  /** The signed-in person may approve or decline it now. */
  canDecide: boolean;
  /** Only HR can decide: asked for after the fact more than 7 days late. */
  hrOnly: boolean;
  /** The signed-in person (the VA) is being asked to confirm or decline it. */
  needsMyAnswer: boolean;
  canCancel: boolean;
};

type Raw = {
  id: string; employee_id: string; user_id: string | null; first: string; last: string; preferred: string | null; client_name: string; source: "va" | "client"; status: string;
  ws: number; we: number; ows: number | null; owe: number | null; minutes: number; contact_name: string; reason: string; after_the_fact: boolean; confirmed_by_phone: boolean;
  filed_by: string; filer: string | null; decision_note: string | null; created_at: string | Date; window_start_date: Date;
};

const SELECT = sql`
  select r.id, r.employee_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, c.name as client_name, r.source, r.status,
         (extract(epoch from r.window_start) * 1000)::float8 as ws, (extract(epoch from r.window_end) * 1000)::float8 as we,
         (extract(epoch from r.original_window_start) * 1000)::float8 as ows, (extract(epoch from r.original_window_end) * 1000)::float8 as owe,
         r.minutes, r.contact_name, r.reason, r.after_the_fact, r.confirmed_by_phone, r.filed_by, r.decision_note, r.created_at, r.window_start as window_start_date,
         (select f.legal_first_name || ' ' || f.legal_last_name from core.employees f where f.user_id = r.filed_by limit 1) as filer
  from time.extra_hours_requests r join core.employees e on e.id = r.employee_id join core.clients c on c.id = r.client_id`;

async function evidenceByRequest(ids: string[]): Promise<Map<string, ExtraEvidence[]>> {
  const out = new Map<string, ExtraEvidence[]>();
  if (ids.length === 0) return out;
  const rows = (await db.execute(sql`select id, extra_request_id, mime, purged_at from time.correction_evidence where extra_request_id in (${list(ids)}) order by created_at`)) as unknown as { id: string; extra_request_id: string; mime: string; purged_at: Date | null }[];
  for (const r of rows) out.set(r.extra_request_id, [...(out.get(r.extra_request_id) ?? []), { id: r.id, mime: r.mime, purged: r.purged_at !== null }]);
  return out;
}

async function toItems(rows: Raw[], viewerUserId: string, viewerScope: "all" | "team" | null): Promise<ExtraItem[]> {
  const evidence = await evidenceByRequest(rows.map((r) => r.id));
  const now = Date.now();
  const items: ExtraItem[] = [];
  for (const r of rows) {
    const mine = r.user_id === viewerUserId;
    const own = mine || r.filed_by === viewerUserId;
    const hrOnly = r.after_the_fact && needsHrForAge(Number(r.ws), new Date(r.created_at).getTime());
    let allowed = false;
    if (viewerScope === "all") allowed = true;
    else if (viewerScope === "team") allowed = !hrOnly && (await managerChainUserIds(db, r.employee_id)).includes(viewerUserId);
    const waiting = r.status === "pending_lead" || r.status === "pending_confirm";
    items.push({
      id: r.id,
      employeeId: r.employee_id,
      employeeName: mine ? "You" : reportName({ first: r.first, last: r.last, preferred: r.preferred }),
      clientName: r.client_name,
      source: r.source,
      status: r.status,
      windowStart: new Date(Number(r.ws)).toISOString(),
      windowEnd: new Date(Number(r.we)).toISOString(),
      originalWindowStart: r.ows === null ? null : new Date(Number(r.ows)).toISOString(),
      originalWindowEnd: r.owe === null ? null : new Date(Number(r.owe)).toISOString(),
      minutes: Number(r.minutes),
      contactName: r.contact_name,
      reason: r.reason,
      afterTheFact: r.after_the_fact,
      confirmedByPhone: r.confirmed_by_phone,
      filedByName: r.source === "client" ? (r.filer ?? "HR") : null,
      decisionNote: r.decision_note,
      createdAt: new Date(r.created_at).toISOString(),
      evidence: evidence.get(r.id) ?? [],
      canDecide: r.status === "pending_lead" && !own && allowed,
      hrOnly,
      needsMyAnswer: r.status === "pending_confirm" && mine,
      canCancel: (own || allowed) && (waiting || (r.status === "approved" && Number(r.ws) > now)),
    });
  }
  return items;
}

export type MyExtraHours = {
  zone: string;
  clients: { id: string; name: string; zone: string }[];
  items: ExtraItem[];
  limits: { maxExtraMinutesPerDay: number; maxDayMinutes: number };
};

/** The signed-in person's extra hours: the clients they can ask for, their requests, and any waiting for their answer. Null without a people record. */
export async function getMyExtraHours(): Promise<MyExtraHours | null> {
  const user = await requireUser();
  await authorize(user, "extra_hours.request", { ownerUserId: user.id });
  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  if (!me) return null;
  const rows = (await db.execute(sql`${SELECT} where r.employee_id = ${me.id} order by r.window_start desc limit 40`)) as unknown as Raw[];
  const rules = await rulesFor(db, me.id);
  return {
    zone: (await prefsFor(db, me.id)).zone,
    clients: await assignedClients(db, me.id),
    items: await toItems(rows, user.id, null),
    limits: { maxExtraMinutesPerDay: rules.maxExtraMinutesPerDay, maxDayMinutes: rules.maxDayMinutes },
  };
}

/** Requests waiting for the signed-in lead (their team) or HR (everyone), and the last two weeks of decided ones. */
export async function listExtraHoursQueue(): Promise<{ pending: ExtraItem[]; recent: ExtraItem[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "extra_hours.decide");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("extra_hours.decide");
  const restrict = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { pending: [], recent: [], scope };
  const filter = restrict ? sql`and r.employee_id in (${list(restrict)})` : sql``;
  const pending = (await db.execute(sql`${SELECT} where r.status in ('pending_lead', 'pending_confirm') ${filter} order by r.window_start limit 100`)) as unknown as Raw[];
  const recent = (await db.execute(sql`${SELECT} where r.status in ('approved', 'declined', 'cancelled') and r.created_at > now() - interval '14 days' ${filter} order by r.window_start desc limit 100`)) as unknown as Raw[];
  return { pending: await toItems(pending, user.id, scope), recent: await toItems(recent, user.id, scope), scope };
}

/** Active clients, for the form where a lead or HR files extra hours the client asked for. */
export async function listActiveClients(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  const reach = scopeFor(user, "extra_hours.file_for_others");
  if (reach !== "all" && reach !== "team") throw new ForbiddenError("extra_hours.file_for_others");
  return (await db.execute(sql`select id, name from core.clients where archived_at is null and is_active order by name`)) as unknown as { id: string; name: string }[];
}
