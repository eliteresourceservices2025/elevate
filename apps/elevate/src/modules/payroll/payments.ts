import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { toCsv } from "@/lib/csv";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { employeeSensitive } from "@/modules/people/schema";
import { sensitiveContext } from "@/modules/people/sensitive";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { readRun, type Executor } from "./runs";
import { buildRemitlyRows, personName, REMITLY_HEADER, REMITLY_TEST_NOTE, type PayoutDetails } from "./remitly";
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

/**
 * Who has payout details on file and what they are. A REAL run reads them in full (decrypted, each bound to its own person); a TEST run
 * reads only the masks stored at write time and decrypts nothing, so a practice file never holds a full account number. A person
 * with any of the three parts missing is "not on file" and gets blank cells. A value that can't be decrypted refuses the file.
 */
async function payoutDetailsFor(tx: Tx, employeeIds: string[], full: boolean): Promise<Map<string, PayoutDetails>> {
  const out = new Map<string, PayoutDetails>();
  if (employeeIds.length === 0) return out;
  const rows = await tx
    .select({
      id: employeeSensitive.employeeId,
      masks: employeeSensitive.masks,
      bankNameEnc: employeeSensitive.bankNameEnc,
      bankAccountNameEnc: employeeSensitive.bankAccountNameEnc,
      bankAccountNumberEnc: employeeSensitive.bankAccountNumberEnc,
    })
    .from(employeeSensitive)
    .where(inArray(employeeSensitive.employeeId, employeeIds));
  for (const r of rows) {
    if (!full) {
      if (r.masks.bankName && r.masks.bankAccountName && r.masks.bankAccountNumber) out.set(r.id, { bankName: r.masks.bankName, accountName: r.masks.bankAccountName, accountNumber: r.masks.bankAccountNumber });
      continue;
    }
    if (!r.bankNameEnc || !r.bankAccountNameEnc || !r.bankAccountNumberEnc) continue;
    try {
      const crypto = fieldCrypto();
      out.set(r.id, {
        bankName: crypto.decrypt(r.bankNameEnc, sensitiveContext("bankName", r.id)),
        accountName: crypto.decrypt(r.bankAccountNameEnc, sensitiveContext("bankAccountName", r.id)),
        accountNumber: crypto.decrypt(r.bankAccountNumberEnc, sensitiveContext("bankAccountNumber", r.id)),
      });
    } catch (error) {
      console.error("payroll payout details unreadable:", { employeeId: r.id, error: error instanceof Error ? error.name : "UnknownError" });
      throw new ActionFailure("Someone's payout details can't be read, so the list can't be built. Tell the system owner.");
    }
  }
  return out;
}

/**
 * Builds the Remitly list for an approved (or paid) run: one row per person with pesos and payout details. Refused before approval and for
 * a cancelled run. A real run carries the full bank details (an audited sensitive read: field names and a count, never a value); a test
 * run carries masked details and a TEST note. `missingDetails` counts people with nothing on file.
 */
export async function remitlyList(
  tx: Tx,
  actor: Actor,
  runId: string,
): Promise<{ fileName: string; csv: string; rows: number; missingDetails: number; test: boolean }> {
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
  const test = run.isTest;
  const details = await payoutDetailsFor(tx, [...new Set(lines.map((l) => l.employeeId))], !test);
  const built = buildRemitlyRows(lines, details);
  const missingDetails = built.filter((r) => !details.has(r.employeeId)).length;
  const csv = toCsv(
    test ? [...REMITLY_HEADER, "Note"] : [...REMITLY_HEADER],
    built.map((r) => [r.name, r.aliases, r.pesos, r.bankName, r.accountName, r.accountNumber, ...(test ? [REMITLY_TEST_NOTE] : [])]),
  );

  await writeAudit(
    {
      actor,
      action: "payroll.remitly.export",
      targetType: "pay_run",
      targetId: runId,
      metadata: { rows: built.length, lines: lines.length, ...(test ? { test: true } : {}) },
    },
    tx,
  );
  // The full bank details of a real run are a sensitive read: one row, the field names and how many people, never a value.
  if (!test && details.size > 0) {
    await writeAudit({ actor, action: "sensitive.view", targetType: "pay_run", targetId: runId, metadata: { fields: ["bankName", "bankAccountName", "bankAccountNumber"], people: details.size } }, tx);
  }
  await logChange(tx, actor, { action: "list_exported", runId, detail: { rows: built.length } });
  return {
    fileName: `remitly-${test ? "TEST-" : ""}${run.periodStart}-to-${run.periodEnd}.csv`,
    csv,
    rows: built.length,
    missingDetails,
    test,
  };
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
      .where(and(eq(payRunLines.runId, v.runId), eq(payRunLines.excluded, false)))
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
      runPaid = true;
    }
  }
  return { runPaid };
}
