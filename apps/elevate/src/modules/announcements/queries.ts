import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ForbiddenError, authorize, can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents } from "@/modules/documents/schema";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { dueState, type DueState } from "./due";
import { acknowledgments, announcementRecipients, announcementTeams, announcements, policies, policyVersions } from "./schema";
import { ackStatus, pendingAcknowledgments, pendingLink, type StatusRow } from "./service";

// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

type Viewer = Awaited<ReturnType<typeof requireUser>>;

async function myEmployeeId(user: Viewer): Promise<string | null> {
  const [me] = await db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)).limit(1);
  return me?.id ?? null;
}

export type AnnouncementListItem = {
  id: string;
  title: string;
  excerpt: string;
  pinned: boolean;
  requiresAck: boolean;
  dueOn: string | null;
  due: DueState;
  publishedAt: Date;
  audience: "all" | "teams";
  /** Whether the viewer still has to acknowledge it. */
  needsMyAck: boolean;
  acknowledged: boolean;
  /** HR only: how many of the addressed people have acknowledged. */
  progress: { done: number; total: number } | null;
};

const excerptOf = (body: string) => body.replace(/[#*_`>\[\]()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);

/** Announcements the viewer may see: addressed to everyone, to them, or (for HR) all of them. Pinned first, newest first. */
export async function listAnnouncements(opts: { limit?: number } = {}): Promise<AnnouncementListItem[]> {
  const user = await requireUser();
  await authorize(user, "announcements.view");
  const isHr = can(user, "announcements.manage");
  const me = await myEmployeeId(user);
  const today = todayInZone();

  const visible = isHr
    ? sql`true`
    : sql`(${announcements.audience} = 'all' or exists (select 1 from docs.announcement_recipients r where r.announcement_id = ${announcements.id} and r.employee_id = ${me}::uuid))`;

  const rows = await db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      pinned: announcements.pinned,
      requiresAck: announcements.requiresAck,
      dueOn: announcements.dueOn,
      publishedAt: announcements.publishedAt,
      audience: announcements.audience,
      acknowledgedAt: acknowledgments.acknowledgedAt,
      addressedToMe: sql<boolean>`exists (select 1 from docs.announcement_recipients r where r.announcement_id = ${announcements.id} and r.employee_id = ${me}::uuid)`,
      total: sql<number>`(select count(*)::int from docs.announcement_recipients r join core.employees e on e.id = r.employee_id where r.announcement_id = ${announcements.id} and e.archived_at is null and e.status <> 'separated')`,
      done: sql<number>`(select count(*)::int from docs.acknowledgments k where k.announcement_id = ${announcements.id})`,
    })
    .from(announcements)
    .leftJoin(acknowledgments, and(eq(acknowledgments.announcementId, announcements.id), eq(acknowledgments.userId, user.id)))
    .where(and(isNull(announcements.archivedAt), visible))
    .orderBy(desc(announcements.pinned), desc(announcements.publishedAt))
    .limit(Math.min(opts.limit ?? 50, 100));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    excerpt: excerptOf(r.body),
    pinned: r.pinned,
    requiresAck: r.requiresAck,
    dueOn: r.dueOn,
    due: r.requiresAck && !r.acknowledgedAt ? dueState(r.dueOn, today) : "none",
    publishedAt: r.publishedAt,
    audience: r.audience === "teams" ? "teams" : "all",
    needsMyAck: r.requiresAck && r.addressedToMe && !r.acknowledgedAt,
    acknowledged: r.acknowledgedAt !== null,
    progress: isHr && r.requiresAck ? { done: r.done, total: r.total } : null,
  }));
}

export type AnnouncementDetail = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  requiresAck: boolean;
  dueOn: string | null;
  due: DueState;
  publishedAt: Date;
  audience: "all" | "teams";
  teamNames: string[];
  attachment: { id: string; title: string } | null;
  needsMyAck: boolean;
  acknowledgedAt: Date | null;
  canManage: boolean;
  canSeeStatus: boolean;
  canRemind: boolean;
  canExport: boolean;
};

export async function getAnnouncement(id: string): Promise<AnnouncementDetail | null> {
  const user = await requireUser();
  await authorize(user, "announcements.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const isHr = can(user, "announcements.manage");
  const me = await myEmployeeId(user);

  const [a] = await db.select().from(announcements).where(and(eq(announcements.id, id), isNull(announcements.archivedAt))).limit(1);
  if (!a) return null;

  const [addressed] = me
    ? await db.select({ e: announcementRecipients.employeeId }).from(announcementRecipients).where(and(eq(announcementRecipients.announcementId, id), eq(announcementRecipients.employeeId, me))).limit(1)
    : [];
  if (!isHr && a.audience === "teams" && !addressed) return null;

  const [ack] = await db.select({ at: acknowledgments.acknowledgedAt }).from(acknowledgments).where(and(eq(acknowledgments.announcementId, id), eq(acknowledgments.userId, user.id))).limit(1);
  const teamNames = a.audience === "teams"
    ? (await db.select({ name: teams.name }).from(announcementTeams).innerJoin(teams, eq(teams.id, announcementTeams.teamId)).where(eq(announcementTeams.announcementId, id)).orderBy(asc(teams.name))).map((t) => t.name)
    : [];
  const [attachment] = a.attachmentDocumentId
    ? await db.select({ id: documents.id, title: documents.title }).from(documents).where(and(eq(documents.id, a.attachmentDocumentId), isNull(documents.archivedAt))).limit(1)
    : [];

  return {
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    requiresAck: a.requiresAck,
    dueOn: a.dueOn,
    due: a.requiresAck && !ack ? dueState(a.dueOn, todayInZone()) : "none",
    publishedAt: a.publishedAt,
    audience: a.audience === "teams" ? "teams" : "all",
    teamNames,
    attachment: attachment ?? null,
    needsMyAck: a.requiresAck && Boolean(addressed) && !ack,
    acknowledgedAt: ack?.at ?? null,
    canManage: isHr,
    canSeeStatus: scopeFor(user, "announcements.view_status") !== null && a.requiresAck,
    canRemind: can(user, "announcements.remind") && a.requiresAck,
    canExport: can(user, "announcements.export") && a.requiresAck,
  };
}

/** Who has and has not acknowledged. HR sees everyone; a Team Lead sees their own downline. */
export async function getAckStatus(subject: { kind: "announcement" | "policy_version"; id: string }): Promise<{ rows: StatusRow[]; scope: "all" | "team" }> {
  const user = await requireUser();
  const scope = scopeFor(user, "announcements.view_status");
  if (!scope || scope === "own") throw new ForbiddenError("announcements.view_status");
  const restrictTo = scope === "all" ? null : await downlineEmployeeIds(db, user.id);
  return { rows: await ackStatus(db, subject, restrictTo), scope };
}

export type PolicyListItem = {
  id: string;
  title: string;
  kind: "general" | "privacy_notice" | "monitoring";
  /** Latest published version, if any. */
  version: number | null;
  publishedAt: Date | null;
  requiresAck: boolean;
  dueOn: string | null;
  due: DueState;
  needsMyAck: boolean;
  acknowledged: boolean;
  hasDraft: boolean;
};

export async function listPolicies(): Promise<PolicyListItem[]> {
  const user = await requireUser();
  await authorize(user, "announcements.view");
  const isHr = can(user, "announcements.manage");
  const today = todayInZone();

  const rows = await db
    .select({ id: policies.id, title: policies.title, kind: policies.kind })
    .from(policies)
    .where(isNull(policies.archivedAt))
    .orderBy(asc(policies.title));

  const versions = await db.select().from(policyVersions).orderBy(asc(policyVersions.version));
  const mine = await db.select({ versionId: acknowledgments.policyVersionId }).from(acknowledgments).where(and(eq(acknowledgments.userId, user.id), sql`${acknowledgments.policyVersionId} is not null`));
  const ackedVersions = new Set(mine.map((m) => m.versionId));

  const items = rows.map((p): PolicyListItem => {
    const mineVersions = versions.filter((v) => v.policyId === p.id);
    const published = mineVersions.filter((v) => v.status === "published");
    const latest = published[published.length - 1];
    const acknowledged = latest ? ackedVersions.has(latest.id) : false;
    return {
      id: p.id,
      title: p.title,
      kind: p.kind === "privacy_notice" || p.kind === "monitoring" ? p.kind : "general",
      version: latest?.version ?? null,
      publishedAt: latest?.publishedAt ?? null,
      requiresAck: latest?.requiresAck ?? false,
      dueOn: latest?.dueOn ?? null,
      due: latest?.requiresAck && !acknowledged ? dueState(latest.dueOn, today) : "none",
      needsMyAck: Boolean(latest?.requiresAck) && !acknowledged,
      acknowledged,
      hasDraft: isHr && mineVersions.some((v) => v.status === "draft"),
    };
  });
  // People only see policies that have been published; HR also sees the ones still being drafted.
  return items.filter((p) => p.version !== null || isHr);
}

export type PolicyVersionRow = {
  id: string;
  version: number;
  status: "draft" | "published";
  body: string;
  changeNote: string | null;
  requiresAck: boolean;
  dueOn: string | null;
  publishedAt: Date | null;
  /** HR only. */
  acknowledgedCount: number | null;
};

export type PolicyDetail = {
  id: string;
  title: string;
  kind: "general" | "privacy_notice" | "monitoring";
  current: PolicyVersionRow | null;
  draft: PolicyVersionRow | null;
  history: PolicyVersionRow[];
  due: DueState;
  needsMyAck: boolean;
  acknowledgedAt: Date | null;
  canManage: boolean;
  canSeeStatus: boolean;
  canRemind: boolean;
  canExport: boolean;
};

export async function getPolicy(id: string): Promise<PolicyDetail | null> {
  const user = await requireUser();
  await authorize(user, "announcements.view");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const isHr = can(user, "announcements.manage");

  const [p] = await db.select().from(policies).where(and(eq(policies.id, id), isNull(policies.archivedAt))).limit(1);
  if (!p) return null;

  const counts = await db
    .select({ versionId: acknowledgments.policyVersionId, n: sql<number>`count(*)::int` })
    .from(acknowledgments)
    .where(sql`${acknowledgments.policyVersionId} in (select id from docs.policy_versions where policy_id = ${id})`)
    .groupBy(acknowledgments.policyVersionId);
  const countOf = new Map(counts.map((c) => [c.versionId, c.n]));

  const all = await db.select().from(policyVersions).where(eq(policyVersions.policyId, id)).orderBy(desc(policyVersions.version));
  const toRow = (v: (typeof all)[number]): PolicyVersionRow => ({
    id: v.id,
    version: v.version,
    status: v.status === "published" ? "published" : "draft",
    body: v.body,
    changeNote: v.changeNote,
    requiresAck: v.requiresAck,
    dueOn: v.dueOn,
    publishedAt: v.publishedAt,
    acknowledgedCount: isHr ? (countOf.get(v.id) ?? 0) : null,
  });

  const published = all.filter((v) => v.status === "published").map(toRow);
  const current = published[0] ?? null;
  const draft = isHr ? (all.filter((v) => v.status === "draft").map(toRow)[0] ?? null) : null;
  if (!current && !isHr) return null;

  const [ack] = current
    ? await db.select({ at: acknowledgments.acknowledgedAt }).from(acknowledgments).where(and(eq(acknowledgments.policyVersionId, current.id), eq(acknowledgments.userId, user.id))).limit(1)
    : [];
  const needsAck = Boolean(current?.requiresAck) && !ack;

  return {
    id: p.id,
    title: p.title,
    kind: p.kind === "privacy_notice" || p.kind === "monitoring" ? p.kind : "general",
    current,
    draft,
    history: isHr ? published : [],
    due: needsAck ? dueState(current!.dueOn, todayInZone()) : "none",
    needsMyAck: needsAck && Boolean(await myEmployeeId(user)),
    acknowledgedAt: ack?.at ?? null,
    canManage: isHr,
    canSeeStatus: scopeFor(user, "announcements.view_status") !== null && Boolean(current?.requiresAck),
    canRemind: can(user, "announcements.remind") && Boolean(current?.requiresAck),
    canExport: can(user, "announcements.export") && Boolean(current?.requiresAck),
  };
}

export type PendingItem = { kind: "announcement" | "policy"; id: string; versionId: string | null; title: string; version: number | null; dueOn: string | null; due: DueState; link: string };

/** What the signed-in person still has to acknowledge: for the banner and the dashboard. Most urgent first. */
export async function listMyPending(): Promise<PendingItem[]> {
  const user = await requireUser();
  await authorize(user, "announcements.acknowledge", { ownerUserId: user.id });
  const today = todayInZone();
  const rows = await pendingAcknowledgments(db, { userIds: [user.id] });
  return rows.map((r) => ({ kind: r.kind, id: r.id, versionId: r.versionId, title: r.title, version: r.version, dueOn: r.dueOn, due: dueState(r.dueOn, today), link: pendingLink(r) }));
}

/** Teams and company documents HR can pick when posting. */
export async function getComposeOptions() {
  const user = await requireUser();
  await authorize(user, "announcements.manage");
  const teamChoices = await db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.name));
  const documentChoices = await db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.status, "active"), isNull(documents.archivedAt), isNull(documents.employeeId), eq(documents.audience, "all_staff")))
    .orderBy(asc(documents.title))
    .limit(200);
  return { teams: teamChoices, documents: documentChoices };
}

/** For editing an existing announcement. */
export async function getAnnouncementForEdit(id: string) {
  const user = await requireUser();
  await authorize(user, "announcements.manage");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await db.select().from(announcements).where(and(eq(announcements.id, id), isNull(announcements.archivedAt))).limit(1);
  if (!a) return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(acknowledgments).where(eq(acknowledgments.announcementId, id));
  const options = await getComposeOptions();
  return { announcement: a, textLocked: n > 0, documents: options.documents };
}
