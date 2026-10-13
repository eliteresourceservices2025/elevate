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
