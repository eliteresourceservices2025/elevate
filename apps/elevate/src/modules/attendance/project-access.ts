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
