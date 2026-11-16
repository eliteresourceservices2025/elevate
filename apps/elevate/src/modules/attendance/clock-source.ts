import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

// Where a person's hours come from: the ELEVATE clock (the default), or Jibble (they clock in Jibble and a job imports their time entries
// as clock events). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

export type ClockSourceKind = "elevate" | "jibble";

/** The person's current source: the newest row of time.clock_source, or the ELEVATE clock when there is none. */
export async function clockSourceOf(executor: Executor, employeeId: string): Promise<ClockSourceKind> {
  const [row] = (await executor.execute(sql`select source from time.clock_source where employee_id = ${employeeId} order by set_at desc, id desc limit 1`)) as unknown as { source: string }[];
  return row?.source === "jibble" ? "jibble" : "elevate";
}
