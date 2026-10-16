"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { todayInZone } from "@/modules/org/service";
import { isoDate } from "@/modules/people/validators";

// Managing the sign-in pop-up queue (HR and Super Admin) and closing a pop-up (everyone, for themselves).

const uuid = z.uuid();
const BAD = "Check the request and try again.";

const setPopupSchema = z.object({
  kind: z.enum(["announcement", "policy"]),
  itemId: uuid,
  enabled: z.boolean(),
  showFrom: isoDate.optional(),
});
const moveSchema = z.object({ popupId: uuid, direction: z.enum(["up", "down"]) });
const dismissSchema = z.object({ kind: z.enum(["announcement", "policy_version"]), id: uuid });

function refresh() {
  for (const p of ["/announcements", "/dashboard"]) revalidatePath(p);
}

/**
 * Queues an announcement or policy as a sign-in pop-up from a date (today if none), at the end of the line, or takes it out of the
 * queue. Changing the date of an item already queued keeps its place. Audited with ids and the date, never the text.
 */
export async function setPopup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.manage_popups");
    const parsed = setPopupSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const v = parsed.data;
    const showFrom = v.showFrom ?? todayInZone();
    await db.transaction(async (tx) => {
      const exists = (await tx.execute(
        v.kind === "announcement"
          ? sql`select 1 from docs.announcements where id = ${v.itemId}::uuid and archived_at is null`
          : sql`select 1 from docs.policies where id = ${v.itemId}::uuid and archived_at is null and kind = 'general'`,
      )) as unknown as unknown[];
      if (exists.length === 0) throw new ActionFailure(v.kind === "policy" ? "That policy cannot be shown as a pop-up." : "That announcement was not found.");
      if (!v.enabled) {
        await tx.execute(v.kind === "announcement" ? sql`delete from docs.popups where announcement_id = ${v.itemId}::uuid` : sql`delete from docs.popups where policy_id = ${v.itemId}::uuid`);
      } else {
        await tx.execute(
          v.kind === "announcement"
            ? sql`insert into docs.popups (announcement_id, show_from, sort_order, created_by)
                  values (${v.itemId}::uuid, ${showFrom}::date, (select coalesce(max(sort_order), 0) + 1 from docs.popups), ${actor.id})
                  on conflict (announcement_id) where announcement_id is not null do update set show_from = excluded.show_from, updated_at = now()`
            : sql`insert into docs.popups (policy_id, show_from, sort_order, created_by)
                  values (${v.itemId}::uuid, ${showFrom}::date, (select coalesce(max(sort_order), 0) + 1 from docs.popups), ${actor.id})
                  on conflict (policy_id) where policy_id is not null do update set show_from = excluded.show_from, updated_at = now()`,
        );
      }
      await writeAudit({ actor, action: v.enabled ? "popup.set" : "popup.remove", targetType: v.kind, targetId: v.itemId, metadata: v.enabled ? { showFrom } : undefined }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/** Moves a queued pop-up one place earlier or later in line. */
export async function movePopup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.manage_popups");
    const parsed = moveSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { popupId, direction } = parsed.data;
    await db.transaction(async (tx) => {
      // One writer at a time, then number the line 1..n so two items never share a place, then swap with the neighbour.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('docs.popups.order'))`);
      const line = (await tx.execute(sql`select id::text as id from docs.popups order by sort_order asc, show_from asc, created_at asc, id asc`)) as unknown as { id: string }[];
      const at = line.findIndex((r) => r.id === popupId);
      if (at < 0) throw new ActionFailure("That pop-up is no longer queued.");
      const to = direction === "up" ? at - 1 : at + 1;
      if (to < 0 || to >= line.length) return;
      const ids = line.map((r) => r.id);
      [ids[at], ids[to]] = [ids[to], ids[at]];
      for (const [i, id] of ids.entries()) await tx.execute(sql`update docs.popups set sort_order = ${i + 1}, updated_at = now() where id = ${id}::uuid and sort_order <> ${i + 1}`);
      await writeAudit({ actor, action: "popup.reorder", targetType: "popup", targetId: popupId, metadata: { direction } }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

/**
 * The signed-in person closes a pop-up that needs no acknowledgment (it does not come back; a new policy version does). One that needs
 * acknowledgment cannot be closed this way: they acknowledge it instead (the `acknowledge` action).
 */
export async function dismissPopup(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.view");
    const parsed = dismissSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const { kind, id } = parsed.data;
    const found = (await db.execute(
      kind === "announcement"
        ? sql`select a.requires_ack from docs.popups p join docs.announcements a on a.id = p.announcement_id where a.id = ${id}::uuid`
        : sql`select pv.requires_ack from docs.policy_versions pv join docs.popups p on p.policy_id = pv.policy_id where pv.id = ${id}::uuid`,
    )) as unknown as { requires_ack: boolean }[];
    if (!found[0]) return fail("That pop-up is not queued.");
    if (found[0].requires_ack) return fail("This one needs your acknowledgment.");
    await db.execute(
      kind === "announcement"
        ? sql`insert into docs.popup_dismissals (user_id, announcement_id) values (${actor.id}, ${id}::uuid) on conflict do nothing`
        : sql`insert into docs.popup_dismissals (user_id, policy_version_id) values (${actor.id}, ${id}::uuid) on conflict do nothing`,
    );
    return { ok: true, data: undefined };
  });
}
