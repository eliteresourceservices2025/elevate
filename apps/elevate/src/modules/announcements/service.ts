import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { reportName } from "@/modules/org/service";
import { notify, type NewNotification } from "@/modules/notifications/service";
import { buildAckEmail } from "@/modules/notifications/email-content";
import { queueEmails } from "@/modules/notifications/email-queue";
import { daysUntil, describeDue } from "./due";
import { acknowledgmentReminders } from "./schema";

// Server-only helpers. Not server actions, so they may take the acting user or a transaction.
// Callers authorize first (CLAUDE.md rule 4).

type Executor = Pick<typeof db, "execute" | "insert" | "select">;

export type PendingAck = {
  userId: string;
  kind: "announcement" | "policy";
  /** Announcement id, or policy id (the page that shows the current version). */
  id: string;
  /** The policy version to acknowledge; null for announcements. */
  versionId: string | null;
  title: string;
  version: number | null;
  dueOn: string | null;
};

const ACTIVE_PERSON = sql`e.user_id is not null and e.archived_at is null and e.status <> 'separated'`;

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * Everything still waiting for someone's acknowledgment: announcements addressed to them that require it,
 * and the latest published version of every policy that requires it (so people hired later are included).
 * Filter to some accounts with `userIds`. Nothing is returned for people without a sign-in account.
 */
export async function pendingAcknowledgments(executor: Executor, opts: { userIds?: string[] } = {}): Promise<PendingAck[]> {
  if (opts.userIds && opts.userIds.length === 0) return [];
  const filter = opts.userIds ? sql`and e.user_id in (${idList(opts.userIds)})` : sql``;
  const rows = (await executor.execute(sql`
    select e.user_id, 'announcement' as kind, a.id as id, null::uuid as version_id, a.title as title,
           null::int as version, a.due_on::text as due_on
    from docs.announcements a
    join docs.announcement_recipients r on r.announcement_id = a.id
    join core.employees e on e.id = r.employee_id
    where a.requires_ack and a.archived_at is null and ${ACTIVE_PERSON} ${filter}
      and not exists (select 1 from docs.acknowledgments k where k.user_id = e.user_id and k.announcement_id = a.id)
    union all
    select e.user_id, 'policy', p.id, pv.id, p.title, pv.version, pv.due_on::text
    from docs.policy_versions pv
    join docs.policies p on p.id = pv.policy_id
    cross join core.employees e
    where pv.status = 'published' and pv.requires_ack and p.archived_at is null and ${ACTIVE_PERSON} ${filter}
      and pv.version = (select max(v2.version) from docs.policy_versions v2 where v2.policy_id = p.id and v2.status = 'published')
      and not exists (select 1 from docs.acknowledgments k where k.user_id = e.user_id and k.policy_version_id = pv.id)
    order by due_on asc nulls last, title asc`)) as unknown as {
    user_id: string; kind: "announcement" | "policy"; id: string; version_id: string | null; title: string; version: number | null; due_on: string | null;
  }[];
  return rows.map((r) => ({ userId: r.user_id, kind: r.kind, id: r.id, versionId: r.version_id, title: r.title, version: r.version, dueOn: r.due_on }));
}

export const pendingLink = (p: Pick<PendingAck, "kind" | "id">) => (p.kind === "announcement" ? `/announcements/${p.id}` : `/announcements/policies/${p.id}`);

/** Everyone who should have an in-app notice for something addressed to the whole company: active people with accounts. */
export async function activeUserIds(executor: Executor): Promise<string[]> {
  const rows = (await executor.execute(sql`select distinct e.user_id from core.employees e where ${ACTIVE_PERSON}`)) as unknown as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

/** Active people the post is addressed to. `teamIds` null = everyone. */
export async function audienceEmployees(executor: Executor, teamIds: string[] | null): Promise<{ id: string; userId: string | null }[]> {
  const team = teamIds ? sql`and e.team_id in (${idList(teamIds)})` : sql``;
  if (teamIds && teamIds.length === 0) return [];
  const rows = (await executor.execute(sql`
    select e.id, e.user_id from core.employees e where e.archived_at is null and e.status <> 'separated' ${team}`)) as unknown as { id: string; user_id: string | null }[];
  return rows.map((r) => ({ id: r.id, userId: r.user_id }));
}

/**
 * Queues one "acknowledgment needed" email per person (counts only, at most one a day).
 * Sent first in the queue; the sender enforces the daily budget.
 */
export async function queueAckEmails(executor: Executor, userIds: string[], day: string, today = day): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const pending = await pendingAcknowledgments(executor, { userIds: unique });
  const perUser = new Map<string, { pending: number; overdue: number }>();
  for (const p of pending) {
    const c = perUser.get(p.userId) ?? { pending: 0, overdue: 0 };
    c.pending += 1;
    if (p.dueOn && daysUntil(p.dueOn, today) < 0) c.overdue += 1;
    perUser.set(p.userId, c);
  }
  const items = [...perUser].map(([userId, c]) => {
    const mail = buildAckEmail(c.pending, c.overdue);
    return { userId, kind: "ack_due" as const, subject: mail.subject, heading: mail.heading, lines: mail.lines, link: "/announcements", dedupeKey: `ack:${day}` };
  });
  return queueEmails(executor, items);
}

/** For policies, id is the policy version id. */
export type ReminderSubject = { kind: "announcement" | "policy_version"; id: string };

/**
 * Notifies everyone still pending for one item and records the claim (one scheduled and one manual
 * reminder per item per day). Returns the people notified, or null if today's reminder of this kind
 * was already sent. Runs inside the caller's transaction.
 */
export async function remindPending(
  tx: Executor,
  subject: ReminderSubject,
  pending: PendingAck[],
  today: string,
  kind: "scheduled" | "manual",
  sentBy: string | null,
): Promise<string[] | null> {
  const claimed = await tx
    .insert(acknowledgmentReminders)
    .values({
      announcementId: subject.kind === "announcement" ? subject.id : null,
      policyVersionId: subject.kind === "policy_version" ? subject.id : null,
      reminderDate: today,
      kind,
      sentBy,
      recipients: pending.length,
    })
    .onConflictDoNothing()
    .returning({ id: acknowledgmentReminders.id });
  if (claimed.length === 0) return null;

  const notices: NewNotification[] = pending.map((p) => ({
    userId: p.userId,
    kind: p.kind === "announcement" ? "announcement.ack_reminder" : "policy.ack_reminder",
    title: `Reminder: acknowledge "${p.title}"`,
    body: describeDue(p.dueOn, today),
    link: pendingLink(p),
  }));
  await notify(tx, notices);
  return pending.map((p) => p.userId);
}

export type StatusRow = {
  employeeId: string;
  employeeNumber: string;
  name: string;
  team: string | null;
  hasAccount: boolean;
  acknowledgedAt: Date | null;
};

/**
 * Who was expected to acknowledge an item and who did. For an announcement: the people it was addressed to.
 * For a policy version: every active person. `restrictTo` limits it to some employee ids (a Team Lead's downline).
 * Not yet acknowledged come first.
 */
export async function ackStatus(executor: Executor, subject: ReminderSubject, restrictTo: string[] | null): Promise<StatusRow[]> {
  if (restrictTo && restrictTo.length === 0) return [];
  const restrict = restrictTo ? sql`and e.id in (${idList(restrictTo)})` : sql``;
  const from =
    subject.kind === "announcement"
      ? sql`from docs.announcement_recipients r
            join core.employees e on e.id = r.employee_id
            left join docs.acknowledgments k on k.announcement_id = r.announcement_id and k.user_id = e.user_id`
      : sql`from core.employees e
            left join docs.acknowledgments k on k.policy_version_id = ${subject.id} and k.user_id = e.user_id`;
  const scope = subject.kind === "announcement" ? sql`r.announcement_id = ${subject.id}` : sql`true`;
  const rows = (await executor.execute(sql`
    select e.id, e.employee_number, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred,
           t.name as team, e.user_id is not null as has_account, k.acknowledged_at
    ${from}
    left join core.teams t on t.id = e.team_id
    where ${scope} and e.archived_at is null and e.status <> 'separated' ${restrict}
    order by (k.acknowledged_at is null) desc, e.legal_last_name, e.legal_first_name`)) as unknown as {
    id: string; employee_number: string; first: string; last: string; preferred: string | null; team: string | null; has_account: boolean; acknowledged_at: Date | string | null;
  }[];
  return rows.map((r) => ({
    employeeId: r.id,
    employeeNumber: r.employee_number,
    name: reportName({ first: r.first, last: r.last, preferred: r.preferred }),
    team: r.team,
    hasAccount: r.has_account,
    acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at) : null,
  }));
}
