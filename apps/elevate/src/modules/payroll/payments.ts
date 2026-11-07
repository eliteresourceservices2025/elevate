import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { toCsv } from "@/lib/csv";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { PAYSLIP_LABELS } from "./constants";
import { readRun, type Executor } from "./runs";
import { buildRemitlyRows, personName } from "./remitly";
import { payPayments, payRunLines, payRuns } from "./schema";
import { assertNotOwnEmployee, payrollToday } from "./service";
import { freezeRunSignatory } from "./signatory";

// Paying: the Remitly list and the record of who was paid. ELEVATE sends no money; a Preparer pays in Remitly and records the reference.
// Every function takes the acting user or a transaction, so it is called only from actions that already ran requireUser() and authorize().
// Amounts and references never go into audit rows or notices; the reference lives encrypted, bound to its own row.

type Actor = { id: string; email: string };

const referenceContext = (id: string) => `pay_payment:${id}`;
const NOT_APPROVED = "This run has not been approved, so it can't be paid yet.";

/** The reference as stored. Callers must already hold `payroll.view`. */
export const decryptReference = (id: string, stored: string): string =>
  fieldCrypto().decrypt(stored, referenceContext(id));

/** The newest payment per person on the run (a correction is a newer row). */
export async function latestPayments(executor: Pick<Executor, "select">, runId: string) {
  const all = await executor
    .select()
    .from(payPayments)
    .where(eq(payPayments.runId, runId))
    .orderBy(desc(payPayments.createdAt), desc(payPayments.id));
  const newest = new Map<string, (typeof all)[number]>();
  for (const p of all) if (!newest.has(p.employeeId)) newest.set(p.employeeId, p);
  return newest;
}

/** Builds the Remitly list for an approved (or paid) run. Refused before approval and for a cancelled run. */
export async function remitlyList(
  tx: Tx,
  actor: Actor,
  runId: string,
): Promise<{ fileName: string; csv: string; rows: number }> {
  const data = await readRun(tx, runId);
  if (!data) throw new ActionFailure("That pay run was not found.");
  const { run } = data;
  if (run.status !== "approved" && run.status !== "paid")
    throw new ActionFailure("The Remitly list is available once the run is approved.");

  const lines = data.rows.map((r) => {
    const payload = data.payloads.get(r.runLine.id);
    if (!payload)
      throw new ActionFailure(
        "A line on this run can't be read, so the list can't be built. Tell the system owner.",
      );
    return {
      employeeId: r.runLine.employeeId,
      name: personName(r),
      alias: r.runLine.alias,
      net: payload.result.net,
    };
  });
  if (lines.some((l) => l.net < 0n))
    throw new ActionFailure("A line on this run has negative pay, so the list can't be built.");
  const built = buildRemitlyRows(lines);
  const csv = toCsv(
    ["Person", "Alias", "Pesos"],
    built.map((r) => [r.name, r.aliases, r.pesos]),
  );

  await writeAudit(
    {
      actor,
      action: "payroll.remitly.export",
      targetType: "pay_run",
      targetId: runId,
      metadata: { rows: built.length, lines: lines.length },
    },
    tx,
  );
  await logChange(tx, actor, { action: "list_exported", runId, detail: { rows: built.length } });
  return {
    fileName: `remitly-${run.periodStart}-to-${run.periodEnd}.csv`,
    csv,
    rows: built.length,
  };
}

/**
 * Tells each person on a run who has a sign-in account that their contractor payment statement is ready: one notice per person (a two-line person gets one),
 * a fixed sentence and a link, never an amount, a period or anyone else's name. A person with no account is simply skipped. Runs inside
 * the transaction that makes the run paid.
 */
async function notifyPayslipsReady(tx: Tx, runId: string): Promise<void> {
  const people = await tx
    .selectDistinct({ userId: employees.userId })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(eq(payRunLines.runId, runId), isNotNull(employees.userId), isNull(users.archivedAt)));
  await notify(
    tx,
    people.flatMap((p) =>
      p.userId ? [{ userId: p.userId, kind: PAYSLIP_LABELS.noticeKind, title: PAYSLIP_LABELS.noticeTitle, body: PAYSLIP_LABELS.noticeBody, link: PAYSLIP_LABELS.noticeLink }] : [],
    ),
  );
}

/**
 * Records that a person on an approved run was paid. A second call for the same person is a correction: a new row, and the newest shows.
 * When every person on the run has a payment the run becomes paid, in the same transaction (the status trigger allows approved to
 * paid only). A correction after that adds a row and leaves the paid run as it is. The run row is locked, so two last payments at once
 * make it paid exactly once.
 */
export async function recordPayment(
  tx: Tx,
  actor: Actor,
  v: { runId: string; employeeId: string; reference: string; paidOn: string },
): Promise<{ runPaid: boolean }> {
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, v.runId)).for("update");
  if (!run) throw new ActionFailure("That pay run was not found.");
  if (run.status !== "approved" && run.status !== "paid") throw new ActionFailure(NOT_APPROVED);

  const people = (
    await tx
      .selectDistinct({ id: payRunLines.employeeId })
      .from(payRunLines)
      .where(eq(payRunLines.runId, v.runId))
  ).map((r) => r.id);
  if (!people.includes(v.employeeId)) throw new ActionFailure("That person is not on this run.");
  await assertNotOwnEmployee(actor, v.employeeId, tx);
  if (v.paidOn > payrollToday())
    throw new ActionFailure("The payment date can't be in the future.");
  if (v.paidOn < run.periodStart)
    throw new ActionFailure("The payment date can't be before the pay period starts.");

  const id = randomUUID();
  const correction =
    (
      await tx
        .select({ id: payPayments.id })
        .from(payPayments)
        .where(and(eq(payPayments.runId, v.runId), eq(payPayments.employeeId, v.employeeId)))
        .limit(1)
    ).length > 0;
  await tx.insert(payPayments).values({
    id,
    runId: v.runId,
    employeeId: v.employeeId,
    referenceEnc: fieldCrypto().encrypt(v.reference, referenceContext(id)),
    paidOn: v.paidOn,
    markedBy: actor.id,
    // The statement clock, not the transaction start: of two writers the later lock holder must also have the later time.
    createdAt: sql`clock_timestamp()` as unknown as Date,
  });
  await writeAudit(
    {
      actor,
      action: "payroll.payment.mark",
      targetType: "pay_run",
      targetId: v.runId,
      metadata: { employeeId: v.employeeId, correction },
    },
    tx,
  );
  await logChange(tx, actor, {
    action: "payment_marked",
    runId: v.runId,
    employeeId: v.employeeId,
    detail: { paidOn: v.paidOn, correction },
  });

  let runPaid = false;
  if (run.status === "approved") {
    const paid = await latestPayments(tx, v.runId);
    if (people.every((p) => paid.has(p))) {
      await tx.update(payRuns).set({ status: "paid" }).where(eq(payRuns.id, v.runId));
      await writeAudit(
        {
          actor,
          action: "payroll.run.paid",
          targetType: "pay_run",
          targetId: v.runId,
          metadata: { people: people.length },
        },
        tx,
      );
      await logChange(tx, actor, {
        action: "run_paid",
        runId: v.runId,
        detail: { people: people.length },
      });
      // The statements carry whoever signs them today, kept with the run so they never change afterwards.
      await freezeRunSignatory(tx, v.runId, payrollToday());
      await notifyPayslipsReady(tx, v.runId);
      runPaid = true;
    }
  }
  return { runPaid };
}
