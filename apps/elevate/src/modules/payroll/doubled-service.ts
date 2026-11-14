import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { clients, employees } from "@/modules/people/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { findDoubledRates, type DoubledInput } from "./doubled";
import { isWithdrawn, lineLastDay } from "./lines";
import { detailOf, insertRestoredVersion, insertWithdrawnVersion, newestVersion, type LineRow } from "./line-writes";
import { formatPesos } from "./money";
import { payLines, payRunLines, payRuns } from "./schema";
import { decryptLineAmounts } from "./service";

// Doubled rates: tidied automatically, restorable. A doubled rate is the same person and client with overlapping dates (see doubled.ts). The tidy
// takes away only the ones that were never on a real pay run; a paid one is left, flagged by the "paid twice" note, for a person to stop. Each
// tidied rate is written as a withdrawing version marked "removed"; a restore writes a newer version marked "kept", which the tidy leaves alone.

type Reader = Pick<typeof db, "select" | "selectDistinct">;
type Actor = { id: string; email: string };

/** The line keys that have been on a real pay run (not a test run, not a cancelled one). */
export async function lineKeysOnRealRuns(executor: Reader): Promise<Set<string>> {
  const used = await executor
    .selectDistinct({ lineKey: payLines.lineKey })
    .from(payRunLines)
    .innerJoin(payLines, eq(payLines.id, payRunLines.lineId))
    .innerJoin(payRuns, eq(payRuns.id, payRunLines.runId))
    .where(and(eq(payRuns.isTest, false), ne(payRuns.status, "cancelled")));
  return new Set(used.map((r) => r.lineKey));
}

/** Every doubled set of rates, with what each line's removal would do. Lines someone restored ("kept") are left out: they were decided on. */
export async function doubledRatesOf(executor: Reader) {
  const rows = await executor.select().from(payLines);
  const used = await lineKeysOnRealRuns(executor);
  const clientName = new Map((await executor.select({ id: clients.id, name: clients.name }).from(clients)).map((c) => [c.id, c.name]));
  const versionsByKey = new Map<string, LineRow[]>();
  for (const r of rows) versionsByKey.set(r.lineKey, [...(versionsByKey.get(r.lineKey) ?? []), r]);
  const latestOf = new Map<string, LineRow>();
  const inputs: DoubledInput[] = [];
  for (const [lineKey, versions] of versionsByKey) {
    if (isWithdrawn(versions)) continue;
    const newestWritten = [...versions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (newestWritten.tidyState === "kept") continue;
    const last = lineLastDay(versions);
    const live = last === null ? versions : versions.filter((v) => v.effectiveFrom <= last);
    if (live.length === 0) continue;
    const latest = [...live].sort(newestVersion)[0];
    latestOf.set(lineKey, latest);
    inputs.push({
      lineKey,
      employeeId: latest.employeeId,
      clientName: latest.clientId ? (clientName.get(latest.clientId) ?? null) : null,
      alias: latest.alias,
      first: live.reduce((min, v) => (v.effectiveFrom < min ? v.effectiveFrom : min), live[0].effectiveFrom),
      last,
      createdAt: Math.max(...versions.map((v) => v.createdAt.getTime())),
      onRealRun: used.has(lineKey),
    });
  }
  return { groups: findDoubledRates(inputs), latestOf, versionsByKey };
}

/**
 * The doubled rates the tidy would take away (never paid), as one text: their line keys, sorted and joined. Empty when there are none. The page
 * hands it to the browser, which tidies once for each different text, so a new double is tidied and one that cannot be removed does not loop.
 * Cheap enough for a page load; changes nothing and carries no figure.
 */
export async function doubledToTidyKey(executor: Reader): Promise<string> {
  const { groups } = await doubledRatesOf(executor);
  return groups
    .flatMap((g) => g.remove.filter((r) => r.how === "withdraw").map((r) => r.lineKey))
    .sort()
    .join(",");
}

/**
 * Takes away every doubled rate that was never on a real pay run (the newest of each set stays). A paid one is left and counted. Run inside a
 * transaction; safe to call again (it finds nothing the second time). Called when a pay run is made or filled, and from the Rates page.
 */
export async function autoTidyRates(tx: Tx, actor: Actor): Promise<{ removed: number; left: number }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pay_line_doubled'))`);
  const { groups, latestOf } = await doubledRatesOf(tx);
  let removed = 0;
  let left = 0;
  for (const group of groups) {
    for (const r of group.remove) {
      if (r.how !== "withdraw") {
        left += 1;
        continue;
      }
      const latest = latestOf.get(r.lineKey)!;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pay_line:${r.lineKey}`}))`);
      let amounts;
      try {
        amounts = await insertWithdrawnVersion(tx, actor.id, latest, true);
      } catch {
        // A figure that can't be read (a wrong or rotated key) is decrypted before anything is written, so this line is skipped and the rest go on.
        left += 1;
        continue;
      }
      await writeAudit({ actor, action: "payroll.line.withdraw", targetType: "pay_line", targetId: r.lineKey, metadata: { employeeId: latest.employeeId, auto: true } }, tx);
      await logChange(tx, actor, { action: "line_withdrawn", employeeId: latest.employeeId, lineKey: r.lineKey, detail: { old: detailOf(latest, amounts), reason: "Doubled rate removed automatically" } });
      removed += 1;
    }
  }
  return { removed, left };
}

/** A rate the tidy took away, as the Restore dialog shows it. */
export type RemovedRateView = { lineKey: string; employeeId: string; name: string; clientName: string | null; alias: string | null; monthly: string; since: string };

/** The rates the tidy took away and nobody restored, newest version first. */
export async function removedRatesOf(executor: Reader): Promise<{ views: RemovedRateView[]; latestOf: Map<string, LineRow> }> {
  const rows = await executor.select().from(payLines);
  const clientName = new Map((await executor.select({ id: clients.id, name: clients.name }).from(clients)).map((c) => [c.id, c.name]));
  const people = new Map(
    (await executor.select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees)).map((p) => [
      p.id,
      `${p.preferred?.trim() || p.first} ${p.last}`,
    ]),
  );
  const byKey = new Map<string, LineRow[]>();
  for (const r of rows) byKey.set(r.lineKey, [...(byKey.get(r.lineKey) ?? []), r]);
  const views: RemovedRateView[] = [];
  const latestOf = new Map<string, LineRow>();
  for (const [lineKey, versions] of byKey) {
    const written = [...versions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!written.withdrawn || written.tidyState !== "removed") continue;
    latestOf.set(lineKey, written);
    let monthly = "Can't be read";
    try {
      monthly = formatPesos(decryptLineAmounts(written.id, written.amountsEnc).monthlyCentavos);
    } catch {
      // The dialog just says the figure can't be read; nothing about the stored text is kept.
    }
    views.push({
      lineKey,
      employeeId: written.employeeId,
      name: people.get(written.employeeId) ?? "Unknown",
      clientName: written.clientId ? (clientName.get(written.clientId) ?? null) : null,
      alias: written.alias,
      monthly,
      since: versions.reduce((min, v) => (v.effectiveFrom < min ? v.effectiveFrom : min), versions[0].effectiveFrom),
    });
  }
  views.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.since < b.since ? -1 : 1));
  return { views, latestOf };
}

/** Brings the named tidied rates back, marked "kept" so the tidy leaves them alone. Run inside a transaction. Returns how many came back. */
export async function restoreRemovedRates(tx: Tx, actor: Actor, lineKeys: string[]): Promise<number> {
  const { latestOf } = await removedRatesOf(tx);
  let restored = 0;
  for (const lineKey of new Set(lineKeys)) {
    const latest = latestOf.get(lineKey);
    if (!latest) continue; // already restored, or never tidied away: nothing to do
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pay_line:${lineKey}`}))`);
    const amounts = await insertRestoredVersion(tx, actor.id, latest);
    await writeAudit({ actor, action: "payroll.line.restore", targetType: "pay_line", targetId: lineKey, metadata: { employeeId: latest.employeeId } }, tx);
    await logChange(tx, actor, { action: "line_restored", employeeId: latest.employeeId, lineKey, detail: { new: detailOf(latest, amounts), reason: "Restored after the doubled-rate tidy" } });
    restored += 1;
  }
  return restored;
}
