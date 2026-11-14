"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { HOLIDAY_BP } from "./calculate";
import { logChange } from "./changes";
import { lineLastDay } from "./lines";
import { parseMoney } from "./money";
import { payLines, paySettings } from "./schema";
import { amountsToJson, decryptLineAmounts, encryptLineAmounts, settingsInForce, type LineAmounts } from "./service";
import { releaseRun } from "./statements";
import { archiveRun, cancelRun, confirmLine, createRun, dismissItem, purgeArchivedRuns, removeRunLine, restoreRun, restoreRunLine, saveItem, setRunTest, syncRunPeople } from "./runs";
import { applyAssign, applyConfirm, applyRefresh } from "./suggestions";
import { readJibbleTimesheet } from "./jibble/timesheet";
import { MAX_XLSX_BYTES, XlsxError } from "./jibble/xlsx";
import { applyTimesheet, confirmAllSuggestions as confirmAll, discardTimesheet, saveTimesheetUpload } from "./timesheet-import";
import { approve, sendBack, submit } from "./approval";
import { recordPayment, remitlyList } from "./payments";
import {
  applyTimesheetSchema,
  approveRunSchema,
  confirmAllSuggestionsSchema,
  discardTimesheetSchema,
  exportRemitlySchema,
  markPaidSchema,
  sendBackRunSchema,
  submitRunSchema,
  assignSuggestionSchema,
  confirmSuggestionSchema,
  refreshSuggestionsSchema,
  uploadTimesheetSchema,
  removePersonFromRunSchema,
  restorePersonToRunSchema,
  updateRunPeopleSchema,
  cancelPayRunSchema,
  confirmRunLineSchema,
  createPayLineSchema,
  archiveRunSchema,
  createPayRunSchema,
  dismissPayItemSchema,
  endPayLineSchema,
  markRunTestSchema,
  releaseStatementsSchema,
  restoreRunSchema,
  savePayItemSchema,
  savePaySettingsSchema,
  updatePayLineSchema,
} from "./validators";

// Every action: requireUser() first, then authorize() inside runAction, then Zod. Each change writes the payroll change log (amounts and
// reasons only inside its encrypted detail) and an audit row (ids only) in the same transaction.

const BAD_REQUEST = "Check the request and try again.";

const refreshed = () => {
  revalidatePath("/payroll/rates");
  revalidatePath("/payroll/settings");
};

/** One writer per line (or per settings table) at a time, so two edits cannot both pass the date checks. */
const lock = (tx: Tx, key: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

type LineRow = typeof payLines.$inferSelect;

/** Every version of a line, newest first (later effective date, then later created_at). */
async function versionsOf(tx: Tx, lineKey: string): Promise<LineRow[]> {
  return tx.select().from(payLines).where(eq(payLines.lineKey, lineKey)).orderBy(desc(payLines.effectiveFrom), desc(payLines.createdAt));
}

/** The person must not be separated or archived (onboarding, active, probation and on leave are all paid), and the client (when given) must not be archived. */
async function checkPersonAndClient(tx: Tx, employeeId: string, clientId: string | null | undefined) {
  const [person] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, employeeId), isNull(employees.archivedAt), ne(employees.status, "separated")))
    .limit(1);
  if (!person) return fail("That person was not found.");
  if (clientId) {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), isNull(clients.archivedAt))).limit(1);
    if (!client) return fail("That client was not found.");
  }
  return null;
}

const amountsOf = (v: { monthly: string; otRegular?: number | null; otRestDay?: number | null; otRestDayOver8?: number | null }): LineAmounts => {
  const otBp: Partial<Record<"regular" | "restDay" | "restDayOver8", number>> = {};
  if (v.otRegular != null) otBp.regular = v.otRegular;
  if (v.otRestDay != null) otBp.restDay = v.otRestDay;
  if (v.otRestDayOver8 != null) otBp.restDayOver8 = v.otRestDayOver8;
  return { monthlyCentavos: parseMoney(v.monthly) ?? 0n, ...(Object.keys(otBp).length > 0 ? { otBp } : {}) };
};

/** What the change log keeps about a line version: the figures (encrypted with the log row) and the non-money fields. */
const detailOf = (row: Pick<LineRow, "hoursPerDay" | "paymentMethod" | "effectiveFrom" | "endsOn" | "alias" | "clientId">, amounts: LineAmounts) => ({
  ...amountsToJson(amounts),
  hoursPerDay: row.hoursPerDay,
  paymentMethod: row.paymentMethod,
  effectiveFrom: row.effectiveFrom,
  endsOn: row.endsOn,
  alias: row.alias,
  clientId: row.clientId,
});

/**
 * A second pay line for the same person, client and alias whose dates overlap the new one would pay the person twice for the same cutoff
 * (each line pays a full cutoff). Refused with a plain way out. Different aliases, different clients and lines that do not overlap are fine.
 */
async function refuseDuplicateLine(tx: Tx, v: { employeeId: string; clientId: string | null; alias: string | null; from: string; to: string | null; exceptLineKey?: string }) {
  const rows = await tx.select().from(payLines).where(eq(payLines.employeeId, v.employeeId));
  const byKey = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) byKey.set(r.lineKey, [...(byKey.get(r.lineKey) ?? []), r]);
  const wanted = (v.alias ?? "").trim().toLowerCase();
  for (const group of byKey.values()) {
    if (group[0].lineKey === v.exceptLineKey) continue;
    const newest = [...group].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.createdAt.getTime() - a.createdAt.getTime()))[0];
    if ((newest.clientId ?? null) !== v.clientId || (newest.alias ?? "").trim().toLowerCase() !== wanted) continue;
    const start = group.map((g) => g.effectiveFrom).sort()[0];
    const end = lineLastDay(group);
    if (start <= (v.to ?? "9999-12-31") && v.from <= (end ?? "9999-12-31")) {
      return fail(
        `This person already has a pay line for the same client and alias from ${start}${end ? ` to ${end}` : ""}. A second one for the same dates would pay them twice. Change that line instead (the change keeps its history), or end it before this one starts. To pay them for two roles, give each line its own alias.`,
      );
    }
  }
  return null;
}

export async function createPayLine(input: unknown): Promise<ActionResult<{ lineKey: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_rates");

    const parsed = createPayLineSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const v = parsed.data;

    const result = await db.transaction(async (tx) => {
      const refused = await checkPersonAndClient(tx, v.employeeId, v.clientId);
      if (refused) return refused;
      const duplicate = await refuseDuplicateLine(tx, { employeeId: v.employeeId, clientId: v.clientId ?? null, alias: v.alias ?? null, from: v.effectiveFrom, to: v.endsOn ?? null });
      if (duplicate) return duplicate;

      const id = randomUUID();
      const lineKey = randomUUID();
      const amounts = amountsOf(v);
      const row = {
        id,
        lineKey,
        employeeId: v.employeeId,
        clientId: v.clientId ?? null,
        alias: v.alias ?? null,
        hoursPerDay: v.hoursPerDay,
        paymentMethod: v.paymentMethod,
        endsOn: v.endsOn ?? null,
        effectiveFrom: v.effectiveFrom,
        amountsEnc: encryptLineAmounts(id, amounts),
        createdBy: actor.id,
      };
      await tx.insert(payLines).values(row);
      await writeAudit({ actor, action: "payroll.line.create", targetType: "pay_line", targetId: lineKey, metadata: { employeeId: v.employeeId } }, tx);
      await logChange(tx, actor, { action: "line_created", employeeId: v.employeeId, lineKey, detail: { new: detailOf(row, amounts) } });
      return { ok: true, data: { lineKey } } as const;
    });

    if (result.ok) refreshed();
    return result;
  });
}

/** A change is a new version of the line with its own effective date; nothing is overwritten. */
export async function updatePayLine(input: unknown): Promise<ActionResult<{ lineKey: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_rates");

    const parsed = updatePayLineSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const { reason, lineKey, ...v } = parsed.data;

    const result = await db.transaction(async (tx) => {
      await lock(tx, `pay_line:${lineKey}`);
      const versions = await versionsOf(tx, lineKey);
      const latest = versions[0];
      if (!latest) return fail("That pay line was not found.");
      const refused = await checkPersonAndClient(tx, latest.employeeId, v.clientId);
      if (refused) return refused;
      if (lineLastDay(versions) !== null) return fail("This pay line has ended. Add a new line instead.");
      if (v.effectiveFrom < latest.effectiveFrom) return fail("The new version can't start before the current one does.");
      // Changing the client or alias must not make this line a twin of another line of the same person.
      if ((v.clientId ?? null) !== (latest.clientId ?? null) || (v.alias ?? "").trim().toLowerCase() !== (latest.alias ?? "").trim().toLowerCase()) {
        const from = versions.map((x) => x.effectiveFrom).sort()[0];
        const twin = await refuseDuplicateLine(tx, { employeeId: latest.employeeId, clientId: v.clientId ?? null, alias: v.alias ?? null, from, to: v.endsOn ?? null, exceptLineKey: lineKey });
        if (twin) return twin;
      }

      const before = decryptLineAmounts(latest.id, latest.amountsEnc);
      const id = randomUUID();
      const amounts = amountsOf(v);
      const row = {
        id,
        lineKey,
        employeeId: latest.employeeId,
        clientId: v.clientId ?? null,
        alias: v.alias ?? null,
        hoursPerDay: v.hoursPerDay,
        paymentMethod: v.paymentMethod,
        endsOn: v.endsOn ?? null,
        effectiveFrom: v.effectiveFrom,
        amountsEnc: encryptLineAmounts(id, amounts),
        createdBy: actor.id,
      };
      await tx.insert(payLines).values(row);
      await writeAudit({ actor, action: "payroll.line.update", targetType: "pay_line", targetId: lineKey, metadata: { employeeId: latest.employeeId } }, tx);
      await logChange(tx, actor, {
        action: "line_updated",
        employeeId: latest.employeeId,
        lineKey,
        detail: { old: detailOf(latest, before), new: detailOf(row, amounts), reason },
      });
      return { ok: true, data: { lineKey } } as const;
    });

    if (result.ok) refreshed();
    return result;
  });
}

/** Ending a line is a new version, dated like the latest one, that carries the last day. */
export async function endPayLine(input: unknown): Promise<ActionResult<{ lineKey: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_rates");

    const parsed = endPayLineSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const { lineKey, endsOn, reason } = parsed.data;

    const result = await db.transaction(async (tx) => {
      await lock(tx, `pay_line:${lineKey}`);
      const versions = await versionsOf(tx, lineKey);
      if (versions.length === 0) return fail("That pay line was not found.");
      const employeeId = versions[0].employeeId;
      // No status check here: ending a line is what is done for a leaver, who may already be separated or archived.
      if (lineLastDay(versions) !== null) return fail("This pay line has already ended.");
      // The end is dated like the version in force on the last day, so a version scheduled for after it is ignored.
      const latest = versions.find((x) => x.effectiveFrom <= endsOn);
      if (!latest) return fail("The last day can't be before the line starts.");

      const amounts = decryptLineAmounts(latest.id, latest.amountsEnc);
      const id = randomUUID();
      await tx.insert(payLines).values({
        id,
        lineKey,
        employeeId,
        clientId: latest.clientId,
        alias: latest.alias,
        hoursPerDay: latest.hoursPerDay,
        paymentMethod: latest.paymentMethod,
        endsOn,
        effectiveFrom: latest.effectiveFrom,
        amountsEnc: encryptLineAmounts(id, amounts),
        createdBy: actor.id,
      });
      await writeAudit({ actor, action: "payroll.line.end", targetType: "pay_line", targetId: lineKey, metadata: { employeeId } }, tx);
      await logChange(tx, actor, { action: "line_ended", employeeId, lineKey, detail: { old: detailOf(latest, amounts), endsOn, reason } });
      return { ok: true, data: { lineKey } } as const;
    });

    if (result.ok) refreshed();
    return result;
  });
}

const refreshedRun = (runId?: string) => {
  revalidatePath("/payroll");
  if (runId) revalidatePath(`/payroll/${runId}`);
};

/** Builds a draft run for a period. Refuses a period that overlaps an existing run. */
export async function createPayRun(input: unknown): Promise<ActionResult<{ runId: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = createPayRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const created = await db.transaction((tx) => createRun(tx, actor, { periodStart: parsed.data.periodStart, periodEnd: parsed.data.periodEnd }, { test: parsed.data.test === true }));
    refreshedRun();
    return { ok: true, data: { runId: created.runId } } as const;
  });
}

/** Confirms or overrides an amount for one line of a draft run, then recomputes that person's lines. */
export async function savePayItem(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = savePayItemSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => saveItem(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Removes an amount from a line (a new "dismissed" row; the old one stays in the history). */
export async function dismissPayItem(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = dismissPayItemSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => dismissItem(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Reads the approved hours and writes suggested amounts. Pay does not change until a Preparer confirms one. */
export async function refreshSuggestions(input: unknown): Promise<ActionResult<{ written: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = refreshSuggestionsSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const done = await db.transaction((tx) => applyRefresh(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: done } as const;
  });
}

/** Confirms a suggestion on a line, as suggested or with another amount (a reason is needed then). */
export async function confirmSuggestion(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = confirmSuggestionSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => applyConfirm(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Chooses the pay line an unassigned suggestion belongs to. */
export async function assignSuggestion(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = assignSuggestionSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => applyAssign(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Cancels a draft run (for example when pay lines changed after it was built). The run stays on record and its period is free again. */
export async function cancelPayRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = cancelPayRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => cancelRun(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Marks a run as a test run (until it is paid), or makes a draft test run a real run again. */
export async function markRunAsTest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_test_runs");

    const parsed = markRunTestSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => setRunTest(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Deletes every archived test run and archived cancelled run for good (with its test invoices). Returns what was deleted and what had to stay. */
export async function purgeArchivedPayRuns(): Promise<ActionResult<{ runsDeleted: number; invoicesDeleted: number; runsKept: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.purge_archived");
    const r = await db.transaction((tx) => purgeArchivedRuns(tx, actor));
    revalidatePath("/payroll");
    revalidatePath("/invoices");
    return { ok: true, data: { runsDeleted: r.runsDeleted, invoicesDeleted: r.invoicesDeleted, runsKept: r.runsKept } } as const;
  });
}

/** Archives a test run or a cancelled run (a real run in any other status can never be archived): it leaves the lists but stays on record. */
export async function archivePayRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_test_runs");

    const parsed = archiveRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => archiveRun(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Brings an archived test run back. */
export async function restorePayRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_test_runs");

    const parsed = restoreRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => restoreRun(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Releases a real, approved run's contractor payment statements to the people on it (Preparers and Approvers). Once; never undone. Notices carry no amount. */
export async function releaseStatements(input: unknown): Promise<ActionResult<{ people: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.release_statements");

    const parsed = releaseStatementsSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const released = await db.transaction((tx) => releaseRun(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    revalidatePath("/payroll/statements");
    revalidatePath(`/payroll/statements/${parsed.data.runId}`);
    revalidatePath("/my-pay");
    return { ok: true, data: released } as const;
  });
}

/** A Preparer other than the line's owner checks the line. Any later change to the line clears the confirmation. */
export async function confirmRunLine(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = confirmRunLineSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => confirmLine(tx, actor, parsed.data.runLineId));
    refreshedRun();
    revalidatePath("/payroll/[runId]", "page");
    return { ok: true, data: undefined } as const;
  });
}

/** Sends a draft for review. Refused while any check blocks; the checks are worked out again under the run lock. */
export async function submitRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = submitRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => submit(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Returns a run in review to draft with a note for the Preparer. */
export async function sendBackRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.approve");

    const parsed = sendBackRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => sendBack(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/**
 * Approves a run in review, against the hash the page was given. Refused for anyone who prepared or changed the run, and when the run
 * changed since the page loaded ("This payroll changed. Reload and review it again.").
 */
export async function approveRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.approve");

    const parsed = approveRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => approve(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** The Remitly list (person, alias, pesos and payout details: full for a real run, masked for a test run) for an approved run. Preparers and Approvers. Audited and rate limited. */
export async function exportRemitlyList(input: unknown): Promise<ActionResult<{ fileName: string; csv: string; rows: number; missingDetails: number; test: boolean }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.export");

    const parsed = exportRemitlySchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");

    const built = await db.transaction((tx) => remitlyList(tx, actor, parsed.data.runId));
    return { ok: true, data: built } as const;
  });
}

/** Records that a person on an approved run was paid (their Remitly reference and date). Marking again corrects it. Never your own pay. */
export async function markPaid(input: unknown): Promise<ActionResult<{ runPaid: boolean }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.mark_paid");

    const parsed = markPaidSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const result = await db.transaction((tx) => recordPayment(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: result } as const;
  });
}

/** Settings are append-only too: a change is a new row with an effective date. */
export async function savePaySettings(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_rates");

    const parsed = savePaySettingsSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const v = parsed.data;

    const result = await db.transaction(async (tx) => {
      await lock(tx, "pay_settings");
      const [same] = await tx.select({ id: paySettings.id }).from(paySettings).where(eq(paySettings.effectiveFrom, v.effectiveFrom)).limit(1);
      if (same) return fail("There is already a version of the settings with that date. Choose a later date.");

      const old = await settingsInForce(tx, v.effectiveFrom);
      const next = {
        cutoffDivisor: v.cutoffDivisor,
        changeWarnBp: v.changeWarnPercent * 100,
        multipliersBp: { regular: v.extraRegular, restDay: v.extraRestDay, restDayOver8: v.extraRestDayOver8, holiday: HOLIDAY_BP },
      };
      await tx.insert(paySettings).values({
        effectiveFrom: v.effectiveFrom,
        cutoffDivisor: next.cutoffDivisor,
        extraRegularBp: v.extraRegular,
        extraRestDayBp: v.extraRestDay,
        extraRestDayOver8Bp: v.extraRestDayOver8,
        changeWarnBp: next.changeWarnBp,
        createdBy: actor.id,
      });
      await writeAudit({ actor, action: "payroll.settings.update", targetType: "pay_settings", targetId: v.effectiveFrom }, tx);
      await logChange(tx, actor, { action: "settings_changed", detail: { effectiveFrom: v.effectiveFrom, old, new: next, reason: v.reason ?? null } });
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) refreshed();
    return result;
  });
}

/** Brings a draft run up to date with the Rates tab: adds people, moves lines to a newer rate, takes off lines no longer in force. */
export async function updateRunPeople(input: unknown): Promise<ActionResult<{ added: number; updated: number; removed: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = updateRunPeopleSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const done = await db.transaction((tx) => syncRunPeople(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: done } as const;
  });
}

/** Takes one person off a draft run (their line and amounts stay on record and are ignored). */
export async function removePersonFromRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = removePersonFromRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => removeRunLine(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Puts a removed person back on the draft run. */
export async function restorePersonToRun(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = restorePersonToRunSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => restoreRunLine(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/**
 * Reads a Jibble timesheet file (.xlsx) uploaded for a draft run and keeps its totals, encrypted, for the preview. Rate limited. The file
 * is checked by its contents, never its name or type; only totals per member are kept, never clock times.
 */
export async function uploadJibbleTimesheet(formData: FormData): Promise<ActionResult<{ importId: string; members: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");

    const runId = uploadTimesheetSchema.safeParse({ runId: formData.get("runId") });
    const file = formData.get("file");
    if (!runId.success || !(file instanceof File)) return fail(BAD_REQUEST);
    if (file.size === 0 || file.size > MAX_XLSX_BYTES) return fail("Choose the Excel file exported from Jibble (up to 8 MB).");

    let timesheet;
    try {
      timesheet = readJibbleTimesheet(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      if (error instanceof XlsxError) return fail(error.message);
      console.error("payroll timesheet upload unreadable:", { error: error instanceof Error ? error.name : "UnknownError" });
      return fail("That file could not be read. Export the timesheet from Jibble again.");
    }

    const done = await db.transaction((tx) => saveTimesheetUpload(tx, actor, runId.data.runId, timesheet));
    refreshedRun(runId.data.runId);
    return { ok: true, data: done } as const;
  });
}

/** Fills the draft run with suggested amounts from the uploaded timesheet, for the members the Preparer matched. */
export async function applyJibbleTimesheet(input: unknown): Promise<ActionResult<{ lines: number; written: number; kept: number; held: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = applyTimesheetSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const done = await db.transaction((tx) => applyTimesheet(tx, actor, parsed.data));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: done } as const;
  });
}

/** Throws away an uploaded timesheet without using it. */
export async function discardJibbleTimesheet(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = discardTimesheetSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    await db.transaction((tx) => discardTimesheet(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: undefined } as const;
  });
}

/** Confirms every suggested amount that sits on a line, as suggested (after the Preparer has read them). */
export async function confirmAllSuggestions(input: unknown): Promise<ActionResult<{ confirmed: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.prepare");

    const parsed = confirmAllSuggestionsSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);

    const done = await db.transaction((tx) => confirmAll(tx, actor, parsed.data.runId));
    refreshedRun(parsed.data.runId);
    return { ok: true, data: done } as const;
  });
}
