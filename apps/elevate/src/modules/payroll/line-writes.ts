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

/** The new version that carries a line's last day: a copy of `latest` (the version in force on that day) with `endsOn` set. */
export const insertEndVersion = (tx: Tx, actorId: string, latest: LineRow, endsOn: string) => insertCopy(tx, actorId, latest, { endsOn });

/** The version that withdraws a line. `tidy` marks one the doubled-rates tidy took away, so it can be listed and restored. */
export const insertWithdrawnVersion = (tx: Tx, actorId: string, latest: LineRow, tidy: boolean = false) =>
  insertCopy(tx, actorId, latest, { withdrawn: true, ...(tidy ? { tidyState: "removed" } : {}) });

/** The version that brings a withdrawn line back. "kept" stops the tidy taking it away again: someone decided this rate is real. */
export const insertRestoredVersion = (tx: Tx, actorId: string, latest: LineRow) => insertCopy(tx, actorId, latest, { withdrawn: false, tidyState: "kept" });
