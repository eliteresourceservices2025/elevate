import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { employees } from "@/modules/people/schema";
import type { RunStatus } from "./constants";
import { STATEMENT_LABELS as S } from "./constants";
import { formatPesos } from "./money";
import type { PayslipInput } from "./payslip";
import { buildStatement, PayslipUnreadable, readable } from "./payslip-queries";
import { joinAliases, personName } from "./remitly";
import { payRunLines, payRunReleases, payRuns } from "./schema";
import { releaseRefusal } from "./statements";

// The payroll team's view of contractor payment statements: every statement of an approved run, readable, downloadable and, for a real run,
// releasable to the people on it. Anyone who can open payroll (`payroll.view`) can read them, because they can already read the pay itself.
// A test run's statements can be opened here to check them (stamped TEST) but are never visible to a contractor. Opening them is a
// sensitive read: one audit row per view (the run id, a field name and a count, never an amount or a name).

const OPEN = ["approved", "paid"] as const;

export type StatementRunRow = { runId: string; periodLabel: string; status: RunStatus; isTest: boolean; people: number; releasedAt: string | null };

/** One page of the runs whose statements can be read (approved or paid, not archived), newest period first. Shows no figures. */
export async function getStatementRuns(paging: { page: number; pageSize: number }): Promise<{ rows: StatementRunRow[]; total: number }> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");

  const open = and(inArray(payRuns.status, [...OPEN]), isNull(payRuns.archivedAt));
  const [{ total }] = await db.select({ total: count() }).from(payRuns).where(open);
  const rows = await db
    .select({
      id: payRuns.id,
      periodStart: payRuns.periodStart,
      periodEnd: payRuns.periodEnd,
      status: payRuns.status,
      isTest: payRuns.isTest,
      releasedAt: payRunReleases.releasedAt,
      people: sql<number>`(select count(distinct l.employee_id)::int from payroll.pay_run_lines l where l.run_id = ${payRuns.id} and not l.excluded)`,
    })
    .from(payRuns)
    .leftJoin(payRunReleases, eq(payRunReleases.runId, payRuns.id))
    .where(open)
    .orderBy(desc(payRuns.periodStart), desc(payRuns.createdAt))
    .limit(paging.pageSize)
    .offset((paging.page - 1) * paging.pageSize);
  return {
    rows: rows.map((r) => ({ runId: r.id, periodLabel: `${r.periodStart} to ${r.periodEnd}`, status: r.status as RunStatus, isTest: r.isTest, people: r.people, releasedAt: r.releasedAt ? r.releasedAt.toISOString() : null })),
    total,
  };
}

export type RunStatementsView = {
  run: { id: string; periodLabel: string; status: RunStatus; isTest: boolean };
  people: { employeeId: string; name: string; aliases: string; net: string; readable: boolean }[];
  releasedAt: string | null;
  canRelease: boolean;
  /** Why the release button is off, or null when it is on. */
  refusal: string | null;
};

/** Every person's statement summary on a run, or null when there is no such run or it is not approved yet. Opening it is audited. */
export async function getRunStatements(runId: string): Promise<RunStatementsView | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");
  if (!z.uuid().safeParse(runId).success) return null;

  const [run] = await db.select().from(payRuns).where(and(eq(payRuns.id, runId), inArray(payRuns.status, [...OPEN]))).limit(1);
  if (!run) return null;
  const [release] = await db.select({ releasedAt: payRunReleases.releasedAt }).from(payRunReleases).where(eq(payRunReleases.runId, runId)).limit(1);
  const lines = await db
    .select({ id: payRunLines.id, employeeId: payRunLines.employeeId, alias: payRunLines.alias, payloadEnc: payRunLines.payloadEnc, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias));

  const byPerson = new Map<string, { name: string; aliases: (string | null)[]; net: bigint; ok: boolean }>();
  for (const l of lines) {
    const p = byPerson.get(l.employeeId) ?? { name: personName(l), aliases: [], net: 0n, ok: true };
    const payload = readable(l.id, l.payloadEnc);
    if (payload) p.net += payload.result.net;
    else p.ok = false;
    p.aliases.push(l.alias);
    byPerson.set(l.employeeId, p);
  }
  const people = [...byPerson].map(([employeeId, p]) => ({ employeeId, name: p.name, aliases: joinAliases(p.aliases), net: p.ok ? formatPesos(p.net) : S.unreadable, readable: p.ok }));
  if (people.some((p) => p.readable)) await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["statements"], count: people.filter((p) => p.readable).length } });

  const canRelease = can(actor, "payroll.release_statements");
  const base = releaseRefusal(run, release !== undefined);
  const refusal = base ?? (people.some((p) => !p.readable) ? S.refusalUnreadable : !canRelease ? S.refusalNoAccess : null);
  return {
    run: { id: run.id, periodLabel: `${run.periodStart} to ${run.periodEnd}`, status: run.status as RunStatus, isTest: run.isTest },
    people,
    releasedAt: release ? release.releasedAt.toISOString() : null,
    canRelease,
    refusal,
  };
}

/** One person's statement on an approved run, for the payroll team. Null when there is no such run or person. Throws PayslipUnreadable. */
export async function getStatementForTeam(runId: string, employeeId: string): Promise<(PayslipInput & { employeeId: string }) | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");
  if (!z.uuid().safeParse(runId).success || !z.uuid().safeParse(employeeId).success) return null;
  const [run] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, settingsSnapshot: payRuns.settingsSnapshot, isTest: payRuns.isTest })
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), inArray(payRuns.status, [...OPEN])))
    .limit(1);
  if (!run) return null;
  const slip = await buildStatement(db, runId, employeeId, run);
  if (!slip) return null;
  await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["statement"], count: 1 } });
  return slip;
}

/** Every statement of an approved run, in name order, for the combined PDF. Null when there is no such run. Throws PayslipUnreadable. */
export async function getAllStatementsForTeam(runId: string): Promise<(PayslipInput & { employeeId: string })[] | null> {
  const actor = await requireUser();
  await authorize(actor, "payroll.view");
  if (!z.uuid().safeParse(runId).success) return null;
  const [run] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, settingsSnapshot: payRuns.settingsSnapshot, isTest: payRuns.isTest })
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), inArray(payRuns.status, [...OPEN])))
    .limit(1);
  if (!run) return null;
  const ids = await db
    .selectDistinct({ employeeId: payRunLines.employeeId, last: employees.legalLastName, first: employees.legalFirstName })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.employeeId));
  const out: (PayslipInput & { employeeId: string })[] = [];
  for (const { employeeId } of ids) {
    const slip = await buildStatement(db, runId, employeeId, run);
    if (!slip) continue;
    out.push(slip);
  }
  await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["statements"], count: out.length } });
  return out;
}

export { PayslipUnreadable };
