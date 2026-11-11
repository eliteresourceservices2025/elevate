import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { clients, employees } from "@/modules/people/schema";
import { latestItems } from "./runs";
import { payRunLines, payRuns } from "./schema";
import { decryptItemValue } from "./service";

// The one way another module (client invoices) reads a pay run: the CLIENT PAYROLL HOURS only. It never decrypts a line's pay figures, an
// amount, a rate or a reason: it reads the run's period and status, who is on it (name, alias, client) and the "client hours" items, which
// are hours, not pay. The caller has already authorized; this takes no user.

type Executor = Pick<typeof db, "select">;

export type ClientHoursRow = {
  runLineId: string;
  employeeId: string;
  personName: string;
  alias: string | null;
  clientId: string | null;
  clientName: string | null;
  /** Hundredths of an hour (86.5 hours is 8650). */
  hundredths: bigint;
  /** False when the figure is still only a suggestion (for example from an imported timesheet) that nobody confirmed. */
  confirmed: boolean;
};

export type RunClientHours = {
  run: { id: string; periodStart: string; periodEnd: string; status: string };
  rows: ClientHoursRow[];
};

/** Client payroll hours for each live line of a run, or null when there is no such run. A line with no hours entered has 0. */
export async function clientHoursForRun(executor: Executor, runId: string): Promise<RunClientHours | null> {
  const [run] = await executor.select({ id: payRuns.id, periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, status: payRuns.status }).from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  if (!run) return null;

  const lines = await executor
    .select({
      runLineId: payRunLines.id,
      employeeId: payRunLines.employeeId,
      alias: payRunLines.alias,
      clientId: payRunLines.clientId,
      clientName: clients.name,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
    })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .leftJoin(clients, eq(clients.id, payRunLines.clientId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
    .orderBy(asc(clients.name), asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias), asc(payRunLines.id));

  const hours = new Map<string, { value: bigint; confirmed: boolean }>();
  for (const item of await latestItems(executor, runId)) {
    if (item.type !== "client_hours" || item.runLineId === null || item.state === "dismissed") continue;
    hours.set(item.runLineId, { value: decryptItemValue(item.id, item.valueEnc).value, confirmed: item.state === "confirmed" });
  }

  return {
    run,
    rows: lines.map((l) => {
      const h = hours.get(l.runLineId);
      return {
        runLineId: l.runLineId,
        employeeId: l.employeeId,
        personName: `${l.preferred?.trim() || l.first} ${l.last}`,
        alias: l.alias,
        clientId: l.clientId,
        clientName: l.clientName,
        hundredths: h?.value ?? 0n,
        confirmed: h?.confirmed ?? true,
      };
    }),
  };
}
