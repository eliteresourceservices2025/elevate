import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

/**
 * Whether a person holds a current ELEVATE Learn certificate for a course: not revoked and not past its end date. Used by the
 * onboarding checklist ("HIPAA training is passed") and anywhere else that only needs a yes or no. No scores are read.
 */
export async function hasCurrentCertificate(tx: Pick<typeof db, "execute">, userId: string, courseSlug: string, today: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select 1
    from learn.certificates c
    join learn.assignments a on a.id = c.assignment_id
    join learn.courses co on co.id = a.course_id
    where c.user_id = ${userId} and co.slug = ${courseSlug} and c.ends_on >= ${today}::date
      and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)
    limit 1`)) as unknown as unknown[];
  return rows.length > 0;
}

export type TrainingReadiness =
  | { state: "passed"; validUntil: string }
  | { state: "open"; dueOn: string; overdue: boolean }
  | { state: "expired"; endedOn: string }
  | { state: "none" };

/**
 * Where a person stands on a course, in words HR can act on: a current certificate, training still open (and whether it is late), an
 * ended certificate, or nothing yet. A yes/no style answer: no scores, tries or answers. Callers authorize first.
 */
export async function trainingReadiness(tx: Pick<typeof db, "execute">, userId: string, courseSlug: string, today: string): Promise<TrainingReadiness> {
  const cert = (await tx.execute(sql`
    select max(c.ends_on)::text as ends_on
    from learn.certificates c join learn.assignments a on a.id = c.assignment_id join learn.courses co on co.id = a.course_id
    where c.user_id = ${userId} and co.slug = ${courseSlug}
      and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)`)) as unknown as { ends_on: string | null }[];
  const endsOn = cert[0]?.ends_on ?? null;
  if (endsOn && endsOn >= today) return { state: "passed", validUntil: endsOn };
  const open = (await tx.execute(sql`
    select a.due_on::text as due_on
    from learn.assignments a join learn.courses co on co.id = a.course_id
    where a.user_id = ${userId} and co.slug = ${courseSlug} and a.status in ('assigned', 'in_progress')
    order by a.assigned_at desc limit 1`)) as unknown as { due_on: string }[];
  if (open[0]) return { state: "open", dueOn: open[0].due_on, overdue: open[0].due_on < today };
  if (endsOn) return { state: "expired", endedOn: endsOn };
  return { state: "none" };
}
