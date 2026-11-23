import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

/** Whether this person may pick this project: it has nobody listed (open to the client's people), or they are listed. */
export async function projectOpenTo(executor: Pick<typeof db, "execute">, projectId: string, employeeId: string): Promise<boolean> {
  const rows = (await executor.execute(sql`
    select 1 as ok where not exists (select 1 from core.client_project_members m where m.project_id = ${projectId})
      or exists (select 1 from core.client_project_members m where m.project_id = ${projectId} and m.employee_id = ${employeeId})`)) as unknown as { ok: number }[];
  return rows.length > 0;
}

/**
 * Whether a clock in or switch for this client must name a project: the client does not allow "No specific project" AND this person can
 * see at least one of its active projects. Someone who can see none still clocks in for the client, so nobody is left stuck.
 */
export async function projectRequired(executor: Pick<typeof db, "execute">, clientId: string, employeeId: string): Promise<boolean> {
  const rows = (await executor.execute(sql`
    select 1 as ok from core.clients c
    where c.id = ${clientId} and c.allow_no_project = false and exists (
      select 1 from core.client_projects p where p.client_id = c.id and p.archived_at is null
        and (not exists (select 1 from core.client_project_members m where m.project_id = p.id)
          or exists (select 1 from core.client_project_members m where m.project_id = p.id and m.employee_id = ${employeeId})))`)) as unknown as { ok: number }[];
  return rows.length > 0;
}
