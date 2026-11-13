import "server-only";
import { and, asc, countDistinct, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { authorize, type AuthzUser } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import { PAYSLIP_LABELS as L } from "./constants";
import { formatPesos } from "./money";
import type { PayslipInput } from "./payslip";
import { personName } from "./remitly";
import { users } from "@/modules/core/schema";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { payApprovals, payLines, payPayments, payRunLines, payRunReleases, payRuns } from "./schema";
import { decryptRunLine, employeeIdForUser } from "./service";
import { runSignatory } from "./signatory";
import type { SettingsSnapshot } from "./calculate";

// A person's own payslips. Scoped through the signed-in person's own people record, never by a payroll level or a role: nobody, not even
// a Super Admin, reads anyone else's. A payslip exists for them only when the run is a REAL run that an Approver has RELEASED (a row in
// pay_run_releases): approval, payment and a test run alone never make one visible. Nothing here writes an amount to a log.

export type PayslipListRow = { runId: string; periodLabel: string; net: string };

/** The payslip could not be decrypted (usually a wrong or rotated key). Carries no figure. */
export class PayslipUnreadable extends Error {
  constructor() {
    super("payslip unreadable");
    this.name = "PayslipUnreadable";
  }
}

const own = (actor: AuthzUser) => authorize(actor, "payroll.view_own", { ownerUserId: actor.id });

export function readable(runLineId: string, stored: string) {
  try {
    return decryptRunLine(runLineId, stored);
  } catch (error) {
    // Only the line id and the kind of error: never an amount or the stored ciphertext.
    console.error("payroll payslip line unreadable:", { runLineId, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

const ownReleasedRuns = (employeeId: string) => and(eq(payRunLines.employeeId, employeeId), eq(payRunLines.excluded, false), eq(payRuns.isTest, false));

/** How many payslips the signed-in person has. */
export async function countMyPayslips(): Promise<number> {
  const actor = await requireUser();
  await own(actor);
  const employeeId = await employeeIdForUser(db, actor.id);
  if (!employeeId) return 0;
  const [row] = await db
    .select({ n: countDistinct(payRuns.id) })
    .from(payRuns)
    .innerJoin(payRunReleases, eq(payRunReleases.runId, payRuns.id))
    .innerJoin(payRunLines, eq(payRunLines.runId, payRuns.id))
    .where(ownReleasedRuns(employeeId));
  return Number(row?.n ?? 0);
}

/** The signed-in person's payslips, newest period first (all of them, or one page). The net is the sum of their lines on the run. */
export async function listMyPayslips(paging?: { page: number; pageSize: number }): Promise<PayslipListRow[]> {
  const actor = await requireUser();
  await own(actor);
  const employeeId = await employeeIdForUser(db, actor.id);
  if (!employeeId) return [];

  const base = db
    .selectDistinct({ id: payRuns.id, periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd })
    .from(payRuns)
    .innerJoin(payRunReleases, eq(payRunReleases.runId, payRuns.id))
    .innerJoin(payRunLines, eq(payRunLines.runId, payRuns.id))
    .where(ownReleasedRuns(employeeId))
    .orderBy(desc(payRuns.periodStart), asc(payRuns.id));
  const runs = paging ? await base.limit(paging.pageSize).offset((paging.page - 1) * paging.pageSize) : await base;
  if (runs.length === 0) return [];

  const lines = await db
    .select({ id: payRunLines.id, runId: payRunLines.runId, payloadEnc: payRunLines.payloadEnc })
    .from(payRunLines)
    .where(and(eq(payRunLines.employeeId, employeeId), eq(payRunLines.excluded, false), inArray(payRunLines.runId, runs.map((r) => r.id))));
  let shown = 0;
  const out = runs.map((r): PayslipListRow => {
    let net = 0n;
    let ok = true;
    for (const l of lines.filter((x) => x.runId === r.id)) {
      const payload = readable(l.id, l.payloadEnc);
      if (payload) net += payload.result.net;
      else ok = false;
    }
    if (ok) shown++;
    return { runId: r.id, periodLabel: `${r.periodStart} to ${r.periodEnd}`, net: ok ? formatPesos(net) : L.unreadable };
  });
  if (shown > 0) await writeAudit({ actor, action: "sensitive.view", targetType: "pay_payslips", targetId: employeeId, metadata: { fields: ["payslip net"], count: shown } });
  return out;
}

/**
 * One payslip of the acting person, or null when the run does not exist, is a test run, has not been released, or is not theirs (all the
 * same answer). Throws PayslipUnreadable when a line can't be decrypted. The caller has done requireUser() and passes the user.
 */
export async function getMyPayslip(actor: AuthzUser, runId: string): Promise<(PayslipInput & { employeeId: string }) | null> {
  await own(actor);
  if (!z.uuid().safeParse(runId).success) return null;
  const employeeId = await employeeIdForUser(db, actor.id);
  if (!employeeId) return null;

  const [run] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, settingsSnapshot: payRuns.settingsSnapshot, isTest: payRuns.isTest })
    .from(payRuns)
    .innerJoin(payRunReleases, eq(payRunReleases.runId, payRuns.id))
    .where(and(eq(payRuns.id, runId), eq(payRuns.isTest, false)))
    .limit(1);
  if (!run) return null;
  return buildStatement(db, runId, employeeId, run);
}

type StatementRun = { periodStart: string; periodEnd: string; settingsSnapshot: unknown; isTest: boolean };

/**
 * One person's statement on one run, built from their frozen run lines. The caller has already decided that this person's statement may be
 * shown to whoever asked (the person themselves once released, or the payroll team, who may read every statement of an approved run).
 * Null when the person has no live line on the run. Throws PayslipUnreadable when a line can't be decrypted.
 */
export async function buildStatement(executor: Pick<typeof db, "select">, runId: string, employeeId: string, run: StatementRun): Promise<(PayslipInput & { employeeId: string }) | null> {
  const lines = await executor
    .select({ id: payRunLines.id, alias: payRunLines.alias, clientName: clients.name, payloadEnc: payRunLines.payloadEnc, paymentMethod: payLines.paymentMethod })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .leftJoin(clients, eq(clients.id, payRunLines.clientId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false), eq(payRunLines.employeeId, employeeId)))
    .orderBy(asc(payRunLines.alias), asc(payRunLines.id));
  if (lines.length === 0) return null;
  const [who] = await executor
    .select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, startDate: employees.startDate })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  // Who prepared and who approved the run, and when: the certification block fills these in by itself.
  const [meta] = await executor.select({ submittedBy: payRuns.submittedBy, createdBy: payRuns.createdBy }).from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  const [approval] = await executor
    .select({ decidedBy: payApprovals.decidedBy, createdAt: payApprovals.createdAt })
    .from(payApprovals)
    .where(and(eq(payApprovals.runId, runId), eq(payApprovals.decision, "approved")))
    .orderBy(desc(payApprovals.createdAt))
    .limit(1);
  const preparerId = meta?.submittedBy ?? meta?.createdBy ?? null;
  const names = await namesOfUsers(executor, [preparerId, approval?.decidedBy ?? null]);

  // Independent of each other: asked together.
  const [[payment], signatory] = await Promise.all([
    executor
      .select({ paidOn: payPayments.paidOn })
      .from(payPayments)
      .where(and(eq(payPayments.runId, runId), eq(payPayments.employeeId, employeeId)))
      .orderBy(desc(payPayments.createdAt))
      .limit(1),
    runSignatory(executor, runId),
  ]);

  const decrypted = lines.map((l) => ({ alias: l.alias, clientName: l.clientName, payload: readable(l.id, l.payloadEnc) }));
  if (decrypted.some((l) => l.payload === null)) throw new PayslipUnreadable();
  return {
    employeeId,
    name: personName(who),
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    hiredOn: who.startDate,
    paidOn: payment?.paidOn ?? null,
    payslipNumber: `PS-${runId.slice(0, 8).toUpperCase()}-${employeeId.slice(0, 4).toUpperCase()}`,
    paymentMethods: lines.map((l) => l.paymentMethod),
    multipliersBp: (run.settingsSnapshot as SettingsSnapshot | null)?.multipliersBp ?? null,
    signatory,
    lines: decrypted.map((l) => ({ alias: l.alias, clientName: l.clientName, multipliersBp: l.payload!.rate.otBp ?? null, input: l.payload!.input, result: l.payload!.result })),
    isTest: run.isTest,
    preparedBy: preparerId ? names.get(preparerId) ?? null : null,
    authorizedBy: approval ? names.get(approval.decidedBy) ?? null : null,
    approvedOn: approval ? formatInZone(approval.createdAt.getTime(), DEFAULT_TIMEZONE, "yyyy-MM-dd") : null,
  };
}

/** A person's name for each sign-in account: the name on their people record, else the account's email. */
async function namesOfUsers(executor: Pick<typeof db, "select">, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((x): x is string => x !== null))];
  if (ids.length === 0) return new Map();
  const rows = await executor
    .select({ id: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.first ? personName({ preferred: r.preferred, first: r.first, last: r.last ?? "" }) : r.email]));
}
