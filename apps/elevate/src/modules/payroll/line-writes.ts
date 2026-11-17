import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "@/modules/people/service";
import { payLines } from "./schema";
import { amountsToJson, decryptLineAmounts, encryptLineAmounts, type LineAmounts } from "./service";

// The new versions the pay-line tools write. Pay lines are append-only: ending, withdrawing and restoring a line are each a copy of its newest
// version with one thing changed. Each helper returns the decrypted amounts so the caller can write the change log.

export type LineRow = typeof payLines.$inferSelect;

/** What the change log keeps about a line version: the figures (encrypted with the log row) and the non-money fields. */
export const detailOf = (row: Pick<LineRow, "hoursPerDay" | "paymentMethod" | "effectiveFrom" | "endsOn" | "alias" | "clientId">, amounts: LineAmounts) => ({
  ...amountsToJson(amounts),
  hoursPerDay: row.hoursPerDay,
  paymentMethod: row.paymentMethod,
  effectiveFrom: row.effectiveFrom,
  endsOn: row.endsOn,
  alias: row.alias,
  clientId: row.clientId,
});

/** Newest first: later effective date, then later created_at. */
export const newestVersion = (a: LineRow, b: LineRow) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.createdAt.getTime() - a.createdAt.getTime());

/** A copy of `latest` with some fields changed, written as the newest version of the line. */
async function insertCopy(tx: Tx, actorId: string, latest: LineRow, change: Partial<Pick<LineRow, "endsOn" | "withdrawn" | "tidyState">>): Promise<LineAmounts> {
  const amounts = decryptLineAmounts(latest.id, latest.amountsEnc);
  const id = randomUUID();
  await tx.insert(payLines).values({
    id,
    lineKey: latest.lineKey,
    employeeId: latest.employeeId,
    clientId: latest.clientId,
    alias: latest.alias,
    hoursPerDay: latest.hoursPerDay,
    paymentMethod: latest.paymentMethod,
    endsOn: latest.endsOn,
    effectiveFrom: latest.effectiveFrom,
    ...change,
    amountsEnc: encryptLineAmounts(id, amounts),
    createdBy: actorId,
  });
  return amounts;
}

/**
 * Puts a default FTE count on a line's live versions: the version in force on `from` and every later one (a raise already scheduled), but
 * none dated after the line's last day (`last`; those never apply). `from` is the earlier of today and the first day of the earliest draft
 * run, so a draft built for an earlier cutoff picks the count up. Each is a copy, written as the newest version at the SAME effective date, so
 * the new count wins there without a new date and without a "new rate" flag. `null` clears the count ("not set"). A rate paid per FTE
 * (internal team) has no count and is left alone. Returns null when nothing changed (the count was already that).
 */
export async function setFteOnLine(
  tx: Tx,
  actorId: string,
  versions: LineRow[],
  fteHundredths: number | null,
  from: string,
  last: string | null = null,
): Promise<{ old: ReturnType<typeof detailOf>; new: ReturnType<typeof detailOf> } | null> {
  const sorted = [...versions].sort(newestVersion);
  const dates = [...new Set(sorted.map((v) => v.effectiveFrom))].sort().filter((d) => last === null || d <= last);
  if (dates.length === 0) return null;
  const inForce = [...dates].reverse().find((d) => d <= from) ?? dates[0];
  let first: { old: ReturnType<typeof detailOf>; new: ReturnType<typeof detailOf> } | null = null;
  for (const date of dates.filter((d) => d >= inForce)) {
    const source = sorted.find((v) => v.effectiveFrom === date)!;
    const before = decryptLineAmounts(source.id, source.amountsEnc);
    if (before.perFteCentavos !== undefined || (before.fteHundredths ?? null) === fteHundredths) continue;
    const { fteHundredths: _old, ...rest } = before;
    void _old;
    const after: LineAmounts = fteHundredths === null ? rest : { ...rest, fteHundredths };
    const id = randomUUID();
    await tx.insert(payLines).values({
      id,
      lineKey: source.lineKey,
      employeeId: source.employeeId,
      clientId: source.clientId,
      alias: source.alias,
      hoursPerDay: source.hoursPerDay,
      paymentMethod: source.paymentMethod,
      endsOn: source.endsOn,
      effectiveFrom: source.effectiveFrom,
      amountsEnc: encryptLineAmounts(id, after),
      createdBy: actorId,
    });
    first ??= { old: detailOf(source, before), new: detailOf(source, after) };
  }
  return first;
}

/** The new version that carries a line's last day: a copy of `latest` (the version in force on that day) with `endsOn` set. */
export const insertEndVersion = (tx: Tx, actorId: string, latest: LineRow, endsOn: string) => insertCopy(tx, actorId, latest, { endsOn });

/** The version that withdraws a line. `tidy` marks one the doubled-rates tidy took away, so it can be listed and restored. */
export const insertWithdrawnVersion = (tx: Tx, actorId: string, latest: LineRow, tidy: boolean = false) =>
  insertCopy(tx, actorId, latest, { withdrawn: true, ...(tidy ? { tidyState: "removed" } : {}) });

/** The version that brings a withdrawn line back. "kept" stops the tidy taking it away again: someone decided this rate is real. */
export const insertRestoredVersion = (tx: Tx, actorId: string, latest: LineRow) => insertCopy(tx, actorId, latest, { withdrawn: false, tidyState: "kept" });
