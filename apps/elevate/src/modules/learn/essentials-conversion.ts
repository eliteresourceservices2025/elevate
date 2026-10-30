import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { todayInZone } from "@/modules/org/service";
import { addDays } from "./rules";
import { HIPAA_SLUG } from "./constants";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; email: string; roles?: readonly string[] };

export type EssentialsConversion = { newAssignmentId: string; creditedModules: number };

/**
 * Moves someone from a legacy HIPAA Essentials assignment to Full. A track cannot change on an existing assignment (a database guard),
 * so the Essentials assignment is closed (kept as history) and a Full one replaces it. Modules already completed that Full also
 * contains are carried over with their original dates; the Full exam is a new one. Must run inside a transaction.
 */
export async function convertEssentialsToFull(tx: Tx, actor: Actor, p: { assignmentId: string; reason: string }): Promise<EssentialsConversion> {
  const found = (await tx.execute(sql`
    select a.user_id, a.status, a.track, a.course_id, a.version_id, a.due_on::text as due_on, c.slug
    from learn.assignments a join learn.courses c on c.id = a.course_id
    where a.id = ${p.assignmentId} for update of a`)) as unknown as { user_id: string; status: string; track: string; course_id: string; version_id: string; due_on: string; slug: string }[];
  const old = found[0];
  if (!old) throw new ActionFailure("That training was not found.");
  if (old.slug !== HIPAA_SLUG || old.track !== "essentials") throw new ActionFailure("Only a HIPAA Essentials assignment can be moved to Full.");
  // Open training, or an exam passed whose acknowledgement was never completed (no certificate yet). A certificate is never replaced here.
  const open = ["assigned", "in_progress"].includes(old.status);
  if (!open) {
    const certified = (await tx.execute(sql`select 1 from learn.certificates where assignment_id = ${p.assignmentId}`)) as unknown as unknown[];
    if (old.status !== "passed" || certified.length > 0) throw new ActionFailure("Only open training, or a passed exam with no certificate yet, can be moved to Full.");
  }
  if (old.user_id === actor.id) throw new ActionFailure("Another HR admin has to change your own training.");

  const published = (await tx.execute(sql`
    select v.id from learn.course_versions v where v.course_id = ${old.course_id} and v.status = 'published'`)) as unknown as { id: string }[];
  if (!published[0]) throw new ActionFailure("The course is not published yet.");
  if (published[0].id !== old.version_id) {
    throw new ActionFailure("The course was updated after this was assigned, so progress cannot be carried over safely. Assign the Full course instead.");
  }

  const person = (await tx.execute(sql`
    select 1 from core.users u where u.id = ${old.user_id} and u.archived_at is null
      and exists (select 1 from core.employees e where e.user_id = u.id and e.archived_at is null and e.status <> 'separated')`)) as unknown as unknown[];
  if (person.length === 0) throw new ActionFailure("That person is not an active team member with an account.");

  // Close the old one first: only one assignment per person and course may be open.
  // A passed one can only move on to 'expired' (a database guard), which also stops it from ever issuing an Essentials certificate.
  await tx.execute(sql`update learn.assignments set status = ${open ? "cancelled" : "expired"} where id = ${p.assignmentId}`);
  const made = (await tx.execute(sql`
    insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, created_by)
    values (${old.user_id}, ${old.course_id}, ${old.version_id}, 'full', 'manual', ${addDays(todayInZone(), 30)}::date, ${actor.id})
    returning id`)) as unknown as { id: string }[];
  const newId = made[0].id;

  const credited = (await tx.execute(sql`
    insert into learn.module_completions (assignment_id, user_id, module_key, completed_at)
    select ${newId}, mc.user_id, mc.module_key, mc.completed_at
    from learn.module_completions mc
    where mc.assignment_id = ${p.assignmentId}
      and exists (select 1 from learn.version_modules vm where vm.version_id = ${old.version_id} and vm.module_key = mc.module_key and 'full' = any (vm.tracks))
    returning module_key`)) as unknown as unknown[];

  await writeAudit(
    {
      actor,
      action: "learn.convert_essentials_to_full",
      targetType: "learn_assignment",
      targetId: newId,
      before: { assignmentId: p.assignmentId, track: "essentials", status: old.status },
      after: { assignmentId: newId, track: "full", creditedModules: credited.length },
      metadata: { reason: p.reason },
    },
    tx,
  );
  await notify(tx, {
    userId: old.user_id,
    kind: "learn.assigned",
    title: "Your HIPAA training is now the full course",
    body: "The modules you finished are kept. Please complete the rest and take the exam.",
    link: "/learn",
  });
  return { newAssignmentId: newId, creditedModules: credited.length };
}
