import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { todayInZone } from "@/modules/org/service";

// The pop-up queue. A pop-up is an announcement or policy that HR chose to show when people sign in, from a date, in an order.
// Every query starts with requireUser() and authorize(). Pages wrap them in orNotFound().

/** The most pop-ups one person is shown in a row: more would be a wall. The rest follow on their next page load. */
export const MAX_POPUPS_AT_ONCE = 6;

export type MyPopup = {
  /** announcement id, or policy VERSION id (what is acknowledged and dismissed). */
  subjectId: string;
  kind: "announcement" | "policy";
  title: string;
  body: string;
  requiresAck: boolean;
  dueOn: string | null;
  version: number | null;
  /** The announcement's video (content file id), when it has one. */
  videoId: string | null;
  /** Version stamp of an announcement's content as shown (null for a policy: its version is frozen). */
  revision: string | null;
  link: string;
};

/**
 * What to show the signed-in person right now, in line order: queued items whose date has come that they have not yet acknowledged
 * (when acknowledgment is required) or closed (when it is not). An announcement goes only to the people it was addressed to; a policy to
 * every active person. Privacy notice and monitoring policies have their own screens and are never queued.
 */
export async function listMyPopups(): Promise<MyPopup[]> {
  const user = await requireUser();
  await authorize(user, "announcements.view");
  const today = todayInZone();
  const rows = (await db.execute(sql`
    select * from (
      select a.id::text as subject_id, 'announcement' as kind, a.title, a.body, a.requires_ack, a.due_on::text as due_on, null::int as version,
             (select cf.id::text from docs.content_files cf where cf.announcement_id = a.id and cf.kind = 'video' limit 1) as video_id,
             floor(extract(epoch from a.updated_at) * 1000)::bigint::text as revision,
             p.sort_order, p.show_from, p.created_at
      from docs.popups p
      join docs.announcements a on a.id = p.announcement_id
      where a.archived_at is null and p.show_from <= ${today}::date
        and exists (select 1 from docs.announcement_recipients r join core.employees e on e.id = r.employee_id
                    where r.announcement_id = a.id and e.user_id = ${user.id} and e.archived_at is null and e.status <> 'separated')
        and not exists (select 1 from docs.acknowledgments k where k.user_id = ${user.id} and k.announcement_id = a.id)
        and not exists (select 1 from docs.popup_dismissals d where d.user_id = ${user.id} and d.announcement_id = a.id)
      union all
      select pv.id::text, 'policy', pol.title, pv.body, pv.requires_ack, pv.due_on::text, pv.version, null::text, null::text,
             p.sort_order, p.show_from, p.created_at
      from docs.popups p
      join docs.policies pol on pol.id = p.policy_id
      join docs.policy_versions pv on pv.policy_id = pol.id and pv.status = 'published'
      where pol.archived_at is null and pol.kind = 'general' and p.show_from <= ${today}::date
        and pv.version = (select max(v2.version) from docs.policy_versions v2 where v2.policy_id = pol.id and v2.status = 'published')
        and (not pv.requires_ack or exists (select 1 from core.employees e where e.user_id = ${user.id} and e.archived_at is null and e.status <> 'separated'))
        and not exists (select 1 from docs.acknowledgments k where k.user_id = ${user.id} and k.policy_version_id = pv.id)
        and not exists (select 1 from docs.popup_dismissals d where d.user_id = ${user.id} and d.policy_version_id = pv.id)
    ) q
    order by sort_order asc, show_from asc, created_at asc
    limit ${MAX_POPUPS_AT_ONCE}`)) as unknown as {
    subject_id: string; kind: "announcement" | "policy"; title: string; body: string; requires_ack: boolean; due_on: string | null; version: number | null; video_id: string | null; revision: string | null;
  }[];

  // A policy's page address is its policy id, not its version id.
  const policyIds = new Map<string, string>();
  const versionIds = rows.filter((r) => r.kind === "policy").map((r) => r.subject_id);
  if (versionIds.length > 0) {
    const found = (await db.execute(sql`select id::text as version_id, policy_id::text as policy_id from docs.policy_versions where id::text = any(${`{${versionIds.join(",")}}`}::text[])`)) as unknown as { version_id: string; policy_id: string }[];
    for (const f of found) policyIds.set(f.version_id, f.policy_id);
  }
  return rows.map((r) => ({
    subjectId: r.subject_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    requiresAck: r.requires_ack,
    dueOn: r.due_on,
    version: r.version,
    videoId: r.video_id,
    revision: r.revision,
    link: r.kind === "announcement" ? `/announcements/${r.subject_id}` : `/announcements/policies/${policyIds.get(r.subject_id) ?? ""}`,
  }));
}

export type PopupQueueRow = {
  popupId: string;
  kind: "announcement" | "policy";
  /** announcement id or policy id (for the link). */
  itemId: string;
  title: string;
  requiresAck: boolean;
  showFrom: string;
  /** "scheduled" = its date has not come; "live" = people are being shown it. */
  state: "scheduled" | "live";
  position: number;
};

/** HR: the whole queue in the order people see it. */
export async function listPopupQueue(): Promise<PopupQueueRow[]> {
  const user = await requireUser();
  await authorize(user, "announcements.manage_popups");
  const today = todayInZone();
  const rows = (await db.execute(sql`
    select p.id::text as popup_id,
           case when p.announcement_id is not null then 'announcement' else 'policy' end as kind,
           coalesce(p.announcement_id, p.policy_id)::text as item_id,
           coalesce(a.title, pol.title) as title,
           coalesce(a.requires_ack, (select pv.requires_ack from docs.policy_versions pv where pv.policy_id = pol.id and pv.status = 'published' order by pv.version desc limit 1), false) as requires_ack,
           p.show_from::text as show_from
    from docs.popups p
    left join docs.announcements a on a.id = p.announcement_id
    left join docs.policies pol on pol.id = p.policy_id
    where coalesce(a.archived_at, pol.archived_at) is null
    order by p.sort_order asc, p.show_from asc, p.created_at asc`)) as unknown as {
    popup_id: string; kind: "announcement" | "policy"; item_id: string; title: string; requires_ack: boolean; show_from: string;
  }[];
  return rows.map((r, i) => ({ popupId: r.popup_id, kind: r.kind, itemId: r.item_id, title: r.title, requiresAck: r.requires_ack, showFrom: r.show_from, state: r.show_from <= today ? "live" : "scheduled", position: i + 1 }));
}

/** HR: whether one announcement or policy is queued, and from when (for the control on its own page). */
export async function getPopupFor(kind: "announcement" | "policy", itemId: string): Promise<{ showFrom: string } | null> {
  const user = await requireUser();
  await authorize(user, "announcements.manage_popups");
  const [row] = (await db.execute(
    kind === "announcement"
      ? sql`select show_from::text as show_from from docs.popups where announcement_id = ${itemId}::uuid`
      : sql`select show_from::text as show_from from docs.popups where policy_id = ${itemId}::uuid`,
  )) as unknown as { show_from: string }[];
  return row ? { showFrom: row.show_from } : null;
}
