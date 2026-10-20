import "server-only";
import { sql } from "drizzle-orm";
import { ForbiddenError, authorize, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportName, timeChainUserIds, timeDownlineEmployeeIds } from "@/modules/org/service";
import { prefsFor } from "./service";

// Technical issue reports. Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

export type IssueEvidence = { id: string; purged: boolean };

export type IssueItem = {
  /** The screenshots sent with the report (open one with openEvidence). */
  evidence: IssueEvidence[];
  id: string;
  kind: string;
  /** ISO time the person says it started. */
  happenedAt: string;
  details: string;
  status: "open" | "handled";
  createdAt: string;
  handledAt: string | null;
  handlingNote: string | null;
  /** Who reported it (the queue only). */
  employeeName: string | null;
  /** May the signed-in person mark it handled. */
  canHandle: boolean;
};

type Row = {
  id: string; employee_id: string; kind: string; happened_at: string | Date; details: string; status: "open" | "handled"; created_at: string | Date;
  handled_at: string | Date | null; handling_note: string | null; user_id: string | null; reported_by: string; first: string; last: string; preferred: string | null;
};

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

async function evidenceOf(ids: string[]): Promise<Map<string, IssueEvidence[]>> {
  const out = new Map<string, IssueEvidence[]>();
  if (ids.length === 0) return out;
  const rows = (await db.execute(sql`select id, issue_id, purged_at from time.correction_evidence where issue_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) order by created_at`)) as unknown as { id: string; issue_id: string; purged_at: Date | null }[];
  for (const r of rows) out.set(r.issue_id, [...(out.get(r.issue_id) ?? []), { id: r.id, purged: r.purged_at !== null }]);
  return out;
}

/** The signed-in person's own reports, newest first, and the zone to show their times in. */
export async function listMyIssues(): Promise<{ items: IssueItem[]; zone: string } | null> {
  const user = await requireUser();
  await authorize(user, "attendance.report_issue", { ownerUserId: user.id });
  const [me] = (await db.execute(sql`select id from core.employees where user_id = ${user.id} limit 1`)) as unknown as { id: string }[];
  if (!me) return null;
  const rows = (await db.execute(sql`
    select r.id, r.employee_id, r.kind, r.happened_at, r.details, r.status, r.created_at, r.handled_at, r.handling_note,
           e.user_id, r.reported_by, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.tech_issue_reports r join core.employees e on e.id = r.employee_id
    where r.employee_id = ${me.id} order by r.created_at desc limit 50`)) as unknown as Row[];
  const evidence = await evidenceOf(rows.map((r) => r.id));
  return {
    zone: (await prefsFor(db, me.id)).zone,
    items: rows.map((r) => ({ evidence: evidence.get(r.id) ?? [], id: r.id, kind: r.kind, happenedAt: iso(r.happened_at)!, details: r.details, status: r.status, createdAt: iso(r.created_at)!, handledAt: iso(r.handled_at), handlingNote: r.handling_note, employeeName: null, canHandle: false })),
  };
}

/** What leads (their people) and HR (everyone) can handle: open reports first, then the recently handled ones. */
export async function listIssueQueue(): Promise<{ items: IssueItem[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "attendance.handle_issue");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("attendance.handle_issue");
  const restrict = scope === "team" ? await timeDownlineEmployeeIds(db, user.id) : null;
  if (restrict && restrict.length === 0) return { items: [], scope };
  const filter = restrict ? sql`and r.employee_id in (${sql.join(restrict.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const rows = (await db.execute(sql`
    select r.id, r.employee_id, r.kind, r.happened_at, r.details, r.status, r.created_at, r.handled_at, r.handling_note,
           e.user_id, r.reported_by, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.tech_issue_reports r join core.employees e on e.id = r.employee_id
    where (r.status = 'open' or r.handled_at > now() - interval '30 days') ${filter}
    order by (r.status = 'open') desc, r.created_at desc limit 100`)) as unknown as Row[];
  const items: IssueItem[] = [];
  const evidence = await evidenceOf(rows.map((r) => r.id));
  for (const r of rows) {
    const own = r.user_id === user.id || r.reported_by === user.id;
    const canHandle = r.status === "open" && !own && (scope === "all" || (await timeChainUserIds(db, r.employee_id)).includes(user.id));
    items.push({
      evidence: evidence.get(r.id) ?? [],
      id: r.id, kind: r.kind, happenedAt: iso(r.happened_at)!, details: r.details, status: r.status, createdAt: iso(r.created_at)!, handledAt: iso(r.handled_at), handlingNote: r.handling_note,
      employeeName: reportName({ first: r.first, last: r.last, preferred: r.preferred }), canHandle,
    });
  }
  return { items, scope };
}
