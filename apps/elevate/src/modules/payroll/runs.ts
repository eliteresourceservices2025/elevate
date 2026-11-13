import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { approvalKey, attendanceRows, dayState, latestApprovals } from "@/modules/attendance/hours-service";
import { periodContaining } from "@/modules/attendance/pay-periods";
import { users } from "@/modules/core/schema";
import { clients, employeeSensitive, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { calculateLine, EXTRA_KEYS, type ExtraKey, type SettingsSnapshot } from "./calculate";
import { logChange } from "./changes";
import { runChecks, type CheckLine, type ChecksInput, type RunCheck } from "./checks";
import { CORRECTION_TYPES, isItemized, PAY_ITEM_LABELS, REASON_REQUIRED_TYPES, type PayItemState, type PayItemType, type RunStatus } from "./constants";
import { buildLineInput, cleanItemLabel, formatItemValue, noItemizedLines, parseItemValue, type ItemizedLines } from "./items";
import { resolveLines } from "./lines";
import { formatPesos } from "./money";
import { payLines, payRunItems, payRunLines, payRuns } from "./schema";
import {
  assertNotOwnEmployee,
  decryptItemValue,
  decryptLineAmounts,
  decryptRunLine,
  employeeIdForUser,
  encryptItemValue,
  encryptRunLine,
  lockDraftRun,
  payloadText,
  payrollToday,
  settingsInForce,
  withOtOverride,
  type ItemValue,
  type RunLinePayload,
} from "./service";

// Draft runs: building the lines, entering items, recomputing. Everything here takes the acting user or a transaction as a parameter,
// so it is called only from actions that have already run requireUser() and authorize(). Amounts never go into audit rows or logs.

type Reader = Pick<typeof db, "select">;
type Actor = { id: string; email: string };

/** Key order does not matter once a value has been through jsonb, so snapshots are compared this way. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

const nameOf = (r: { preferred: string | null; first: string; last: string }) => `${r.preferred?.trim() || r.first} ${r.last}`;

// ---- Items ----

export type ItemRow = typeof payRunItems.$inferSelect;
/** One item per line and type, except the itemized types (allowance, reimbursement, bonus, adjustment), where each named line has its own key. */
export const itemKey = (i: { runLineId: string | null; employeeId: string; type: string; itemKey?: string | null }) =>
  `${i.runLineId ?? `u:${i.employeeId}`}|${i.type}|${i.itemKey ?? ""}`;

/** The newest row for each line, type and (for itemized types) named line: a loan on one line never replaces another line's. Unassigned rows are keyed by person. */
export async function latestItems(executor: Reader, runId: string): Promise<ItemRow[]> {
  const rows = await executor.select().from(payRunItems).where(eq(payRunItems.runId, runId)).orderBy(asc(payRunItems.createdAt));
  const newest = new Map<string, ItemRow>();
  for (const row of rows) newest.set(itemKey(row), row);
  return [...newest.values()];
}

/** What a line's confirmed items come to: one value per plain type, and the named lines of the itemized types, in the order they were added. */
type Confirmed = { values: Map<PayItemType, bigint>; itemized: ItemizedLines };
const noConfirmed = (): Confirmed => ({ values: new Map(), itemized: noItemizedLines() });

function confirmedValues(items: ItemRow[], runLineId: string): Confirmed {
  const out = noConfirmed();
  for (const item of items) {
    if (item.runLineId !== runLineId || item.state !== "confirmed") continue;
    try {
      const v = decryptItemValue(item.id, item.valueEnc);
      if (isItemized(item.type)) out.itemized[item.type].push({ label: v.label ?? PAY_ITEM_LABELS[item.type], amount: v.value });
      else out.values.set(item.type as PayItemType, v.value);
    } catch (error) {
      console.error("payroll item unreadable:", { itemId: item.id, error: error instanceof Error ? error.name : "UnknownError" });
      throw new ActionFailure("An amount on this run can't be read. This usually means a problem with the encryption key.");
    }
  }
  return out;
}

// ---- Computing a line ----

function computePayload(line: { hoursPerDay: number }, rate: RunLinePayload["rate"], confirmed: Confirmed, settings: SettingsSnapshot): RunLinePayload {
  const { input, clientHoursHundredths } = buildLineInput(rate, line.hoursPerDay, confirmed.values, confirmed.itemized);
  return { rate, hoursPerDay: line.hoursPerDay, input, clientHoursHundredths, result: calculateLine(input, { ...settings, multipliersBp: withOtOverride(settings.multipliersBp, rate.otBp) }) };
}

function readRate(lineId: string, stored: string) {
  try {
    return decryptLineAmounts(lineId, stored);
  } catch (error) {
    console.error("payroll rate unreadable:", { lineId, error: error instanceof Error ? error.name : "UnknownError" });
    throw new ActionFailure("A pay line can't be read. This usually means a problem with the encryption key. Tell the system owner.");
  }
}

/**
 * Rereads the settings in force for the period and recomputes the lines of a draft run (all of them, or only one person's when the
 * settings did not change). A line whose figures changed loses its confirmation, as does every line named in `clearConfirmationFor`.
 * Call inside the transaction of the change, after `lockDraftRun`.
 */
export async function recomputeRun(tx: Tx, runId: string, options: { employeeId?: string; clearConfirmationFor?: string[] } = {}): Promise<{ changedLineIds: string[] }> {
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  if (!run) throw new ActionFailure("That pay run was not found.");
  if (run.status !== "draft") throw new ActionFailure("This run is no longer a draft, so it can't be changed.");

  const settings = await settingsInForce(tx, run.periodStart);
  const settingsChanged = canon(settings) !== canon(run.settingsSnapshot);
  if (settingsChanged) await tx.update(payRuns).set({ settingsSnapshot: settings }).where(eq(payRuns.id, runId));

  const scoped = options.employeeId && !settingsChanged ? options.employeeId : null;
  const rows = await tx
    .select({ runLine: payRunLines, version: payLines })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .where(scoped ? and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false), eq(payRunLines.employeeId, scoped)) : and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)));

  const items = await latestItems(tx, runId);
  const forceClear = new Set(options.clearConfirmationFor ?? []);
  const changedLineIds: string[] = [];

  for (const { runLine, version } of rows) {
    const rate = readRate(version.id, version.amountsEnc);
    const next = computePayload(version, rate, confirmedValues(items, runLine.id), settings);
    let before: string | null = null;
    try {
      before = payloadText(decryptRunLine(runLine.id, runLine.payloadEnc));
    } catch (error) {
      console.error("payroll run line unreadable:", { runLineId: runLine.id, error: error instanceof Error ? error.name : "UnknownError" });
      before = null; // unreadable before: rewritten now
    }
    const changed = before !== payloadText(next);
    if (!changed && !forceClear.has(runLine.id)) continue;
    await tx
      .update(payRunLines)
      .set({ payloadEnc: encryptRunLine(runLine.id, next), ...(changed || forceClear.has(runLine.id) ? { confirmedBy: null, confirmedAt: null } : {}) })
      .where(eq(payRunLines.id, runLine.id));
    changedLineIds.push(runLine.id);
  }
  return { changedLineIds };
}

// ---- Creating a run ----

const NOT_A_CUTOFF = "A pay run covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month. (A test run can cover any dates, up to 31 days.)";

/** Throws when another real (not test, not cancelled) run already covers any part of the period. */
async function refuseOverlap(tx: Tx, period: { periodStart: string; periodEnd: string }): Promise<void> {
  const [clash] = await tx
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd })
    .from(payRuns)
    .where(and(ne(payRuns.status, "cancelled"), eq(payRuns.isTest, false), lte(payRuns.periodStart, period.periodEnd), gte(payRuns.periodEnd, period.periodStart)))
    .limit(1);
  if (!clash) return;
  const same = clash.periodStart === period.periodStart && clash.periodEnd === period.periodEnd;
  throw new ActionFailure(
    same
      ? `There is already a pay run for ${period.periodStart} to ${period.periodEnd}. To repeat the cycle, mark that run as a test run and archive it, or make this one a test run.`
      : `That period overlaps the pay run for ${clash.periodStart} to ${clash.periodEnd}. Pay runs can't overlap.`,
  );
}

/** True when the period is exactly one cutoff (1st to 15th, or 16th to the end of the month), whatever the hours export uses. */
function isCutoff(period: { periodStart: string; periodEnd: string }): boolean {
  const cutoff = periodContaining("semi_monthly", period.periodStart);
  return cutoff.start === period.periodStart && cutoff.end === period.periodEnd;
}

/**
 * Builds a draft run for a period: one line for each pay line in force. The calculator always pays half a month, so only one cutoff
 * is accepted (never the company's hours pay-period setting). Refuses any period that overlaps an existing real run. A test run (a practice
 * run, `test: true`) may repeat a period that already has a run: it is the way to rehearse the same pay cycle again.
 */
export async function createRun(tx: Tx, actor: Actor, period: { periodStart: string; periodEnd: string }, options: { test?: boolean } = {}): Promise<{ runId: string; lineCount: number }> {
  const test = options.test === true;
  // A real run is exactly one cutoff. A TEST run may cover any dates (up to 31 days, checked by the schema): a part of a cutoff, or the dates of a
  // file you want to rehearse with. Its base pay is still a full cutoff unless the days worked are entered as amounts.
  if (!test && !isCutoff(period)) throw new ActionFailure(NOT_A_CUTOFF);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pay_runs'))`);
  if (!test) await refuseOverlap(tx, period);

  const settings = await settingsInForce(tx, period.periodStart);
  const all = await tx
    .select({ line: payLines, status: employees.status, archivedAt: employees.archivedAt })
    .from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId));
  const person = new Map(all.map((r) => [r.line.employeeId, r]));
  const resolved = resolveLines(all.map((r) => r.line), { start: period.periodStart, end: period.periodEnd });
  if (resolved.length === 0) {
    // Say why: a line counts for a run only when it starts on or before the run's last day and has not ended before its first day.
    const starts = all.map((r) => r.line.effectiveFrom).sort();
    if (starts.length === 0) throw new ActionFailure("Nobody has a pay line yet. Add pay lines on the Rates tab first.");
    if (starts[0] > period.periodEnd) {
      throw new ActionFailure(
        `No pay line was in force between ${period.periodStart} and ${period.periodEnd}: the earliest one starts on ${starts[0]}. Choose a later period, or change the pay line's start date on the Rates tab.`,
      );
    }
    throw new ActionFailure(`Every pay line had ended before ${period.periodStart}. Choose a later period, or add a new pay line on the Rates tab.`);
  }

  const runId = randomUUID();
  const prepared = resolved.map(({ version, flags }) => {
    const rate = readRate(version.id, version.amountsEnc);
    const who = person.get(version.employeeId);
    const lineFlags: string[] = [...flags];
    if (who && (who.status === "separated" || who.archivedAt !== null)) lineFlags.push("person_left");
    const id = randomUUID();
    return {
      id,
      runId,
      lineId: version.id,
      employeeId: version.employeeId,
      clientId: version.clientId,
      alias: version.alias,
      flags: lineFlags,
      payloadEnc: encryptRunLine(id, computePayload(version, rate, noConfirmed(), settings)),
    };
  });

  await tx.insert(payRuns).values({ id: runId, periodStart: period.periodStart, periodEnd: period.periodEnd, status: "draft", settingsSnapshot: settings, createdBy: actor.id, isTest: test });
  await tx.insert(payRunLines).values(prepared);
  await writeAudit({ actor, action: "payroll.run.create", targetType: "pay_run", targetId: runId, metadata: { lines: prepared.length, ...(test ? { test: true } : {}) } }, tx);
  await logChange(tx, actor, { action: "run_created", runId, detail: { periodStart: period.periodStart, periodEnd: period.periodEnd, lines: prepared.length, ...(test ? { test: true } : {}) } });
  return { runId, lineCount: prepared.length };
}

/** Which version of which pay line applies to a period, with its flags: what a run built now would contain. */
async function linesNowInForce(executor: Reader, period: { start: string; end: string }): Promise<Set<string>> {
  const all = await executor.select().from(payLines);
  return new Set(resolveLines(all, period).map((r) => `${r.version.id}|${[...r.flags].sort().join(",")}`));
}

/** Cancels a draft run. The run stays on record, frozen; its period is free for a new run. */
export async function cancelRun(tx: Tx, actor: Actor, v: { runId: string; reason: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(payRunLines).where(eq(payRunLines.runId, v.runId));
  await tx.update(payRuns).set({ status: "cancelled" }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: "payroll.run.cancel", targetType: "pay_run", targetId: v.runId, metadata: { lines: n } }, tx);
  await logChange(tx, actor, { action: "run_cancelled", runId: v.runId, detail: { reason: v.reason, lines: n } });
}

// ---- Test runs ----

const lockRun = async (tx: Tx, runId: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pay_runs'))`);
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
  if (!run) throw new ActionFailure("That pay run was not found.");
  return run;
};

/**
 * Marks a run as a test run (a practice run), or makes it a real run again. A run can be marked until it is paid (a paid run is a real
 * payout and is never hidden); it can be made real again only while it is a draft, and only if no other real run has its period.
 */
export async function setRunTest(tx: Tx, actor: Actor, v: { runId: string; test: boolean; reason: string }): Promise<void> {
  const run = await lockRun(tx, v.runId);
  if (run.isTest === v.test) throw new ActionFailure(v.test ? "This run is already a test run." : "This run is already a real run.");
  if (run.status === "paid" || run.status === "cancelled") throw new ActionFailure(`A ${run.status} run can't be changed.`);
  if (!v.test) {
    if (run.status !== "draft") throw new ActionFailure("A test run can be made a real run again only while it is a draft.");
    if (run.archivedAt) throw new ActionFailure("Restore this run first.");
    // A real run is exactly one cutoff: a test run made for other dates can only stay a test run.
    if (!isCutoff({ periodStart: run.periodStart, periodEnd: run.periodEnd })) throw new ActionFailure(NOT_A_CUTOFF);
    await refuseOverlap(tx, { periodStart: run.periodStart, periodEnd: run.periodEnd });
  }
  await tx.update(payRuns).set({ isTest: v.test }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: v.test ? "payroll.run.mark_test" : "payroll.run.mark_real", targetType: "pay_run", targetId: v.runId, metadata: { status: run.status } }, tx);
  await logChange(tx, actor, { action: v.test ? "run_marked_test" : "run_marked_real", runId: v.runId, detail: { reason: v.reason, status: run.status } });
}

/**
 * Archives a test run in any status (paid included), or a cancelled run (never approved, never paid): it leaves the lists but stays on record.
 * A real run that is draft, in review, approved or paid can never be archived.
 */
export async function archiveRun(tx: Tx, actor: Actor, v: { runId: string; reason: string }): Promise<void> {
  const run = await lockRun(tx, v.runId);
  if (!run.isTest && run.status !== "cancelled") throw new ActionFailure("Only a test run or a cancelled run can be archived. Mark it as a test run first.");
  if (run.archivedAt) throw new ActionFailure("This run is already archived.");
  await tx.update(payRuns).set({ archivedAt: new Date(), archivedBy: actor.id }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: "payroll.run.archive", targetType: "pay_run", targetId: v.runId, metadata: { status: run.status } }, tx);
  await logChange(tx, actor, { action: "run_archived", runId: v.runId, detail: { reason: v.reason, status: run.status } });
}

/** Brings an archived test run back into the lists. */
export async function restoreRun(tx: Tx, actor: Actor, v: { runId: string }): Promise<void> {
  const run = await lockRun(tx, v.runId);
  if (!run.archivedAt) throw new ActionFailure("This run is not archived.");
  await tx.update(payRuns).set({ archivedAt: null, archivedBy: null }).where(eq(payRuns.id, v.runId));
  await writeAudit({ actor, action: "payroll.run.restore", targetType: "pay_run", targetId: v.runId, metadata: { status: run.status } }, tx);
  await logChange(tx, actor, { action: "run_restored", runId: v.runId, detail: { status: run.status } });
}

/** What a permanent delete removed, and what is archived but had to stay (a run with a real or still-live invoice, an invoice a kept one was replaced by). */
export type PurgeResult = { runsDeleted: number; invoicesDeleted: number; runsKept: number; invoicesKept: number };

/**
 * Deletes archived test runs and archived cancelled runs for good, with their lines, payments, history and test invoices. Never a real run
 * that was approved or paid, never a real invoice, never anything not archived. The database function picks the rows and is the only place
 * the append-only protections let a delete through; the audit entry carries counts only.
 */
export async function purgeArchivedRuns(tx: Tx, actor: Actor): Promise<PurgeResult> {
  return purgeArchived(tx, actor, { runs: true, invoices: false }, "payroll.run.purge");
}

export async function purgeArchived(tx: Tx, actor: Actor, scope: { runs: boolean; invoices: boolean }, action: string): Promise<PurgeResult> {
  const res = await tx.execute(sql`select * from payroll.purge_archived_test_data(${scope.runs}, ${scope.invoices})`);
  const row = (res as unknown as Array<{ runs_deleted: number; invoices_deleted: number; runs_kept: number; invoices_kept: number }>)[0];
  const out: PurgeResult = { runsDeleted: row.runs_deleted, invoicesDeleted: row.invoices_deleted, runsKept: row.runs_kept, invoicesKept: row.invoices_kept };
  await writeAudit({ actor, action, targetType: "pay_run", metadata: { ...out } }, tx);
  return out;
}

// ---- Changing a draft run ----

const itemDetail = (row: ItemRow | undefined) => {
  if (!row) return null;
  const v = decryptItemValue(row.id, row.valueEnc);
  return { state: row.state, value: v.value.toString(), reason: v.reason, ...(v.label ? { label: v.label } : {}), ...(v.correctsRunId ? { correctsRunId: v.correctsRunId } : {}) };
};


/**
 * An approved run never changes: a mistake in it is fixed on a later run by an adjustment (underpaid) or an other deduction (overpaid)
 * that names it; amounts stay positive. Refuses any other type, any run that is not an approved or paid run with an earlier period,
 * and a person who had no line on that run.
 */
async function checkCorrection(tx: Tx, v: { runId: string; employeeId: string; type: PayItemType }, correctsRunId: string): Promise<void> {
  if (!CORRECTION_TYPES.includes(v.type)) throw new ActionFailure("Only an adjustment or another deduction can correct an earlier run.");
  const [run] = await tx.select({ periodStart: payRuns.periodStart, isTest: payRuns.isTest }).from(payRuns).where(eq(payRuns.id, v.runId)).limit(1);
  const [target] = await tx
    .select({ id: payRuns.id })
    .from(payRuns)
    .where(and(eq(payRuns.id, correctsRunId), inArray(payRuns.status, ["approved", "paid"]), eq(payRuns.isTest, run?.isTest ?? false), isNull(payRuns.archivedAt), lt(payRuns.periodStart, run?.periodStart ?? "0000-01-01")))
    .limit(1);
  if (!target) throw new ActionFailure("A correction must name an approved or paid earlier run.");
  const [had] = await tx
    .select({ id: payRunLines.id })
    .from(payRunLines)
    .where(and(eq(payRunLines.runId, correctsRunId), eq(payRunLines.excluded, false), eq(payRunLines.employeeId, v.employeeId)))
    .limit(1);
  if (!had) throw new ActionFailure("That person had no line on the run being corrected.");
}

/** The newest suggested value for this type on this line, or the person's unassigned one, in the full item history; null when there never was one. */
export async function suggestedValue(tx: Tx, runId: string, employeeId: string, runLineId: string | null, type: string): Promise<bigint | null> {
  const [row] = await tx
    .select()
    .from(payRunItems)
    .where(
      and(
        eq(payRunItems.runId, runId),
        eq(payRunItems.employeeId, employeeId),
        eq(payRunItems.type, type),
        eq(payRunItems.state, "suggested"),
        runLineId ? or(eq(payRunItems.runLineId, runLineId), isNull(payRunItems.runLineId)) : isNull(payRunItems.runLineId),
      ),
    )
    .orderBy(desc(payRunItems.createdAt))
    .limit(1);
  return row ? decryptItemValue(row.id, row.valueEnc).value : null;
}

/**
 * Confirms an amount for one line (or overrides a suggestion). Reasons are required for deductions, for overriding a suggestion and
 * for a correction of an earlier run (`correctsRunId`, adjustments and other deductions only).
 */
export async function saveItem(
  tx: Tx,
  actor: Actor,
  v: { runId: string; employeeId: string; runLineId: string; type: PayItemType; value: string; label?: string; itemKey?: string; reason?: string; correctsRunId?: string },
): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [line] = await tx
    .select({ id: payRunLines.id, lineId: payRunLines.lineId })
    .from(payRunLines)
    .where(and(eq(payRunLines.id, v.runLineId), eq(payRunLines.runId, v.runId), eq(payRunLines.excluded, false), eq(payRunLines.employeeId, v.employeeId)))
    .limit(1);
  if (!line) throw new ActionFailure("That line is not on this run.");
  const value = parseItemValue(v.type, v.value);
  if (value === null) throw new ActionFailure("Check the amount and try again.");
  const correctsRunId = v.correctsRunId ?? null;
  if (correctsRunId) await checkCorrection(tx, v, correctsRunId);

  // An itemized line (allowance, reimbursement, bonus, adjustment) has a name and its own key; changing one keeps its key.
  let label: string | null = null;
  let key: string | null = null;
  if (isItemized(v.type)) {
    label = cleanItemLabel(v.label ?? "");
    if (label === null) throw new ActionFailure("Give this line a name.");
    key = v.itemKey ?? randomUUID();
  } else if (v.label || v.itemKey) {
    throw new ActionFailure("Only allowances, reimbursements, bonuses and adjustments have a name.");
  }

  const all = await latestItems(tx, v.runId);
  const prior = all.find((i) => itemKey(i) === itemKey({ runLineId: v.runLineId, employeeId: v.employeeId, type: v.type, itemKey: key }));
  if (v.itemKey && !prior) throw new ActionFailure("That line was not found. Reload the page and try again.");
  // A line that was removed stays removed: a stale screen must not quietly bring it back (add it again as a new line instead).
  if (v.itemKey && prior?.state === "dismissed") throw new ActionFailure("That line was removed. Add it again as a new line.");
  // Compared with the newest suggestion in the whole history, not just the latest row: confirming the suggested value and then
  // changing it must still need a reason.
  const suggested = await suggestedValue(tx, v.runId, v.employeeId, v.runLineId, v.type);
  const overriding = suggested !== null && suggested !== value;
  const reason = v.reason?.trim() || null;
  if ((REASON_REQUIRED_TYPES.includes(v.type) || overriding || correctsRunId) && !reason) throw new ActionFailure("Give a reason for this amount.");

  const id = randomUUID();
  await tx.insert(payRunItems).values({
    id,
    runId: v.runId,
    employeeId: v.employeeId,
    runLineId: v.runLineId,
    type: v.type,
    itemKey: key,
    state: "confirmed",
    valueEnc: encryptItemValue(id, { value, ...(label ? { label } : {}), reason, ...(correctsRunId ? { correctsRunId } : {}) }),
    enteredBy: actor.id,
    createdAt: sql`clock_timestamp()`,
  });
  await recomputeRun(tx, v.runId, { employeeId: v.employeeId, clearConfirmationFor: [v.runLineId] });
  await writeAudit(
    { actor, action: "payroll.item.save", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: v.employeeId, type: v.type, ...(correctsRunId ? { correctsRunId } : {}) } },
    tx,
  );
  await logChange(tx, actor, {
    action: "item_saved",
    runId: v.runId,
    employeeId: v.employeeId,
    detail: {
      runLineId: v.runLineId,
      type: v.type,
      ...(correctsRunId ? { correctsRunId } : {}),
      old: itemDetail(prior),
      new: { state: "confirmed", value: value.toString(), reason, ...(label ? { label } : {}), ...(correctsRunId ? { correctsRunId } : {}) },
    },
  });
}

/** Takes an amount off a line: a new row in the "dismissed" state, so the history keeps the old one. */
export async function dismissItem(tx: Tx, actor: Actor, v: { runId: string; itemId: string; reason?: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [item] = await tx.select().from(payRunItems).where(and(eq(payRunItems.id, v.itemId), eq(payRunItems.runId, v.runId))).limit(1);
  if (!item) throw new ActionFailure("That amount was not found.");
  const latest = (await latestItems(tx, v.runId)).find((i) => itemKey(i) === itemKey(item));
  if (latest?.id !== item.id) throw new ActionFailure("That amount has changed. Reload the page and try again.");
  if (item.state === "dismissed") throw new ActionFailure("That amount is already removed.");

  const reason = v.reason?.trim() || null;
  const hadSuggestion = item.state === "suggested" || (await suggestedValue(tx, v.runId, item.employeeId, item.runLineId, item.type)) !== null;
  if ((REASON_REQUIRED_TYPES.includes(item.type as PayItemType) || hadSuggestion) && !reason) throw new ActionFailure("Give a reason for removing this amount.");

  const old = decryptItemValue(item.id, item.valueEnc);
  const id = randomUUID();
  await tx.insert(payRunItems).values({
    id,
    runId: v.runId,
    employeeId: item.employeeId,
    runLineId: item.runLineId,
    type: item.type,
    itemKey: item.itemKey,
    state: "dismissed" satisfies PayItemState,
    valueEnc: encryptItemValue(id, { value: old.value, ...(old.label ? { label: old.label } : {}), reason }),
    enteredBy: actor.id,
    createdAt: sql`clock_timestamp()`,
  });
  await recomputeRun(tx, v.runId, { employeeId: item.employeeId, clearConfirmationFor: item.runLineId ? [item.runLineId] : [] });
  await writeAudit({ actor, action: "payroll.item.dismiss", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: item.employeeId, type: item.type } }, tx);
  await logChange(tx, actor, {
    action: "item_dismissed",
    runId: v.runId,
    employeeId: item.employeeId,
    detail: { runLineId: item.runLineId, type: item.type, old: itemDetail(item), reason },
  });
}

/** Records that someone other than the line's owner checked the line. A later change to the line clears it. */
export async function confirmLine(tx: Tx, actor: Actor, runLineId: string): Promise<void> {
  const [found] = await tx.select({ runId: payRunLines.runId }).from(payRunLines).where(eq(payRunLines.id, runLineId)).limit(1);
  if (!found) throw new ActionFailure("That line was not found.");
  await lockDraftRun(tx, found.runId);
  const [line] = await tx.select().from(payRunLines).where(eq(payRunLines.id, runLineId)).limit(1);
  if (!line || line.excluded) throw new ActionFailure("That line was not found.");
  await assertNotOwnEmployee(actor, line.employeeId, tx);
  try {
    decryptRunLine(line.id, line.payloadEnc);
  } catch (error) {
    console.error("payroll run line unreadable:", { runLineId: line.id, error: error instanceof Error ? error.name : "UnknownError" });
    throw new ActionFailure("This line can't be read, so it can't be confirmed.");
  }
  await tx.update(payRunLines).set({ confirmedBy: actor.id, confirmedAt: new Date() }).where(eq(payRunLines.id, runLineId));
  await writeAudit({ actor, action: "payroll.line.confirm", targetType: "pay_run", targetId: found.runId, metadata: { employeeId: line.employeeId } }, tx);
  await logChange(tx, actor, { action: "line_confirmed", runId: found.runId, employeeId: line.employeeId, detail: { runLineId } });
}

// ---- Who is on a draft run ----

/**
 * Brings a draft run up to date with the Rates tab, without creating another run: people whose pay line is now in force are added, a line
 * whose pay line has a newer version is moved to it (recomputed, and its check cleared), and a line whose pay line is no longer in force is
 * taken off. A person a Preparer removed on purpose stays removed (Restore puts them back). Settings are refreshed too.
 */
export async function syncRunPeople(tx: Tx, actor: Actor, runId: string): Promise<{ added: number; updated: number; removed: number }> {
  const run = await lockDraftRun(tx, runId);
  const settings = await settingsInForce(tx, run.periodStart);
  const all = await tx
    .select({ line: payLines, status: employees.status, archivedAt: employees.archivedAt })
    .from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId));
  const person = new Map(all.map((r) => [r.line.employeeId, r]));
  const resolved = resolveLines(all.map((r) => r.line), { start: run.periodStart, end: run.periodEnd });
  const existing = await tx
    .select({ runLine: payRunLines, lineKey: payLines.lineKey })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .where(eq(payRunLines.runId, runId));
  const byKey = new Map(existing.map((e) => [e.lineKey, e]));
  const inForce = new Set(resolved.map((r) => r.version.lineKey));
  const items = await latestItems(tx, runId);

  const flagsFor = (version: { employeeId: string }, flags: string[]) => {
    const out = [...flags];
    const who = person.get(version.employeeId);
    if (who && (who.status === "separated" || who.archivedAt !== null)) out.push("person_left");
    return out;
  };

  let added = 0;
  let updated = 0;
  let removed = 0;
  for (const { version, flags } of resolved) {
    const found = byKey.get(version.lineKey);
    const lineFlags = flagsFor(version, flags);
    if (!found) {
      const id = randomUUID();
      const rate = readRate(version.id, version.amountsEnc);
      await tx.insert(payRunLines).values({
        id,
        runId,
        lineId: version.id,
        employeeId: version.employeeId,
        clientId: version.clientId,
        alias: version.alias,
        flags: lineFlags,
        payloadEnc: encryptRunLine(id, computePayload(version, rate, noConfirmed(), settings)),
      });
      added += 1;
    } else if (found.runLine.excluded) {
      continue; // taken off on purpose: only Restore brings it back
    } else if (found.runLine.lineId !== version.id || canon([...found.runLine.flags].sort()) !== canon([...lineFlags].sort())) {
      const rate = readRate(version.id, version.amountsEnc);
      const payload = computePayload(version, rate, confirmedValues(items, found.runLine.id), settings);
      await tx
        .update(payRunLines)
        .set({ lineId: version.id, clientId: version.clientId, alias: version.alias, flags: lineFlags, payloadEnc: encryptRunLine(found.runLine.id, payload), confirmedBy: null, confirmedAt: null })
        .where(eq(payRunLines.id, found.runLine.id));
      updated += 1;
    }
  }
  for (const found of existing) {
    if (found.runLine.excluded || inForce.has(found.lineKey)) continue;
    await tx.update(payRunLines).set({ excluded: true, confirmedBy: null, confirmedAt: null }).where(eq(payRunLines.id, found.runLine.id));
    removed += 1;
  }
  await recomputeRun(tx, runId); // also refreshes the settings snapshot

  await writeAudit({ actor, action: "payroll.run.sync_people", targetType: "pay_run", targetId: runId, metadata: { added, updated, removed } }, tx);
  await logChange(tx, actor, { action: "run_people_synced", runId, detail: { added, updated, removed } });
  return { added, updated, removed };
}

/** Takes one person's line off a draft run. The line and its amounts stay on record (the history is append-only) and are ignored. */
export async function removeRunLine(tx: Tx, actor: Actor, v: { runId: string; runLineId: string; reason: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [line] = await tx
    .select()
    .from(payRunLines)
    .where(and(eq(payRunLines.id, v.runLineId), eq(payRunLines.runId, v.runId), eq(payRunLines.excluded, false)))
    .limit(1);
  if (!line) throw new ActionFailure("That line is not on this run.");
  await tx.update(payRunLines).set({ excluded: true, confirmedBy: null, confirmedAt: null }).where(eq(payRunLines.id, line.id));
  await writeAudit({ actor, action: "payroll.run.remove_line", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: line.employeeId } }, tx);
  await logChange(tx, actor, { action: "run_line_removed", runId: v.runId, employeeId: line.employeeId, detail: { runLineId: line.id, reason: v.reason } });
}

/** Puts a removed line back on the draft run, recomputed from its amounts, with its check cleared. */
export async function restoreRunLine(tx: Tx, actor: Actor, v: { runId: string; runLineId: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [line] = await tx
    .select()
    .from(payRunLines)
    .where(and(eq(payRunLines.id, v.runLineId), eq(payRunLines.runId, v.runId), eq(payRunLines.excluded, true)))
    .limit(1);
  if (!line) throw new ActionFailure("That line was not found.");
  await tx.update(payRunLines).set({ excluded: false, confirmedBy: null, confirmedAt: null }).where(eq(payRunLines.id, line.id));
  await recomputeRun(tx, v.runId, { employeeId: line.employeeId, clearConfirmationFor: [line.id] });
  await writeAudit({ actor, action: "payroll.run.restore_line", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: line.employeeId } }, tx);
  await logChange(tx, actor, { action: "run_line_restored", runId: v.runId, employeeId: line.employeeId, detail: { runLineId: line.id } });
}

// ---- Reading a run ----

export type WorksheetItem = {
  id: string;
  type: PayItemType;
  state: PayItemState;
  /** As typed: "1.5", "1,250.50". */
  value: string;
  /** The name of an itemized line ("Health allowance"); null for every other type. */
  label: string | null;
  /** Identifies an itemized line so it can be changed or removed; null for every other type. */
  itemKey: string | null;
  reason: string | null;
  /** An adjustment that corrects an earlier approved or paid run names that run. */
  correctsRunId: string | null;
};

export type WorksheetFigures = {
  monthly: string;
  cutoff: string;
  base: string;
  absences: string;
  sickLeave: string;
  /** Paid days, as typed ("2", "0.5"); they change no amount. */
  bereavementDays: string;
  ptoDays: string;
  late: string;
  extra: Record<ExtraKey, string>;
  allowances: string;
  gross: string;
  reimbursements: string;
  bonuses: string;
  adjustments: string;
  loan: string;
  otherDeductions: string;
  /** Total payable compensation. */
  net: string;
  clientHours: string;
  /** Total payable minus the same line's total in the last approved or paid run ("+1,250.00"); null when there is none to compare with. */
  netChange: string | null;
};

export type WorksheetLine = {
  runLineId: string;
  employeeId: string;
  name: string;
  isOwn: boolean;
  clientId: string | null;
  clientName: string | null;
  alias: string | null;
  hoursPerDay: number;
  flags: string[];
  /** The stored figures or an amount on the line could not be decrypted. */
  unreadable: boolean;
  confirmedByName: string | null;
  confirmedByMe: boolean;
  figures: WorksheetFigures | null;
  items: WorksheetItem[];
};

export type ClientTotals = { clientId: string | null; clientName: string; lines: number; clientHours: string; net: string };

export type Worksheet = {
  run: { id: string; periodStart: string; periodEnd: string; status: RunStatus; isTest: boolean; archivedAt: string | null };
  lines: WorksheetLine[];
  /** Suggestions no pay line has been chosen for. */
  unassigned: { employeeId: string; name: string; items: WorksheetItem[] }[];
  /** Null when any line can't be read: a partial total is never shown. All in pesos. */
  totals: { gross: string; net: string } | null;
  byClient: ClientTotals[] | null;
  checks: { blocking: RunCheck[]; warnings: RunCheck[] };
  /** True when the "own line" check above is about the viewer (a Preparer about to send the run); otherwise it is about the submitter. */
  checksAreMine: boolean;
  unreadableCount: number;
  /** Approved or paid earlier runs a correction on this draft may name, newest first. */
  correctableRuns: { id: string; label: string }[];
  /** People taken off this draft run, who can be put back. */
  removed: { runLineId: string; name: string; alias: string | null }[];
};

/** Finished days in the period with hours that are not approved (or changed after approval), for each person. Reads through the attendance module. */
export async function unapprovedDaysByPerson(executor: Executor, employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;
  const today = payrollToday();
  const days = await attendanceRows(executor, employeeIds, from, to);
  const approvals = await latestApprovals(executor, employeeIds, from, to);
  for (const d of days) {
    if (!(d.sessions > 0 || d.scheduledMinutes !== null) || d.date >= today) continue;
    if (dayState(d, approvals.get(approvalKey(d.employeeId, d.date))) === "approved") continue;
    out.set(d.employeeId, (out.get(d.employeeId) ?? 0) + 1);
  }
  return out;
}

/** Who has payout details on file, from the stored masks only. Nothing is decrypted. */
async function payoutReady(executor: Reader, employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rows = await executor.select({ id: employeeSensitive.employeeId, masks: employeeSensitive.masks }).from(employeeSensitive).where(inArray(employeeSensitive.employeeId, employeeIds));
  return new Set(rows.filter((r) => r.masks.bankName && r.masks.bankAccountName && r.masks.bankAccountNumber).map((r) => r.id));
}

const signedPesos = (n: bigint) => (n > 0n ? `+${formatPesos(n)}` : formatPesos(n));

/** Reads with `select` and runs raw SQL (the attendance module's readers need both). A transaction qualifies. */
export type Executor = Pick<typeof db, "select" | "selectDistinct" | "execute">;

type RunRow = { runLine: typeof payRunLines.$inferSelect; lineKey: string; first: string; last: string; preferred: string | null; userId: string | null; clientName: string | null };

/** Everything about a run, decrypted once, for the worksheet, the checks before review and the approval hash. */
export type RunData = {
  run: typeof payRuns.$inferSelect;
  rows: RunRow[];
  /** People taken off this draft run (their lines are kept but ignored). */
  removedLines: { runLineId: string; employeeId: string; name: string; alias: string | null }[];
  /** The newest item per line and type. */
  items: ItemRow[];
  /** Every item row the run has ever had (the history is append-only, so a new row always shows here). */
  itemIds: string[];
  /** Decrypted line payloads; null when a line can't be read. */
  payloads: Map<string, RunLinePayload | null>;
  /** Decrypted newest items; null when one can't be read. */
  values: Map<string, ItemValue | null>;
  previousNets: Map<string, bigint>;
  linesOutOfDate: boolean;
  unapproved: Map<string, number>;
  ready: Set<string>;
};

/**
 * Reads and decrypts a run, or null when there is no such run. A line or amount that can't be read is kept as null (the line id and the
 * error class are logged, never a figure) and blocks review. The caller has already authorized.
 */
export async function readRun(executor: Executor, runId: string): Promise<RunData | null> {
  const [run] = await executor.select().from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  if (!run) return null;

  const rows = await executor
    .select({
      runLine: payRunLines,
      lineKey: payLines.lineKey,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
      userId: employees.userId,
      clientName: clients.name,
    })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .leftJoin(clients, eq(clients.id, payRunLines.clientId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias), asc(payRunLines.id));

  // People taken off this draft: listed so they can be restored, and not counted as "out of date".
  const removed = await executor
    .select({ runLine: payRunLines, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(payRunLines)
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, true)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias));
  const removedLines = removed.map((r) => ({ runLineId: r.runLine.id, employeeId: r.runLine.employeeId, name: nameOf(r), alias: r.runLine.alias }));

  const items = await latestItems(executor, runId);
  const itemIds = (await executor.select({ id: payRunItems.id }).from(payRunItems).where(eq(payRunItems.runId, runId))).map((r) => r.id).sort();
  const employeeIds = [...new Set(rows.map((r) => r.runLine.employeeId))];

  const payloads = new Map<string, RunLinePayload | null>();
  for (const r of rows) {
    try {
      payloads.set(r.runLine.id, decryptRunLine(r.runLine.id, r.runLine.payloadEnc));
    } catch (error) {
      console.error("payroll run line unreadable:", { runLineId: r.runLine.id, error: error instanceof Error ? error.name : "UnknownError" });
      payloads.set(r.runLine.id, null);
    }
  }
  const values = new Map<string, ItemValue | null>();
  for (const i of items) {
    try {
      values.set(i.id, decryptItemValue(i.id, i.valueEnc));
    } catch (error) {
      console.error("payroll item unreadable:", { itemId: i.id, error: error instanceof Error ? error.name : "UnknownError" });
      values.set(i.id, null);
    }
  }

  // The latest approved or paid earlier run (a draft is unreviewed), for the "net changed" check and the change column.
  const [previous] = await executor
    .select({ id: payRuns.id })
    .from(payRuns)
    .where(and(lt(payRuns.periodStart, run.periodStart), inArray(payRuns.status, ["approved", "paid"]), eq(payRuns.isTest, run.isTest), isNull(payRuns.archivedAt)))
    .orderBy(desc(payRuns.periodStart))
    .limit(1);
  const previousNets = new Map<string, bigint>();
  if (previous) {
    const prevRows = await executor
      .select({ id: payRunLines.id, payloadEnc: payRunLines.payloadEnc, lineKey: payLines.lineKey })
      .from(payRunLines)
      .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
      .where(and(eq(payRunLines.runId, previous.id), eq(payRunLines.excluded, false)));
    for (const p of prevRows) {
      try {
        previousNets.set(p.lineKey, decryptRunLine(p.id, p.payloadEnc).result.net);
      } catch (error) {
        console.error("payroll earlier run line unreadable:", { runLineId: p.id, error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
  }

  // A draft, or a run waiting for approval, is compared with what a run built now would contain; any difference means it was built
  // from out-of-date pay lines (someone added or changed since would be paid wrongly or not at all).
  let linesOutOfDate = false;
  if (run.status === "draft" || run.status === "in_review") {
    const now = await linesNowInForce(executor, { start: run.periodStart, end: run.periodEnd });
    const key = (l: { lineId: string; flags: string[] }) => `${l.lineId}|${l.flags.filter((f) => f !== "person_left").sort().join(",")}`;
    // A person taken off on purpose is not "missing".
    const built = new Set([...rows.map((r) => key(r.runLine)), ...removed.map((r) => key(r.runLine))]);
    // A line taken off on purpose is in `built` so it is not "missing"; it must not count as an extra either (an ended line that was
    // taken off is no longer in `now`), so the sets are compared by what is in each, not by their sizes.
    linesOutOfDate = [...now].some((k) => !built.has(k)) || rows.some((r) => !now.has(key(r.runLine)));
  }

  const unapproved = await unapprovedDaysByPerson(executor, employeeIds, run.periodStart, run.periodEnd);
  const ready = await payoutReady(executor, employeeIds);
  return { run, rows, removedLines, items, itemIds, payloads, values, previousNets, linesOutOfDate, unapproved, ready };
}

const lineUnreadable = (data: RunData, runLineId: string) =>
  data.payloads.get(runLineId) == null || data.items.some((i) => i.runLineId === runLineId && data.values.get(i.id) == null);

/** The unassigned suggestions, by person (unreadable ones are left out of the count of the person's items but still block as unreadable). */
function unassignedOf(data: RunData): { employeeId: string; rows: ItemRow[] }[] {
  const byPerson = new Map<string, ItemRow[]>();
  for (const i of data.items) if (i.runLineId === null && i.state === "suggested") byPerson.set(i.employeeId, [...(byPerson.get(i.employeeId) ?? []), i]);
  return [...byPerson].map(([employeeId, rows]) => ({ employeeId, rows }));
}

/**
 * What the checks before review need, relative to the person sending the run (`submitter`): only their own line needs someone else's
 * confirmation. Pass null for no submitter (the own-line check is then skipped).
 */
export async function checkInputsOf(executor: Executor, data: RunData, submitterUserId: string | null): Promise<ChecksInput> {
  const submitterEmployeeId = submitterUserId ? await employeeIdForUser(executor, submitterUserId) : null;
  const lines: CheckLine[] = data.rows.map((r) => {
    const payload = data.payloads.get(r.runLine.id) ?? null;
    const unreadable = lineUnreadable(data, r.runLine.id);
    return {
      runLineId: r.runLine.id,
      employeeId: r.runLine.employeeId,
      name: nameOf(r),
      unreadable,
      issues: payload?.result.issues ?? [],
      flags: r.runLine.flags,
      net: payload && !unreadable ? payload.result.net : null,
      previousNet: data.previousNets.get(r.lineKey) ?? null,
      unapprovedDays: data.unapproved.get(r.runLine.employeeId) ?? 0,
      payoutReady: data.ready.has(r.runLine.employeeId),
      pendingSuggestions: data.items.filter((i) => i.runLineId === r.runLine.id && i.state === "suggested").length,
      clientHoursMissing:
        r.runLine.clientId !== null &&
        payload !== null &&
        payload.clientHoursHundredths === 0n &&
        !data.items.some((i) => i.runLineId === r.runLine.id && i.type === "client_hours" && i.state === "suggested"),
      confirmedBy: r.runLine.confirmedBy,
    };
  });
  const names = new Map(data.rows.map((r) => [r.runLine.employeeId, nameOf(r)]));
  return {
    lines,
    unassigned: unassignedOf(data).map((u) => ({ employeeId: u.employeeId, name: names.get(u.employeeId) ?? "Someone", count: u.rows.length })),
    submitter: { userId: submitterUserId ?? "", employeeId: submitterEmployeeId },
    changeWarnBp: (data.run.settingsSnapshot as SettingsSnapshot).changeWarnBp,
    linesOutOfDate: data.linesOutOfDate,
  };
}

/**
 * The worksheet, from data read by `readRun`. The checks are about the viewer while a Preparer looks at a draft (they are the one who
 * would send it) and about the submitter once it has been sent, so an Approver never sees "your own line" about someone else's line.
 */
export async function worksheetOf(executor: Executor, viewer: { id: string; canPrepare: boolean }, data: RunData): Promise<Worksheet> {
  const { run, rows } = data;

  const confirmerIds = [...new Set(rows.map((r) => r.runLine.confirmedBy).filter((x): x is string => x !== null))];
  const confirmerNames = new Map<string, string>();
  if (confirmerIds.length > 0) {
    const people = await executor
      .select({ id: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(users)
      .leftJoin(employees, eq(employees.userId, users.id))
      .where(inArray(users.id, confirmerIds));
    for (const p of people) confirmerNames.set(p.id, p.first && p.last ? nameOf({ first: p.first, last: p.last, preferred: p.preferred }) : p.email);
  }

  const displayItem = (row: ItemRow): WorksheetItem | null => {
    const v = data.values.get(row.id);
    if (!v) return null;
    return {
      id: row.id,
      type: row.type as PayItemType,
      state: row.state as PayItemState,
      value: formatItemValue(row.type as PayItemType, v.value),
      label: v.label ?? null,
      itemKey: row.itemKey,
      reason: v.reason,
      correctsRunId: v.correctsRunId ?? null,
    };
  };

  const lines: WorksheetLine[] = [];
  const clientTotals = new Map<string, { clientId: string | null; clientName: string; lines: number; hours: bigint; net: bigint }>();
  let gross = 0n;
  let net = 0n;
  let unreadableCount = 0;

  for (const r of rows) {
    const payload = data.payloads.get(r.runLine.id) ?? null;
    const unreadable = lineUnreadable(data, r.runLine.id);
    if (unreadable) unreadableCount += 1;

    let figures: WorksheetFigures | null = null;
    if (payload && !unreadable) {
      const x = payload.result;
      const extra = {} as Record<ExtraKey, string>;
      for (const key of EXTRA_KEYS) extra[key] = formatPesos(x.extra[key]); // eslint-disable-line security/detect-object-injection
      const previousNet = data.previousNets.get(r.lineKey);
      figures = {
        monthly: formatPesos(payload.rate.monthlyCentavos),
        cutoff: formatPesos(x.cutoff),
        base: formatPesos(x.base),
        absences: formatPesos(x.absences),
        sickLeave: formatPesos(x.sickLeave),
        bereavementDays: formatItemValue("bereavement_days", BigInt(payload.input.bereavementDayHundredths)),
        ptoDays: formatItemValue("pto_days", BigInt(payload.input.ptoDayHundredths)),
        late: formatPesos(x.late),
        extra,
        allowances: formatPesos(x.allowances),
        gross: formatPesos(x.gross),
        reimbursements: formatPesos(x.reimbursements),
        bonuses: formatPesos(x.bonuses),
        adjustments: formatPesos(x.adjustments),
        loan: formatPesos(payload.input.loan),
        otherDeductions: formatPesos(payload.input.otherDeductions),
        net: formatPesos(x.net),
        clientHours: formatItemValue("client_hours", payload.clientHoursHundredths),
        netChange: previousNet === undefined ? null : signedPesos(x.net - previousNet),
      };
      gross += x.gross;
      net += x.net;
      const key = r.runLine.clientId ?? "none";
      const t = clientTotals.get(key) ?? { clientId: r.runLine.clientId, clientName: r.clientName ?? "No client", lines: 0, hours: 0n, net: 0n };
      t.lines += 1;
      t.hours += payload.clientHoursHundredths;
      t.net += x.net;
      clientTotals.set(key, t);
    }

    lines.push({
      runLineId: r.runLine.id,
      employeeId: r.runLine.employeeId,
      name: nameOf(r),
      isOwn: r.userId === viewer.id,
      clientId: r.runLine.clientId,
      clientName: r.clientName,
      alias: r.runLine.alias,
      hoursPerDay: payload?.hoursPerDay ?? 0,
      flags: r.runLine.flags,
      unreadable,
      confirmedByName: r.runLine.confirmedBy ? (confirmerNames.get(r.runLine.confirmedBy) ?? "Someone") : null,
      confirmedByMe: r.runLine.confirmedBy === viewer.id,
      figures,
      items: data.items
        .filter((i) => i.runLineId === r.runLine.id)
        .map(displayItem)
        .filter((s): s is WorksheetItem => s !== null),
    });
  }

  const names = new Map(rows.map((r) => [r.runLine.employeeId, nameOf(r)]));
  const unassigned = unassignedOf(data).map((u) => ({
    employeeId: u.employeeId,
    name: names.get(u.employeeId) ?? "Someone",
    items: u.rows.map(displayItem).filter((s): s is WorksheetItem => s !== null),
  }));

  const checksAs = run.status === "draft" ? (viewer.canPrepare ? viewer.id : null) : run.submittedBy;
  const checks = runChecks(await checkInputsOf(executor, data, checksAs));

  let correctableRuns: { id: string; label: string }[] = [];
  if (run.status === "draft" && viewer.canPrepare) {
    const earlier = await executor
      .select({ id: payRuns.id, periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd })
      .from(payRuns)
      .where(and(lt(payRuns.periodStart, run.periodStart), inArray(payRuns.status, ["approved", "paid"]), eq(payRuns.isTest, run.isTest), isNull(payRuns.archivedAt)))
      .orderBy(desc(payRuns.periodStart))
      .limit(24);
    correctableRuns = earlier.map((e) => ({ id: e.id, label: `${e.periodStart} to ${e.periodEnd}` }));
  }

  const complete = unreadableCount === 0;
  return {
    run: { id: run.id, periodStart: run.periodStart, periodEnd: run.periodEnd, status: run.status as RunStatus, isTest: run.isTest, archivedAt: run.archivedAt ? run.archivedAt.toISOString() : null },
    lines,
    unassigned,
    totals: complete ? { gross: formatPesos(gross), net: formatPesos(net) } : null,
    byClient: complete
      ? [...clientTotals.values()]
          .sort((a, b) => a.clientName.localeCompare(b.clientName))
          .map((t) => ({ clientId: t.clientId, clientName: t.clientName, lines: t.lines, clientHours: formatItemValue("client_hours", t.hours), net: formatPesos(t.net) }))
      : null,
    checks,
    checksAreMine: checksAs !== null && checksAs === viewer.id,
    unreadableCount,
    correctableRuns,
    removed: data.removedLines.map((r) => ({ runLineId: r.runLineId, name: r.name, alias: r.alias })),
  };
}
