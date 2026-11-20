import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { formatItemValue, minutesText } from "./items";
import { matchAll, type MatchLine } from "./jibble/match";
import { daysOutside, suggestedAmounts, totalsFor, type SuggestedAmounts, type Timesheet } from "./jibble/timesheet";
import { latestItems, recomputeRun } from "./runs";
import { jibbleMatches, payLines, payRunItems, payRunLines, payRuns, timesheetImports } from "./schema";
import { decryptItemValue, encryptItemValue, lockDraftRun } from "./service";
import { addItem } from "./suggestions";

// Filling a draft run from a Jibble timesheet file. A Preparer uploads the export; ELEVATE keeps only totals per member, matches each member
// to a pay line on the run, and writes SUGGESTED amounts (client payroll hours, overtime by kind, holiday pay, PTO days) that the Preparer
// confirms or edits. Nothing here touches ELEVATE's own time records. The uploaded rows are one encrypted payload, wiped when used,
// discarded, replaced or older than 14 days. Audit rows hold counts only.

type Actor = { id: string; email: string };

export const IMPORT_TTL_DAYS = 14;
const context = (id: string) => `timesheet_import:${id}`;

/** What is kept of the upload: names, member codes and daily totals. */
type Stored = Timesheet;

const AMOUNT_TYPES: (keyof SuggestedAmounts)[] = ["client_hours", "extra_regular", "extra_rest_day", "holiday", "pto_days"];

/** Keeps the upload for this run (replacing an earlier one) and removes any that are older than the keeping period. */
export async function saveTimesheetUpload(tx: Tx, actor: Actor, runId: string, timesheet: Timesheet): Promise<{ importId: string; members: number }> {
  await lockDraftRun(tx, runId);
  await tx.delete(timesheetImports).where(eq(timesheetImports.runId, runId));
  await tx.delete(timesheetImports).where(lt(timesheetImports.createdAt, sql`now() - make_interval(days => ${IMPORT_TTL_DAYS})`));
  const id = randomUUID();
  await tx.insert(timesheetImports).values({
    id,
    runId,
    payloadEnc: fieldCrypto().encrypt(JSON.stringify(timesheet satisfies Stored), context(id)),
    createdBy: actor.id,
  });
  await writeAudit({ actor, action: "payroll.timesheet.upload", targetType: "pay_run", targetId: runId, metadata: { members: timesheet.members.length } }, tx);
  return { importId: id, members: timesheet.members.length };
}

type Executor = Pick<typeof db, "select">;

export type RunLineChoice = { runLineId: string; lineKey: string; hoursPerDay: number; label: string; names: string[] };

/** The live lines of a run with the names a Jibble member may carry. */
export async function runLineChoices(executor: Executor, runId: string): Promise<RunLineChoice[]> {
  const rows = await executor
    .select({
      runLineId: payRunLines.id,
      lineKey: payLines.lineKey,
      hoursPerDay: payLines.hoursPerDay,
      alias: payRunLines.alias,
      clientName: clients.name,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
    })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .innerJoin(employees, eq(employees.id, payRunLines.employeeId))
    .leftJoin(clients, eq(clients.id, payRunLines.clientId))
    .where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName), asc(payRunLines.alias), asc(payRunLines.id));
  return rows.map((r) => {
    const who = `${r.preferred?.trim() || r.first} ${r.last}`;
    return {
      runLineId: r.runLineId,
      lineKey: r.lineKey,
      hoursPerDay: r.hoursPerDay,
      label: [who, r.alias ? `(${r.alias})` : "", r.clientName ? `for ${r.clientName}` : ""].filter(Boolean).join(" "),
      names: [`${r.first} ${r.last}`, who],
    };
  });
}

const rememberedCodes = async (executor: Executor): Promise<Map<string, string>> =>
  new Map((await executor.select({ code: jibbleMatches.memberCode, key: jibbleMatches.lineKey }).from(jibbleMatches)).map((r) => [r.code, r.key]));

function readStored(row: { id: string; payloadEnc: string }): Stored {
  try {
    return JSON.parse(fieldCrypto().decrypt(row.payloadEnc, context(row.id))) as Stored;
  } catch (error) {
    console.error("payroll timesheet import unreadable:", { importId: row.id, error: error instanceof Error ? error.name : "UnknownError" });
    throw new ActionFailure("That upload can't be read any more. Upload the file again.");
  }
}

export type TimesheetPreview = {
  importId: string;
  periodText: string | null;
  runPeriod: { start: string; end: string };
  /** Days in the file that fall outside the run's period (they are ignored). */
  outsideDays: number;
  /** Sheets in the file that were not read as a person (summary or raw sheets, or a repeated member). */
  skippedSheets: number;
  /** Columns missing from every member sheet: their amounts count as zero. */
  missingColumns: string[];
  /** Unconfirmed suggestions already on the matched lines that this file would change. */
  conflicts: number;
  lines: { runLineId: string; label: string }[];
  members: {
    code: string;
    name: string;
    /** The line chosen for this member, or null when the Preparer must choose. */
    runLineId: string | null;
    candidates: string[];
    matchedBy: "remembered" | "name" | null;
    days: number;
    clientHours: string;
    overtime: string;
    restDayOvertime: string;
    holidayPay: string;
    ptoDays: string;
  }[];
};

/** The newest upload for a run, read and matched, or null when there is none. The caller has authorized. */
export async function buildTimesheetPreview(executor: Executor, runId: string): Promise<TimesheetPreview | null> {
  const [run] = await executor.select({ start: payRuns.periodStart, end: payRuns.periodEnd }).from(payRuns).where(eq(payRuns.id, runId)).limit(1);
  const [row] = await executor.select({ id: timesheetImports.id, payloadEnc: timesheetImports.payloadEnc }).from(timesheetImports).where(eq(timesheetImports.runId, runId)).orderBy(desc(timesheetImports.createdAt)).limit(1);
  if (!run || !row) return null;
  const sheet = readStored(row);
  const lines = await runLineChoices(executor, runId);
  const matchLines: MatchLine[] = lines.map((l) => ({ runLineId: l.runLineId, lineKey: l.lineKey, names: l.names }));
  const matches = matchAll(sheet.members, matchLines, await rememberedCodes(executor));
  const hoursOf = new Map(lines.map((l) => [l.runLineId, l.hoursPerDay]));
  const existing = await latestItems(executor, runId);
  let conflicts = 0;
  for (const m of sheet.members) {
    const runLineId = matches.get(m.code)?.runLineId;
    if (!runLineId) continue;
    const amounts = suggestedAmounts(totalsFor(m, run.start, run.end), hoursOf.get(runLineId) ?? 8);
    for (const type of AMOUNT_TYPES) {
      const here = existing.filter((i) => i.runLineId === runLineId && i.type === type && i.itemKey === null);
      if (here.some((i) => i.state === "confirmed")) continue;
      const active = here.find((i) => i.state === "suggested");
      if (active && decryptItemValue(active.id, active.valueEnc).value !== amounts[type]) conflicts += 1;
    }
  }

  return {
    importId: row.id,
    periodText: sheet.periodText,
    runPeriod: { start: run.start, end: run.end },
    outsideDays: daysOutside(sheet, run.start, run.end),
    skippedSheets: sheet.skippedSheets ?? 0,
    missingColumns: sheet.missingColumns ?? [],
    conflicts,
    lines: lines.map((l) => ({ runLineId: l.runLineId, label: l.label })),
    members: sheet.members.map((m) => {
      const match = matches.get(m.code)!;
      const totals = totalsFor(m, run.start, run.end);
      const amounts = suggestedAmounts(totals, hoursOf.get(match.runLineId ?? "") ?? 8);
      return {
        code: m.code,
        name: m.name,
        runLineId: match.runLineId,
        candidates: match.candidates,
        matchedBy: match.by,
        days: totals.days,
        clientHours: formatItemValue("client_hours", amounts.client_hours),
        overtime: amounts.extra_regular > 0n ? minutesText(Number(amounts.extra_regular)) : "-",
        restDayOvertime: amounts.extra_rest_day > 0n ? minutesText(Number(amounts.extra_rest_day)) : "-",
        holidayPay: amounts.holiday > 0n ? minutesText(Number(amounts.holiday)) : "-",
        ptoDays: amounts.pto_days > 0n ? formatItemValue("pto_days", amounts.pto_days) : "-",
      };
    }),
  };
}

export type Assignment = { code: string; runLineId: string | null };

/**
 * Writes the suggestions for the members the Preparer matched, remembers the matches by member code, and wipes the upload. A confirmed
 * amount is never overwritten; an unchanged suggestion adds nothing. An unconfirmed suggestion that is already on a line and differs from the file
 * (from the other fill, or an earlier upload) is held, not replaced, unless the Preparer asked to replace them; a replacement keeps the earlier value
 * in the change history (the earlier row stays, and the new reason names its value). Nobody's pay changes until a Preparer confirms a suggestion.
 */
export async function applyTimesheet(tx: Tx, actor: Actor, v: { runId: string; importId: string; assignments: Assignment[]; replaceSuggestions?: boolean }): Promise<{ lines: number; written: number; kept: number; held: number }> {
  const run = await lockDraftRun(tx, v.runId);
  const [row] = await tx.select({ id: timesheetImports.id, payloadEnc: timesheetImports.payloadEnc }).from(timesheetImports).where(and(eq(timesheetImports.id, v.importId), eq(timesheetImports.runId, v.runId))).limit(1);
  if (!row) throw new ActionFailure("That upload was not found. Upload the file again.");
  const sheet = readStored(row);
  const byCode = new Map(sheet.members.map((m) => [m.code, m]));
  const lines = new Map((await runLineChoices(tx, v.runId)).map((l) => [l.runLineId, l]));

  const used = new Set<string>();
  const chosen: { code: string; runLineId: string }[] = [];
  for (const a of v.assignments) {
    if (!byCode.has(a.code)) throw new ActionFailure("The upload changed. Upload the file again.");
    if (a.runLineId === null) continue;
    if (!lines.has(a.runLineId)) throw new ActionFailure("A chosen person is not on this run any more. Update people and try again.");
    if (used.has(a.runLineId)) throw new ActionFailure("Two members were given the same pay line. Choose a different line for one of them.");
    used.add(a.runLineId);
    chosen.push({ code: a.code, runLineId: a.runLineId });
  }

  const all = await latestItems(tx, v.runId);
  const employeeOf = new Map((await tx.select({ id: payRunLines.id, employeeId: payRunLines.employeeId }).from(payRunLines).where(eq(payRunLines.runId, v.runId))).map((r) => [r.id, r.employeeId]));
  let written = 0;
  let kept = 0;
  let held = 0;
  for (const { code, runLineId } of chosen) {
    const member = byCode.get(code)!;
    const choice = lines.get(runLineId)!;
    const amounts = suggestedAmounts(totalsFor(member, run.periodStart, run.periodEnd), choice.hoursPerDay);
    const employeeId = employeeOf.get(runLineId)!;
    for (const type of AMOUNT_TYPES) {
      const value = amounts[type];
      const here = all.filter((i) => i.runLineId === runLineId && i.type === type && i.itemKey === null);
      if (here.some((i) => i.state === "confirmed")) {
        kept += 1; // a Preparer's own figure is never overwritten
        continue;
      }
      const active = here.find((i) => i.state === "suggested");
      const earlier = active ? decryptItemValue(active.id, active.valueEnc).value : null;
      if (value === 0n) {
        if (active && earlier !== null) {
          if (!v.replaceSuggestions) {
            held += 1;
            continue;
          }
          await addItem(tx, actor, { runId: v.runId, employeeId, runLineId, type, state: "dismissed", value: earlier, reason: "Not in the timesheet" });
          written += 1;
        }
        continue;
      }
      if (earlier === value) continue;
      if (active && !v.replaceSuggestions) {
        held += 1; // another fill's suggestion is still there: the Preparer decides
        continue;
      }
      await addItem(tx, actor, { runId: v.runId, employeeId, runLineId, type, state: "suggested", value, reason: earlier !== null ? `Jibble import replaced an earlier suggestion of ${formatItemValue(type, earlier)}` : null });
      written += 1;
    }
  }

  for (const { code, runLineId } of chosen) {
    const lineKey = lines.get(runLineId)!.lineKey;
    await tx
      .insert(jibbleMatches)
      .values({ memberCode: code, lineKey, updatedBy: actor.id })
      .onConflictDoUpdate({ target: jibbleMatches.memberCode, set: { lineKey, updatedBy: actor.id, updatedAt: sql`now()` } });
  }
  await tx.delete(timesheetImports).where(eq(timesheetImports.runId, v.runId));
  await writeAudit({ actor, action: "payroll.timesheet.apply", targetType: "pay_run", targetId: v.runId, metadata: { members: chosen.length, written, kept, held } }, tx);
  await logChange(tx, actor, { action: "timesheet_imported", runId: v.runId, detail: { members: chosen.length, written, kept, held } });
  return { lines: chosen.length, written, kept, held };
}

/** Throws away the upload for a run. */
export async function discardTimesheet(tx: Tx, actor: Actor, runId: string): Promise<void> {
  await lockDraftRun(tx, runId);
  await tx.delete(timesheetImports).where(eq(timesheetImports.runId, runId));
  await writeAudit({ actor, action: "payroll.timesheet.discard", targetType: "pay_run", targetId: runId, metadata: {} }, tx);
}

/**
 * Confirms every suggestion that sits on a line, as suggested, in one step (after reading them). Each becomes a confirmed amount, the run
 * is recomputed once and every line that changed needs a new check. Suggestions that no line has been chosen for are left alone.
 */
export async function confirmAllSuggestions(tx: Tx, actor: Actor, runId: string): Promise<{ confirmed: number }> {
  await lockDraftRun(tx, runId);
  const live = new Set((await tx.select({ id: payRunLines.id }).from(payRunLines).where(and(eq(payRunLines.runId, runId), eq(payRunLines.excluded, false)))).map((r) => r.id));
  const suggestions = (await latestItems(tx, runId)).filter((i) => i.state === "suggested" && i.runLineId !== null && live.has(i.runLineId));
  const changed = new Set<string>();
  for (const item of suggestions) {
    const v = decryptItemValue(item.id, item.valueEnc);
    const id = randomUUID();
    await tx.insert(payRunItems).values({
      id,
      runId,
      employeeId: item.employeeId,
      runLineId: item.runLineId,
      type: item.type,
      itemKey: item.itemKey,
      state: "confirmed",
      valueEnc: encryptItemValue(id, { value: v.value, ...(v.label ? { label: v.label } : {}), reason: null }),
      enteredBy: actor.id,
      createdAt: sql`clock_timestamp()`,
    });
    changed.add(item.runLineId!);
  }
  if (changed.size > 0) await recomputeRun(tx, runId, { clearConfirmationFor: [...changed] });
  await writeAudit({ actor, action: "payroll.suggestion.confirm_all", targetType: "pay_run", targetId: runId, metadata: { confirmed: suggestions.length } }, tx);
  await logChange(tx, actor, { action: "suggestions_confirmed_all", runId, detail: { confirmed: suggestions.length } });
  return { confirmed: suggestions.length };
}

