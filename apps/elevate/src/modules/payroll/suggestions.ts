import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { approvalKey, attendanceRows, dayState, latestApprovals } from "@/modules/attendance/hours-service";
import { clients } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { holidayDatesFor } from "@/modules/timeoff/service";
import { EXTRA_KEYS } from "./calculate";
import { logChange } from "./changes";
import { EXTRA_KEY_ITEM, type PayItemType } from "./constants";
import { formatItemValue } from "./items";
import { itemKey, latestItems, saveItem, suggestedValue, type ItemRow } from "./runs";
import { payRunItems, payRunLines } from "./schema";
import { assertNotOwnEmployee, decryptItemValue, encryptItemValue, lockDraftRun, payrollToday } from "./service";
import { suggestFromDays, type SuggestDay } from "./suggest";

// Suggestions from approved hours. They are only suggestions: pay does not change until a Preparer confirms one. Hours are read
// through the attendance module's exports; nothing here touches its tables. Amounts never go into audit rows.

type Actor = { id: string; email: string };

/** Kept in the item's encrypted reason, so the refresh can tell its own removals from a Preparer's. */
export const NO_LONGER_APPROVED = "No longer in approved hours";
export const ASSIGNED_TO_LINE = "Assigned to a line";

const SUGGESTED_TYPES: PayItemType[] = ["absence_days", "late_minutes", ...EXTRA_KEYS.filter((k) => k !== "holidayPay").map((k) => EXTRA_KEY_ITEM[k])]; // eslint-disable-line security/detect-object-injection

/** One new row in the item history. `clock_timestamp()` keeps rows written in one transaction in the order they were written. */
async function addItem(tx: Tx, actor: Actor, v: { runId: string; employeeId: string; runLineId: string | null; type: string; state: "suggested" | "dismissed"; value: bigint; reason: string | null }): Promise<void> {
  const id = randomUUID();
  await tx.insert(payRunItems).values({
    id,
    runId: v.runId,
    employeeId: v.employeeId,
    runLineId: v.runLineId,
    type: v.type,
    state: v.state,
    valueEnc: encryptItemValue(id, { value: v.value, reason: v.reason }),
    enteredBy: actor.id,
    createdAt: sql`clock_timestamp()`,
  });
}

/**
 * Reads the approved hours of everyone on the run and writes the suggestions that are new or changed. A confirmed amount is never
 * touched; unchanged numbers add no rows; a person with one line gets suggestions on it, a person with two get them unassigned.
 */
export async function applyRefresh(tx: Tx, actor: Actor, runId: string): Promise<{ written: number }> {
  const run = await lockDraftRun(tx, runId);
  const lines = await tx.select({ id: payRunLines.id, employeeId: payRunLines.employeeId, clientId: payRunLines.clientId }).from(payRunLines).where(eq(payRunLines.runId, runId));
  const employeeIds = [...new Set(lines.map((l) => l.employeeId))];

  const clientIds = [...new Set(lines.map((l) => l.clientId).filter((c): c is string => c !== null))];
  const calendarOf = new Map<string, "PH" | "US">();
  if (clientIds.length > 0) {
    for (const c of await tx.select({ id: clients.id, calendar: clients.holidayCalendar }).from(clients).where(inArray(clients.id, clientIds))) calendarOf.set(c.id, c.calendar === "US" ? "US" : "PH");
  }
  const holidays = { PH: await holidayDatesFor(tx, "PH", run.periodStart, run.periodEnd), US: await holidayDatesFor(tx, "US", run.periodStart, run.periodEnd) };

  const today = payrollToday();
  const allDays = await attendanceRows(tx, employeeIds, run.periodStart, run.periodEnd);
  const approvals = await latestApprovals(tx, employeeIds, run.periodStart, run.periodEnd);
  const items = await latestItems(tx, runId);
  let written = 0;

  for (const employeeId of employeeIds) {
    const own = lines.filter((l) => l.employeeId === employeeId);
    const calendars = new Set(own.map((l) => (l.clientId ? (calendarOf.get(l.clientId) ?? "PH") : "PH")));
    const finished = allDays.filter((d) => d.employeeId === employeeId && (d.sessions > 0 || d.scheduledMinutes !== null) && d.date < today);
    if (finished.length === 0) continue;

    const days: SuggestDay[] = finished.map((d) => ({
      date: d.date,
      state: dayState(d, approvals.get(approvalKey(employeeId, d.date))),
      scheduledMinutes: d.scheduledMinutes,
      workedMinutes: d.workedMinutes,
      approvedExtraMinutes: d.approvedExtraMinutes,
      flags: d.flags,
      lateMinutes: d.lateMinutes,
      earlyLeaveMinutes: d.earlyLeaveMinutes,
      holiday: [...calendars].some((c) => holidays[c].has(d.date)), // eslint-disable-line security/detect-object-injection
    }));
    const s = suggestFromDays(days);
    const wanted = new Map<PayItemType, bigint>([
      ["absence_days", BigInt(s.absenceDayHundredths)],
      ["late_minutes", BigInt(s.lateMinutes)],
      ...EXTRA_KEYS.filter((k) => k !== "holidayPay").map((k) => [EXTRA_KEY_ITEM[k], BigInt(s.extra[k as keyof typeof s.extra])] as [PayItemType, bigint]), // eslint-disable-line security/detect-object-injection
    ]);

    const lineIds = new Set(own.map((l) => l.id));
    for (const type of SUGGESTED_TYPES) {
      const value = wanted.get(type) ?? 0n;
      const here = items.filter((i) => i.employeeId === employeeId && i.type === type && (i.runLineId === null || lineIds.has(i.runLineId)));
      if (here.some((i) => i.state === "confirmed")) continue; // never overwritten
      const active = here.find((i) => i.state === "suggested");

      if (value === 0n) {
        if (active) {
          await addItem(tx, actor, { runId, employeeId, runLineId: active.runLineId, type, state: "dismissed", value: decryptItemValue(active.id, active.valueEnc).value, reason: NO_LONGER_APPROVED });
          written += 1;
        }
        continue;
      }
      if (active) {
        if (decryptItemValue(active.id, active.valueEnc).value === value) continue;
        await addItem(tx, actor, { runId, employeeId, runLineId: active.runLineId, type, state: "suggested", value, reason: null });
        written += 1;
        continue;
      }
      // Nothing active. A Preparer's own removal of this very suggestion is respected; the refresh's own removal is not.
      const removedByPerson = here.some((i) => i.state === "dismissed" && decryptItemValue(i.id, i.valueEnc).reason !== NO_LONGER_APPROVED);
      if (removedByPerson) {
        let seen = false;
        for (const target of [null, ...lineIds]) if ((await suggestedValue(tx, runId, employeeId, target, type)) === value) seen = true;
        if (seen) continue;
      }
      await addItem(tx, actor, { runId, employeeId, runLineId: own.length === 1 ? own[0].id : null, type, state: "suggested", value, reason: null });
      written += 1;
    }
  }

  await writeAudit({ actor, action: "payroll.suggestions.refresh", targetType: "pay_run", targetId: runId, metadata: { items: written } }, tx);
  await logChange(tx, actor, { action: "suggestions_refreshed", runId, detail: { items: written } });
  return { written };
}

async function loadSuggestion(tx: Tx, runId: string, itemId: string): Promise<ItemRow> {
  const [item] = await tx.select().from(payRunItems).where(and(eq(payRunItems.id, itemId), eq(payRunItems.runId, runId))).limit(1);
  if (!item) throw new ActionFailure("That amount was not found.");
  const latest = (await latestItems(tx, runId)).find((i) => itemKey(i) === itemKey(item));
  if (latest?.id !== item.id || item.state !== "suggested") throw new ActionFailure("That amount has changed. Reload the page and try again.");
  return item;
}

async function lineOf(tx: Tx, runId: string, employeeId: string, runLineId: string): Promise<void> {
  const [line] = await tx
    .select({ id: payRunLines.id })
    .from(payRunLines)
    .where(and(eq(payRunLines.id, runLineId), eq(payRunLines.runId, runId), eq(payRunLines.employeeId, employeeId)))
    .limit(1);
  if (!line) throw new ActionFailure("That line is not on this run.");
}

/** Moves an unassigned suggestion onto a line: a suggestion on the line, and the unassigned one closed. Pay does not change. */
export async function applyAssign(tx: Tx, actor: Actor, v: { runId: string; itemId: string; runLineId: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const item = await loadSuggestion(tx, v.runId, v.itemId);
  await assertNotOwnEmployee(actor, item.employeeId, tx);
  if (item.runLineId !== null) throw new ActionFailure("That amount is already on a line.");
  await lineOf(tx, v.runId, item.employeeId, v.runLineId);
  const value = decryptItemValue(item.id, item.valueEnc).value;
  await addItem(tx, actor, { runId: v.runId, employeeId: item.employeeId, runLineId: item.runLineId, type: item.type, state: "dismissed", value, reason: ASSIGNED_TO_LINE });
  await addItem(tx, actor, { runId: v.runId, employeeId: item.employeeId, runLineId: v.runLineId, type: item.type, state: "suggested", value, reason: null });
  await writeAudit({ actor, action: "payroll.suggestion.assign", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: item.employeeId, type: item.type } }, tx);
  await logChange(tx, actor, { action: "item_saved", runId: v.runId, employeeId: item.employeeId, detail: { runLineId: v.runLineId, type: item.type, assigned: true, new: { state: "suggested", value: value.toString() } } });
}

/** Confirms a suggestion on a line, as it is or with another amount (which needs a reason). An unassigned one is assigned to that line first. */
export async function applyConfirm(tx: Tx, actor: Actor, v: { runId: string; itemId: string; runLineId: string; value?: string; reason?: string }): Promise<void> {
  await lockDraftRun(tx, v.runId);
  const item = await loadSuggestion(tx, v.runId, v.itemId);
  await assertNotOwnEmployee(actor, item.employeeId, tx);
  if (item.runLineId !== null && item.runLineId !== v.runLineId) throw new ActionFailure("That amount belongs to another line.");
  await lineOf(tx, v.runId, item.employeeId, v.runLineId);
  const suggested = decryptItemValue(item.id, item.valueEnc).value;
  if (item.runLineId === null) {
    await addItem(tx, actor, { runId: v.runId, employeeId: item.employeeId, runLineId: null, type: item.type, state: "dismissed", value: suggested, reason: ASSIGNED_TO_LINE });
  }
  await saveItem(tx, actor, {
    runId: v.runId,
    employeeId: item.employeeId,
    runLineId: v.runLineId,
    type: item.type as PayItemType,
    value: v.value?.trim() ? v.value : formatItemValue(item.type as PayItemType, suggested),
    reason: v.reason,
  });
  await writeAudit({ actor, action: "payroll.suggestion.confirm", targetType: "pay_run", targetId: v.runId, metadata: { employeeId: item.employeeId, type: item.type } }, tx);
  await logChange(tx, actor, { action: "suggestion_confirmed", runId: v.runId, employeeId: item.employeeId, detail: { runLineId: v.runLineId, type: item.type, suggested: suggested.toString(), changed: Boolean(v.value?.trim()) } });
}
