import "server-only";
import { desc, eq, lte } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { employees } from "@/modules/people/schema";
import type { SettingsSnapshot } from "./calculate";
import { paySettings } from "./schema";

// Helpers that take the acting user or a transaction as a parameter live here, not in actions.ts ("use server" files are public endpoints).

/** Today as YYYY-MM-DD in the company time zone (a pay date never depends on the viewer's zone). */
export const payrollToday = (): string => formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

type Executor = Pick<typeof db, "select">;

/** The people record linked to a sign-in account, or null when the account has none. */
export async function employeeIdForUser(executor: Executor, userId: string): Promise<string | null> {
  const [row] = await executor.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
  return row?.id ?? null;
}

/** Nobody changes their own pay: refuses when the line belongs to the acting user's own people record. */
export async function assertNotOwnEmployee(actor: { id: string }, employeeId: string, executor: Executor = db): Promise<void> {
  const own = await employeeIdForUser(executor, actor.id);
  if (own !== null && own === employeeId) throw new ActionFailure("You can't change your own pay.");
}

/** The settings that apply on a date: the newest version dated on or before it (ties go to the newest row). */
export async function settingsInForce(executor: Executor, date: string): Promise<SettingsSnapshot> {
  const [row] = await executor
    .select()
    .from(paySettings)
    .where(lte(paySettings.effectiveFrom, date))
    .orderBy(desc(paySettings.effectiveFrom), desc(paySettings.createdAt))
    .limit(1);
  if (!row) throw new ActionFailure("No pay settings are in force on that date.");
  return snapshotOf(row);
}

export function snapshotOf(row: typeof paySettings.$inferSelect): SettingsSnapshot {
  return {
    cutoffDivisor: row.cutoffDivisor,
    changeWarnBp: row.changeWarnBp,
    multipliersBp: {
      regular: row.extraRegularBp,
      holiday: row.extraHolidayBp,
      restDay: row.extraRestDayBp,
      restDayOver8: row.extraRestDayOver8Bp,
      holidayPay: row.holidayBp,
    },
  };
}

/** What a line's `amounts_enc` holds. Centavos and cents are bigints in memory and strings on the wire. */
export type LineAmounts = { monthlyCentavos: bigint; pesoAllowanceCentavos: bigint; dollarAllowanceCents: bigint };
export type LineAmountsJson = { [K in keyof LineAmounts]: string };

const lineContext = (id: string) => `pay_line:${id}`;

export const amountsToJson = (a: LineAmounts): LineAmountsJson => ({
  monthlyCentavos: a.monthlyCentavos.toString(),
  pesoAllowanceCentavos: a.pesoAllowanceCentavos.toString(),
  dollarAllowanceCents: a.dollarAllowanceCents.toString(),
});

export function encryptLineAmounts(lineId: string, a: LineAmounts): string {
  return fieldCrypto().encrypt(JSON.stringify(amountsToJson(a)), lineContext(lineId));
}

export function decryptLineAmounts(lineId: string, stored: string): LineAmounts {
  const j = JSON.parse(fieldCrypto().decrypt(stored, lineContext(lineId))) as LineAmountsJson;
  return {
    monthlyCentavos: BigInt(j.monthlyCentavos),
    pesoAllowanceCentavos: BigInt(j.pesoAllowanceCentavos),
    dollarAllowanceCents: BigInt(j.dollarAllowanceCents),
  };
}
