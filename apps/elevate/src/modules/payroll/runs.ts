import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { approvalKey, attendanceRows, dayState, latestApprovals } from "@/modules/attendance/hours-service";
import { users } from "@/modules/core/schema";
import { clients, employeeSensitive, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { calculateLine, EXTRA_KEYS, type ExtraKey, type SettingsSnapshot } from "./calculate";
import { logChange } from "./changes";
import { runChecks, type CheckLine, type RunCheck } from "./checks";
import { REASON_REQUIRED_TYPES, type PayItemState, type PayItemType, type RunStatus } from "./constants";
import { buildLineInput, formatItemValue, formatUsdRate, parseItemValue } from "./items";
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
const itemKey = (i: { runLineId: string | null; employeeId: string; type: string }) => `${i.runLineId ?? `u:${i.employeeId}`}|${i.type}`;

/** The newest row for each line and type (a loan on one line never replaces another line's). Unassigned rows are keyed by person. */
export async function latestItems(executor: Reader, runId: string): Promise<ItemRow[]> {
  const rows = await executor.select().from(payRunItems).where(eq(payRunItems.runId, runId)).orderBy(asc(payRunItems.createdAt));
  const newest = new Map<string, ItemRow>();
  for (const row of rows) newest.set(itemKey(row), row);
  return [...newest.values()];
}

function confirmedValues(items: ItemRow[], runLineId: string): Map<PayItemType, bigint> {
  const out = new Map<PayItemType, bigint>();
  for (const item of items) {
    if (item.runLineId !== runLineId || item.state !== "confirmed") continue;
    try {
      out.set(item.type as PayItemType, decryptItemValue(item.id, item.valueEnc).value);
    } catch (error) {
      console.error("payroll item unreadable:", { itemId: item.id, error: error instanceof Error ? error.name : "UnknownError" });
      throw new ActionFailure("An amount on this run can't be read. This usually means a problem with the encryption key.");
    }
  }
  return out;
}

// ---- Computing a line ----

function computePayload(
  line: { hoursPerDay: number; fte: string },
  rate: RunLinePayload["rate"],
  items: ReadonlyMap<PayItemType, bigint>,
  settings: SettingsSnapshot,
  usdRateE4: number | null,
): RunLinePayload {
  const { input, clientHoursHundredths } = buildLineInput(rate, line.hoursPerDay, items);
  return { rate, hoursPerDay: line.hoursPerDay, fte: line.fte, input, clientHoursHundredths, result: calculateLine(input, settings, usdRateE4) };
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
    .where(scoped ? and(eq(payRunLines.runId, runId), eq(payRunLines.employeeId, scoped)) : eq(payRunLines.runId, runId));

  const items = await latestItems(tx, runId);
  const forceClear = new Set(options.clearConfirmationFor ?? []);
  const changedLineIds: string[] = [];

  for (const { runLine, version } of rows) {
    const rate = readRate(version.id, version.amountsEnc);
    const next = computePayload(version, rate, confirmedValues(items, runLine.id), settings, run.usdRateE4);
    let before: string | null = null;
    try {
      before = payloadText(decryptRunLine(runLine.id, runLine.payloadEnc));
    } catch {
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

/** Builds a draft run for a period: one line for each pay line in force. Refuses any period that overlaps an existing run. */
export async function createRun(tx: Tx, actor: Actor, period: { periodStart: string; periodEnd: string }): Promise<{ runId: string; lineCount: number }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pay_runs'))`);
  const [clash] = await tx
    .select({ periodStart: payRuns.periodStart, periodEnd: payRuns.periodEnd })
    .from(payRuns)
    .where(and(lte(payRuns.periodStart, period.periodEnd), gte(payRuns.periodEnd, period.periodStart)))
    .limit(1);
  if (clash) {
    const same = clash.periodStart === period.periodStart && clash.periodEnd === period.periodEnd;
    throw new ActionFailure(
      same
        ? `There is already a pay run for ${period.periodStart} to ${period.periodEnd}.`
        : `That period overlaps the pay run for ${clash.periodStart} to ${clash.periodEnd}. Pay runs can't overlap.`,
    );
  }

  const settings = await settingsInForce(tx, period.periodStart);
  const all = await tx
    .select({ line: payLines, status: employees.status, archivedAt: employees.archivedAt })
    .from(payLines)
    .innerJoin(employees, eq(employees.id, payLines.employeeId));
  const person = new Map(all.map((r) => [r.line.employeeId, r]));
  const resolved = resolveLines(all.map((r) => r.line), { start: period.periodStart, end: period.periodEnd });
  if (resolved.length === 0) throw new ActionFailure("Nobody has a pay line in that period. Add pay lines on the Rates tab first.");

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
      payloadEnc: encryptRunLine(id, computePayload(version, rate, new Map(), settings, null)),
    };
  });

  await tx.insert(payRuns).values({ id: runId, periodStart: period.periodStart, periodEnd: period.periodEnd, status: "draft", usdRateE4: null, settingsSnapshot: settings, createdBy: actor.id });
  await tx.insert(payRunLines).values(prepared);
  await writeAudit({ actor, action: "payroll.run.create", targetType: "pay_run", targetId: runId, metadata: { lines: prepared.length } }, tx);
  await logChange(tx, actor, { action: "run_created", runId, detail: { periodStart: period.periodStart, periodEnd: period.periodEnd, lines: prepared.length } });
  return { runId, lineCount: prepared.length };
}

// ---- Changing a draft run ----

const itemDetail = (row: ItemRow | undefined) => {
  if (!row) return null;
  const v = decryptItemValue(row.id, row.valueEnc);
  return { state: row.state, value: v.value.toString(), reason: v.reason };
};

/** Confirms an amount for one line (or overrides a suggestion). Reasons are required for deductions and for overriding a suggestion. */
export async function saveItem(
  tx: Tx,
  actor: Actor,
  v: { runId: string; employeeId: string; runLineId: string; type: PayItemType; value: string; reason?: string },
): Promise<void> {
  await lockDraftRun(tx, v.runId);
  await assertNotOwnEmployee(actor, v.employeeId, tx);
  const [line] = await tx
    .select({ id: payRunLines.id })
    .from(payRunLines)
    .where(and(eq(payRunLines.id, v.runLineId), eq(payRunLines.runId, v.runId), eq(payRunLines.employeeId, v.employeeId)))
    .limit(1);
  if (!line) throw new ActionFailure("That line is not on this run.");
  const value = parseItemValue(v.type, v.value);
  if (value === null) throw new ActionFailure("Check the amount and try again.");

  const all = await latestItems(tx, v.runId);
  const prior = all.find((i) => itemKey(i) === itemKey({ runLineId: v.runLineId, employeeId: v.employeeId, type: v.type }));
  const suggestion = prior?.state === "suggested" ? prior : all.find((i) => i.runLineId === null && i.employeeId === v.employeeId && i.type === v.type && i.state === "suggested");
  const overriding = suggestion !== undefined && decryptItemValue(suggestion.id, suggestion.valueEnc).value !== value;
  const reason = v.reason?.trim() || null;
  if ((REASON_REQUIRED_TYPES.includes(v.type) || overriding) && !reason) throw new ActionFailure("Give a reason for this amount.");

  const id = randomUUID();
  await tx.insert(payRunItems).values({
    id,
    runId: v.runId,
    employeeId: v.employeeId,
    runLineId: v.runLineId,
    type: v.type,
    state: "confirmed",
    valueEnc: encryptItemValue(id, { value, reason }),
    enteredBy: actor.id,
    createdAt: sql`clock_timestamp()`,
  });
  await recomputeRun(tx, v.runId, { employeeId: v.employeeId, clearConfirmationFor: [v.runLineId] });
  await writeAudit({ actor, action: "payroll.item.save", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: v.employeeId, type: v.type } }, tx);
  await logChange(tx, actor, {
    action: "item_saved",
    runId: v.runId,
    employeeId: v.employeeId,
    detail: { runLineId: v.runLineId, type: v.type, old: itemDetail(prior), new: { state: "confirmed", value: value.toString(), reason } },
  });
}

/** Takes an amount off a line: a new row in the "dismissed" state, so the history keeps the old one. */
export async function dismissItem(tx: Tx, actor: Actor, v: { runId: string; itemId: string; reason?: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const [item] = await tx.select().from(payRunItems).where(and(eq(payRunItems.id, v.itemId), eq(payRunItems.runId, v.runId))).limit(1);
  if (!item) throw new ActionFailure("That amount was not found.");
  await assertNotOwnEmployee(actor, item.employeeId, tx);
  const latest = (await latestItems(tx, v.runId)).find((i) => itemKey(i) === itemKey(item));
  if (latest?.id !== item.id) throw new ActionFailure("That amount has changed. Reload the page and try again.");
  if (item.state === "dismissed") throw new ActionFailure("That amount is already removed.");

  const reason = v.reason?.trim() || null;
  if ((REASON_REQUIRED_TYPES.includes(item.type as PayItemType) || item.state === "suggested") && !reason) throw new ActionFailure("Give a reason for removing this amount.");

  const old = decryptItemValue(item.id, item.valueEnc);
  const id = randomUUID();
  await tx.insert(payRunItems).values({
    id,
    runId: v.runId,
    employeeId: item.employeeId,
    runLineId: item.runLineId,
    type: item.type,
    state: "dismissed" satisfies PayItemState,
    valueEnc: encryptItemValue(id, { value: old.value, reason }),
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

/** Sets (or clears) the dollar rate and recomputes every line. */
export async function setUsdRate(tx: Tx, actor: Actor, v: { runId: string; rate: number | null }): Promise<void> {
  const run = await lockDraftRun(tx, v.runId);
  if (run.usdRateE4 === v.rate) return;
  await tx.update(payRuns).set({ usdRateE4: v.rate }).where(eq(payRuns.id, v.runId));
  const { changedLineIds } = await recomputeRun(tx, v.runId);
  await writeAudit({ actor, action: "payroll.run.usd_rate", targetType: "pay_run", targetId: v.runId, metadata: { lines: changedLineIds.length } }, tx);
  await logChange(tx, actor, {
    action: "usd_rate_changed",
    runId: v.runId,
    detail: { old: run.usdRateE4 === null ? null : formatUsdRate(run.usdRateE4), new: v.rate === null ? null : formatUsdRate(v.rate) },
  });
}

/** Records that someone other than the line's owner checked the line. A later change to the line clears it. */
export async function confirmLine(tx: Tx, actor: Actor, runLineId: string): Promise<void> {
  const [found] = await tx.select({ runId: payRunLines.runId }).from(payRunLines).where(eq(payRunLines.id, runLineId)).limit(1);
  if (!found) throw new ActionFailure("That line was not found.");
  await lockDraftRun(tx, found.runId);
  const [line] = await tx.select().from(payRunLines).where(eq(payRunLines.id, runLineId)).limit(1);
  if (!line) throw new ActionFailure("That line was not found.");
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

// ---- Reading a run ----

export type WorksheetItem = { id: string; type: PayItemType; state: PayItemState; /** As typed: "1.5", "1,250.50". */ value: string; reason: string | null };

export type WorksheetFigures = {
  monthly: string;
  cutoff: string;
  base: string;
  absences: string;
  late: string;
  extra: Record<ExtraKey, string>;
  pesoAllowance: string;
  /** Dollars. */
  dollarAllowance: string;
  dollarAllowancePesos: string;
  gross: string;
  adjustment: string;
  loan: string;
  otherDeductions: string;
  net: string;
  clientHours: string;
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
  fte: string;
  flags: string[];
  /** The stored figures or an amount on the line could not be decrypted. */
  unreadable: boolean;
  confirmedByName: string | null;
  confirmedByMe: boolean;
  figures: WorksheetFigures | null;
  items: WorksheetItem[];
};

export type ClientTotals = { clientId: string | null; clientName: string; lines: number; fte: string; clientHours: string; net: string };

export type Worksheet = {
  run: { id: string; periodStart: string; periodEnd: string; status: RunStatus; usdRate: string | null };
  lines: WorksheetLine[];
  /** Suggestions no pay line has been chosen for. */
  unassigned: { employeeId: string; name: string; items: WorksheetItem[] }[];
  /** Null when any line can't be read: a partial total is never shown. */
  totals: { gross: string; dollarAllowancePesos: string; net: string } | null;
  byClient: ClientTotals[] | null;
  checks: { blocking: RunCheck[]; warnings: RunCheck[] };
  unreadableCount: number;
};

/** Finished days in the period with hours that are not approved (or changed after approval), for each person. Reads through the attendance module. */
export async function unapprovedDaysByPerson(employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (employeeIds.length === 0) return out;
  const today = payrollToday();
  const days = await attendanceRows(db, employeeIds, from, to);
  const approvals = await latestApprovals(db, employeeIds, from, to);
  for (const d of days) {
    if (!(d.sessions > 0 || d.scheduledMinutes !== null) || d.date >= today) continue;
    if (dayState(d, approvals.get(approvalKey(d.employeeId, d.date))) === "approved") continue;
    out.set(d.employeeId, (out.get(d.employeeId) ?? 0) + 1);
  }
  return out;
}

/** Who has payout details on file, from the stored masks only. Nothing is decrypted. */
async function payoutReady(employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rows = await db.select({ id: employeeSensitive.employeeId, masks: employeeSensitive.masks }).from(employeeSensitive).where(inArray(employeeSensitive.employeeId, employeeIds));
  return new Set(rows.filter((r) => r.masks.bankName && r.masks.bankAccountName && r.masks.bankAccountNumber).map((r) => r.id));
}

const fteHundredths = (fte: string) => Math.round(Number(fte) * 100);
const showHundredths = (n: number) => formatItemValue("client_hours", BigInt(n));

/**
 * Everything the worksheet shows, decrypted. The caller has already authorized and writes the audit row. A line or amount that can't
 * be read is listed as unreadable (with the line id and error class logged, never a figure) and blocks review; totals are then withheld.
 */
export async function buildWorksheet(viewer: { id: string }, runId: string): Promise<Worksheet | null> {
  const [run] = await db.select().from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  if (!run) return null;
  const snapshot = run.settingsSnapshot as SettingsSnapshot;

  const rows = await db
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
    .where(eq(payRunLines.runId, runId))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias), asc(payRunLines.id));

  const items = await latestItems(db, runId);
  const employeeIds = [...new Set(rows.map((r) => r.runLine.employeeId))];
  const submitterEmployeeId = await employeeIdForUser(db, viewer.id);

  // The most recent earlier run, for the "net changed" check.
  const [previous] = await db.select({ id: payRuns.id }).from(payRuns).where(lt(payRuns.periodStart, run.periodStart)).orderBy(desc(payRuns.periodStart)).limit(1);
  const previousNets = new Map<string, bigint>();
  if (previous) {
    const prevRows = await db
      .select({ id: payRunLines.id, payloadEnc: payRunLines.payloadEnc, lineKey: payLines.lineKey })
      .from(payRunLines)
      .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
      .where(eq(payRunLines.runId, previous.id));
    for (const p of prevRows) {
      try {
        previousNets.set(p.lineKey, decryptRunLine(p.id, p.payloadEnc).result.net);
      } catch (error) {
        console.error("payroll earlier run line unreadable:", { runLineId: p.id, error: error instanceof Error ? error.name : "UnknownError" });
      }
    }
  }

  const unapproved = await unapprovedDaysByPerson(employeeIds, run.periodStart, run.periodEnd);
  const ready = await payoutReady(employeeIds);

  const confirmerIds = [...new Set(rows.map((r) => r.runLine.confirmedBy).filter((x): x is string => x !== null))];
  const confirmerNames = new Map<string, string>();
  if (confirmerIds.length > 0) {
    const people = await db
      .select({ id: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
      .from(users)
      .leftJoin(employees, eq(employees.userId, users.id))
      .where(inArray(users.id, confirmerIds));
    for (const p of people) confirmerNames.set(p.id, p.first && p.last ? nameOf({ first: p.first, last: p.last, preferred: p.preferred }) : p.email);
  }

  const displayItem = (row: ItemRow): WorksheetItem | null => {
    try {
      const v = decryptItemValue(row.id, row.valueEnc);
      return { id: row.id, type: row.type as PayItemType, state: row.state as PayItemState, value: formatItemValue(row.type as PayItemType, v.value), reason: v.reason };
    } catch (error) {
      console.error("payroll item unreadable:", { itemId: row.id, error: error instanceof Error ? error.name : "UnknownError" });
      return null;
    }
  };

  const checkLines: CheckLine[] = [];
  const lines: WorksheetLine[] = [];
  const clientTotals = new Map<string, { clientId: string | null; clientName: string; lines: number; fte: number; hours: bigint; net: bigint }>();
  let gross = 0n;
  let dollarPesos = 0n;
  let net = 0n;
  let unreadableCount = 0;

  for (const r of rows) {
    const mine = items.filter((i) => i.runLineId === r.runLine.id);
    const shown = mine.map(displayItem);
    let payload: RunLinePayload | null = null;
    try {
      payload = decryptRunLine(r.runLine.id, r.runLine.payloadEnc);
    } catch (error) {
      console.error("payroll run line unreadable:", { runLineId: r.runLine.id, error: error instanceof Error ? error.name : "UnknownError" });
    }
    const unreadable = payload === null || shown.some((s) => s === null);
    if (unreadable) unreadableCount += 1;
    const name = nameOf(r);

    let figures: WorksheetFigures | null = null;
    if (payload && !unreadable) {
      const x = payload.result;
      const extra = {} as Record<ExtraKey, string>;
      for (const key of EXTRA_KEYS) extra[key] = formatPesos(x.extra[key]); // eslint-disable-line security/detect-object-injection
      figures = {
        monthly: formatPesos(payload.rate.monthlyCentavos),
        cutoff: formatPesos(x.cutoff),
        base: formatPesos(x.base),
        absences: formatPesos(x.absences),
        late: formatPesos(x.late),
        extra,
        pesoAllowance: formatPesos(payload.input.pesoAllowance),
        dollarAllowance: formatPesos(payload.input.dollarAllowanceCents),
        dollarAllowancePesos: formatPesos(x.dollarAllowancePesos),
        gross: formatPesos(x.gross),
        adjustment: formatPesos(payload.input.adjustment),
        loan: formatPesos(payload.input.loan),
        otherDeductions: formatPesos(payload.input.otherDeductions),
        net: formatPesos(x.net),
        clientHours: formatItemValue("client_hours", payload.clientHoursHundredths),
      };
      gross += x.gross;
      dollarPesos += x.dollarAllowancePesos;
      net += x.net;
      const key = r.runLine.clientId ?? "none";
      const t = clientTotals.get(key) ?? { clientId: r.runLine.clientId, clientName: r.clientName ?? "No client", lines: 0, fte: 0, hours: 0n, net: 0n };
      t.lines += 1;
      t.fte += fteHundredths(payload.fte);
      t.hours += payload.clientHoursHundredths;
      t.net += x.net;
      clientTotals.set(key, t);
    }

    lines.push({
      runLineId: r.runLine.id,
      employeeId: r.runLine.employeeId,
      name,
      isOwn: r.userId === viewer.id,
      clientId: r.runLine.clientId,
      clientName: r.clientName,
      alias: r.runLine.alias,
      hoursPerDay: payload?.hoursPerDay ?? 0,
      fte: payload?.fte ?? "",
      flags: r.runLine.flags,
      unreadable,
      confirmedByName: r.runLine.confirmedBy ? (confirmerNames.get(r.runLine.confirmedBy) ?? "Someone") : null,
      confirmedByMe: r.runLine.confirmedBy === viewer.id,
      figures,
      items: shown.filter((s): s is WorksheetItem => s !== null),
    });
    checkLines.push({
      runLineId: r.runLine.id,
      employeeId: r.runLine.employeeId,
      name,
      unreadable,
      issues: payload?.result.issues ?? [],
      flags: r.runLine.flags,
      net: payload && !unreadable ? payload.result.net : null,
      previousNet: previousNets.get(r.lineKey) ?? null,
      unapprovedDays: unapproved.get(r.runLine.employeeId) ?? 0,
      payoutReady: ready.has(r.runLine.employeeId),
      pendingSuggestions: mine.filter((i) => i.state === "suggested").length,
      confirmedBy: r.runLine.confirmedBy,
    });
  }

  // Suggestions that no line has been chosen for.
  const names = new Map(rows.map((r) => [r.runLine.employeeId, nameOf(r)]));
  const unassignedByPerson = new Map<string, ItemRow[]>();
  for (const i of items) if (i.runLineId === null && i.state === "suggested") unassignedByPerson.set(i.employeeId, [...(unassignedByPerson.get(i.employeeId) ?? []), i]);
  const unassigned = [...unassignedByPerson].map(([employeeId, list]) => ({
    employeeId,
    name: names.get(employeeId) ?? "Someone",
    items: list.map(displayItem).filter((s): s is WorksheetItem => s !== null),
  }));

  const checks = runChecks({
    lines: checkLines,
    unassigned: unassigned.map((u) => ({ employeeId: u.employeeId, name: u.name, count: u.items.length })),
    submitter: { userId: viewer.id, employeeId: submitterEmployeeId },
    changeWarnBp: snapshot.changeWarnBp,
  });

  const complete = unreadableCount === 0;
  return {
    run: { id: run.id, periodStart: run.periodStart, periodEnd: run.periodEnd, status: run.status as RunStatus, usdRate: run.usdRateE4 === null ? null : formatUsdRate(run.usdRateE4) },
    lines,
    unassigned,
    totals: complete ? { gross: formatPesos(gross), dollarAllowancePesos: formatPesos(dollarPesos), net: formatPesos(net) } : null,
    byClient: complete
      ? [...clientTotals.values()]
          .sort((a, b) => a.clientName.localeCompare(b.clientName))
          .map((t) => ({ clientId: t.clientId, clientName: t.clientName, lines: t.lines, fte: showHundredths(t.fte), clientHours: formatItemValue("client_hours", t.hours), net: formatPesos(t.net) }))
      : null,
    checks,
    unreadableCount,
  };
}
