import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import type { Tx } from "@/modules/people/service";
import type { ChangeAction } from "./constants";
import { payChangeLog } from "./schema";

// The payroll change log: who did what, to which run, person or rate line. The detail (amounts, reasons) is encrypted, bound to its row.
// Call inside the same transaction as the change, so a rolled-back change leaves no log row.

export type ChangeEntry = {
  action: ChangeAction;
  runId?: string;
  employeeId?: string;
  lineKey?: string;
  detail?: Record<string, unknown>;
};

const contextFor = (id: string) => `pay_change:${id}`;

export async function logChange(tx: Tx, actor: { id: string }, entry: ChangeEntry): Promise<void> {
  const id = randomUUID();
  const detailEnc = fieldCrypto().encrypt(JSON.stringify(entry.detail ?? {}), contextFor(id));
  const isView = entry.action === "run_viewed";
  const insert = tx.insert(payChangeLog).values({
    id,
    actorId: actor.id,
    action: entry.action,
    runId: entry.runId ?? null,
    employeeId: entry.employeeId ?? null,
    lineKey: entry.lineKey ?? null,
    detailEnc,
    // Opening a run is logged once per person, run and day (company time zone).
    viewDay: isView ? formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd") : null,
  });
  // Only a repeated view is skipped (the view-row unique index, pay_change_log_view_idx); any other conflict is a real error and throws.
  if (isView) {
    await insert.onConflictDoNothing({
      target: [payChangeLog.actorId, payChangeLog.runId, payChangeLog.viewDay],
      where: sql`${payChangeLog.viewDay} is not null`,
    });
  } else {
    await insert;
  }
}

/** Decrypts a row's detail. Callers must already hold `payroll.view_history`. */
export function readChangeDetail(row: { id: string; detail_enc?: string; detailEnc?: string }): Record<string, unknown> {
  const stored = row.detailEnc ?? row.detail_enc;
  if (!stored) return {};
  return JSON.parse(fieldCrypto().decrypt(stored, contextFor(row.id))) as Record<string, unknown>;
}
