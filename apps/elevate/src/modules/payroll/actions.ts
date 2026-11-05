"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { parseMoney } from "./money";
import { payLines, paySettings } from "./schema";
import { amountsToJson, assertNotOwnEmployee, decryptLineAmounts, encryptLineAmounts, settingsInForce, type LineAmounts } from "./service";
import { createPayLineSchema, endPayLineSchema, savePaySettingsSchema, updatePayLineSchema } from "./validators";

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

async function latestVersion(tx: Tx, lineKey: string): Promise<LineRow | undefined> {
  const [row] = await tx
    .select()
    .from(payLines)
    .where(eq(payLines.lineKey, lineKey))
    .orderBy(desc(payLines.effectiveFrom), desc(payLines.createdAt))
    .limit(1);
  return row;
}

const amountsOf = (v: { monthly: string; pesoAllowance: string; dollarAllowance: string }): LineAmounts => ({
  monthlyCentavos: parseMoney(v.monthly) ?? 0n,
  pesoAllowanceCentavos: parseMoney(v.pesoAllowance) ?? 0n,
  dollarAllowanceCents: parseMoney(v.dollarAllowance) ?? 0n,
});

/** What the change log keeps about a line version: the figures (encrypted with the log row) and the non-money fields. */
const detailOf = (row: Pick<LineRow, "hoursPerDay" | "fte" | "paymentMethod" | "effectiveFrom" | "endsOn" | "alias" | "clientId">, amounts: LineAmounts) => ({
  ...amountsToJson(amounts),
  hoursPerDay: row.hoursPerDay,
  fte: row.fte,
  paymentMethod: row.paymentMethod,
  effectiveFrom: row.effectiveFrom,
  endsOn: row.endsOn,
  alias: row.alias,
  clientId: row.clientId,
});

export async function createPayLine(input: unknown): Promise<ActionResult<{ lineKey: string }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "payroll.manage_rates");

    const parsed = createPayLineSchema.safeParse(input);
    if (!parsed.success) return fail(BAD_REQUEST);
    const v = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [person] = await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.id, v.employeeId), isNull(employees.archivedAt))).limit(1);
      if (!person) return fail("That person was not found.");
      await assertNotOwnEmployee(actor, v.employeeId, tx);
      if (v.clientId) {
        const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, v.clientId)).limit(1);
        if (!client) return fail("That client was not found.");
      }

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
        fte: v.fte,
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
      const latest = await latestVersion(tx, lineKey);
      if (!latest) return fail("That pay line was not found.");
      await assertNotOwnEmployee(actor, latest.employeeId, tx);
      if (latest.endsOn) return fail("This pay line has ended. Add a new line instead.");
      if (v.effectiveFrom < latest.effectiveFrom) return fail("The new version can't start before the current one does.");
      if (v.clientId) {
        const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, v.clientId)).limit(1);
        if (!client) return fail("That client was not found.");
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
        fte: v.fte,
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
      const latest = await latestVersion(tx, lineKey);
      if (!latest) return fail("That pay line was not found.");
      await assertNotOwnEmployee(actor, latest.employeeId, tx);
      if (latest.endsOn) return fail("This pay line has already ended.");
      if (endsOn < latest.effectiveFrom) return fail("The last day can't be before the current version starts.");

      const amounts = decryptLineAmounts(latest.id, latest.amountsEnc);
      const id = randomUUID();
      await tx.insert(payLines).values({
        id,
        lineKey,
        employeeId: latest.employeeId,
        clientId: latest.clientId,
        alias: latest.alias,
        hoursPerDay: latest.hoursPerDay,
        paymentMethod: latest.paymentMethod,
        fte: latest.fte,
        endsOn,
        effectiveFrom: latest.effectiveFrom,
        amountsEnc: encryptLineAmounts(id, amounts),
        createdBy: actor.id,
      });
      await writeAudit({ actor, action: "payroll.line.end", targetType: "pay_line", targetId: lineKey, metadata: { employeeId: latest.employeeId } }, tx);
      await logChange(tx, actor, { action: "line_ended", employeeId: latest.employeeId, lineKey, detail: { endsOn, reason } });
      return { ok: true, data: { lineKey } } as const;
    });

    if (result.ok) refreshed();
    return result;
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
        multipliersBp: { regular: v.extraRegular, holiday: v.extraHoliday, restDay: v.extraRestDay, restDayOver8: v.extraRestDayOver8, holidayPay: v.holiday },
      };
      await tx.insert(paySettings).values({
        effectiveFrom: v.effectiveFrom,
        cutoffDivisor: next.cutoffDivisor,
        extraRegularBp: v.extraRegular,
        extraHolidayBp: v.extraHoliday,
        extraRestDayBp: v.extraRestDay,
        extraRestDayOver8Bp: v.extraRestDayOver8,
        holidayBp: v.holiday,
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
