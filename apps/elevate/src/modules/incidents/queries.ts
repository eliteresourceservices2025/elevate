import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo, type PageInfo } from "@/lib/pagination";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { clients } from "@/modules/people/schema";
import { incidentReference, type IncidentStatus } from "./constants";
import { privacyIncidentMessages, privacyIncidents } from "./schema";

export type IncidentRow = {
  id: string;
  reference: string;
  kind: string;
  status: IncidentStatus;
  ongoing: boolean;
  happenedOn: string;
  createdAt: string;
  updatedAt: string;
  /** Handlers only: who filed it and for which client. The reporter's own list has neither. */
  from: string | null;
  client: string | null;
};

const status = (s: string): IncidentStatus => (s === "closed" ? "closed" : s === "in_review" ? "in_review" : "new");

/** The signed-in person's own reports, newest first. */
export async function listMyIncidents(): Promise<IncidentRow[]> {
  const user = await requireUser();
  await authorize(user, "incidents.report", { ownerUserId: user.id });
  const rows = await db.select().from(privacyIncidents).where(eq(privacyIncidents.reporterUserId, user.id)).orderBy(desc(privacyIncidents.createdAt)).limit(100);
  return rows.map((r) => ({
    id: r.id,
    reference: incidentReference(r.id),
    kind: r.kind,
    status: status(r.status),
    ongoing: r.ongoing,
    happenedOn: r.happenedOn,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    from: null,
    client: null,
  }));
}

/** Everyone's reports for the privacy team: open first, ongoing ones before the rest, then newest. One page at a time. */
export async function listIncidentInbox(filter: { status?: IncidentStatus | "open"; page: number; pageSize: number }): Promise<{ rows: IncidentRow[]; info: PageInfo; openCount: number }> {
  const user = await requireUser();
  await authorize(user, "incidents.handle");
  const where =
    filter.status === "open"
      ? sql`${privacyIncidents.status} <> 'closed'`
      : filter.status
        ? eq(privacyIncidents.status, filter.status)
        : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(privacyIncidents).where(where);
  const [{ open }] = await db.select({ open: sql<number>`count(*)::int` }).from(privacyIncidents).where(sql`${privacyIncidents.status} <> 'closed'`);
  const info = pageInfo(total, filter.page, filter.pageSize);
  const rows = await db
    .select({
      r: privacyIncidents,
      client: clients.name,
      name: sql<string | null>`(select trim(e.legal_first_name || ' ' || e.legal_last_name) from core.employees e where e.user_id = ${privacyIncidents.reporterUserId} limit 1)`,
      email: users.email,
    })
    .from(privacyIncidents)
    .innerJoin(users, eq(users.id, privacyIncidents.reporterUserId))
    .leftJoin(clients, eq(clients.id, privacyIncidents.clientId))
    .where(where)
    .orderBy(sql`${privacyIncidents.status} = 'closed'`, desc(privacyIncidents.ongoing), desc(privacyIncidents.createdAt))
    .limit(info.pageSize)
    .offset(info.offset);
  return {
    rows: rows.map((x) => ({
      id: x.r.id,
      reference: incidentReference(x.r.id),
      kind: x.r.kind,
      status: status(x.r.status),
      ongoing: x.r.ongoing,
      happenedOn: x.r.happenedOn,
      createdAt: x.r.createdAt.toISOString(),
      updatedAt: x.r.updatedAt.toISOString(),
      from: x.name ? `${x.name} (${x.email})` : x.email,
      client: x.client ?? null,
    })),
    info,
    openCount: open,
  };
}

export type IncidentDetail = {
  id: string;
  reference: string;
  kind: string;
  status: IncidentStatus;
  ongoing: boolean;
  happenedOn: string;
  createdAt: string;
  howFound: string;
  whatHappened: string;
  whoElseKnows: string | null;
  actionsTaken: string | null;
  client: string | null;
  from: string | null;
  /** Handlers only. */
  resolution: string | null;
  isHandler: boolean;
  isOwner: boolean;
  messages: { id: string; by: "reporter" | "handler"; body: string; at: string; mine: boolean }[];
};

/**
 * One report with its thread, for the reporter or the privacy team; null for anyone else (the same answer as a report that does not
 * exist). A handler opening someone else's report is audited, so reading is accountable.
 */
export async function getIncident(id: string): Promise<IncidentDetail | null> {
  const user = await requireUser();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const isHandler = can(user, "incidents.handle");
  if (!isHandler) await authorize(user, "incidents.report", { ownerUserId: user.id });

  const [row] = await db
    .select({
      r: privacyIncidents,
      client: clients.name,
      name: sql<string | null>`(select trim(e.legal_first_name || ' ' || e.legal_last_name) from core.employees e where e.user_id = ${privacyIncidents.reporterUserId} limit 1)`,
      email: users.email,
    })
    .from(privacyIncidents)
    .innerJoin(users, eq(users.id, privacyIncidents.reporterUserId))
    .leftJoin(clients, eq(clients.id, privacyIncidents.clientId))
    .where(eq(privacyIncidents.id, id))
    .limit(1);
  if (!row) return null;
  const isOwner = row.r.reporterUserId === user.id;
  if (!isOwner && !isHandler) return null;

  const thread = await db.select().from(privacyIncidentMessages).where(eq(privacyIncidentMessages.incidentId, id)).orderBy(asc(privacyIncidentMessages.createdAt));
  if (isHandler && !isOwner) {
    await writeAudit({ actor: user, action: "incident.view", targetType: "privacy_incident", targetId: id });
  }
  return {
    id: row.r.id,
    reference: incidentReference(row.r.id),
    kind: row.r.kind,
    status: status(row.r.status),
    ongoing: row.r.ongoing,
    happenedOn: row.r.happenedOn,
    createdAt: row.r.createdAt.toISOString(),
    howFound: row.r.howFound,
    whatHappened: row.r.whatHappened,
    whoElseKnows: row.r.whoElseKnows,
    actionsTaken: row.r.actionsTaken,
    client: row.client ?? null,
    from: isHandler ? (row.name ? `${row.name} (${row.email})` : row.email) : null,
    resolution: isHandler ? row.r.resolution : null,
    isHandler,
    isOwner,
    messages: thread.map((m) => ({ id: m.id, by: m.authorKind === "handler" ? "handler" : "reporter", body: m.body, at: m.createdAt.toISOString(), mine: m.authorUserId === user.id })),
  };
}

/** Active clients to pick from in the form (name only). Anyone who may report. */
export async function listClientChoices(): Promise<{ id: string; name: string }[]> {
  const user = await requireUser();
  await authorize(user, "incidents.report", { ownerUserId: user.id });
  return db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.isActive, true))).orderBy(asc(clients.name)).limit(200);
}

/** People currently named Privacy Officer (HR and Super Admin, for the designation card). */
export async function listPrivacyOfficers(): Promise<{ id: string; email: string; name: string | null }[]> {
  const user = await requireUser();
  await authorize(user, "incidents.designate");
  return db
    .select({
      id: users.id,
      email: users.email,
      name: sql<string | null>`(select trim(e.legal_first_name || ' ' || e.legal_last_name) from core.employees e where e.user_id = ${users.id} limit 1)`,
    })
    .from(users)
    .where(and(eq(users.isPrivacyOfficer, true), sql`${users.archivedAt} is null`))
    .orderBy(asc(users.email));
}
