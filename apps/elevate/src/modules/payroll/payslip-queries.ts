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
import { payLines, payPayments, payRunLines, payRuns } from "./schema";
import { decryptRunLine, employeeIdForUser } from "./service";
import { runSignatory } from "./signatory";
import type { SettingsSnapshot } from "./calculate";

// A person's own payslips. Scoped through the signed-in person's own people record, never by a payroll level or a role: nobody, not even
// a Super Admin, reads anyone else's. A payslip exists only for a run that is paid. Nothing here writes an amount to a log.

export type PayslipListRow = { runId: string; periodLabel: string; net: string };

/** The payslip could not be decrypted (usually a wrong or rotated key). Carries no figure. */
export class PayslipUnreadable extends Error {
  constructor() {
    super("payslip unreadable");
    this.name = "PayslipUnreadable";
  }
}

const own = (actor: AuthzUser) => authorize(actor, "payroll.view_own", { ownerUserId: actor.id });

function readable(runLineId: string, stored: string) {
  try {
    return decryptRunLine(runLineId, stored);
  } catch (error) {
    // Only the line id and the kind of error: never an amount or the stored ciphertext.
    console.error("payroll payslip line unreadable:", { runLineId, error: error instanceof Error ? error.name : "UnknownError" });
    return null;
  }
}

const ownPaidRuns = (employeeId: string) =>
  and(eq(payRunLines.employeeId, employeeId), eq(payRuns.status, "paid"));

/** How many payslips the signed-in person has. */
export async function countMyPayslips(): Promise<number> {
  const actor = await requireUser();
  await own(actor);
  const employeeId = await employeeIdForUser(db, actor.id);
  if (!employeeId) return 0;
  const [row] = await db.select({ n: countDistinct(payRuns.id) }).from(payRuns).innerJoin(payRunLines, eq(payRunLines.runId, payRuns.id)).where(ownPaidRuns(employeeId));
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
    .innerJoin(payRunLines, eq(payRunLines.runId, payRuns.id))
    .where(ownPaidRuns(employeeId))
    .orderBy(desc(payRuns.periodStart), asc(payRuns.id));
  const runs = paging ? await base.limit(paging.pageSize).offset((paging.page - 1) * paging.pageSize) : await base;
  if (runs.length === 0) return [];

  const lines = await db
    .select({ id: payRunLines.id, runId: payRunLines.runId, payloadEnc: payRunLines.payloadEnc })
    .from(payRunLines)
    .where(and(eq(payRunLines.employeeId, employeeId), inArray(payRunLines.runId, runs.map((r) => r.id))));
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
 * One payslip of the acting person, or null when the run does not exist, is not paid, or is not theirs (all the same answer).
 * Throws PayslipUnreadable when a line can't be decrypted. The caller has done requireUser() and passes the user.
 */
export async function getMyPayslip(actor: AuthzUser, runId: string): Promise<(PayslipInput & { employeeId: string }) | null> {
  await own(actor);
  if (!z.uuid().safeParse(runId).success) return null;
  const employeeId = await employeeIdForUser(db, actor.id);
  if (!employeeId) return null;

  const [run] = await db
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd, settingsSnapshot: payRuns.settingsSnapshot })
    .from(payRuns)
    .where(and(eq(payRuns.id, runId), eq(payRuns.status, "paid")))
    .limit(1);
  if (!run) return null;
  const lines = await db
    .select({ id: payRunLines.id, alias: payRunLines.alias, clientName: clients.name, payloadEnc: payRunLines.payloadEnc, paymentMethod: payLines.paymentMethod })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .leftJoin(clients, eq(clients.id, payRunLines.clientId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.employeeId, employeeId)))
    .orderBy(asc(payRunLines.alias), asc(payRunLines.id));
  if (lines.length === 0) return null;
  const [who] = await db
    .select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, startDate: employees.startDate })
    .from(employees)
    .where(eq(employees.id, employeeId))
    .limit(1);

  // Independent of each other: asked together.
  const [[payment], signatory] = await Promise.all([
    db
      .select({ paidOn: payPayments.paidOn })
      .from(payPayments)
      .where(and(eq(payPayments.runId, runId), eq(payPayments.employeeId, employeeId)))
      .orderBy(desc(payPayments.createdAt))
      .limit(1),
    runSignatory(db, runId),
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
    lines: decrypted.map((l) => ({ alias: l.alias, clientName: l.clientName, input: l.payload!.input, result: l.payload!.result })),
  };
}

