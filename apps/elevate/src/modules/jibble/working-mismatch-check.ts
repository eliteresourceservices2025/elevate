import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { MINUTE, replayClock } from "@/modules/attendance/clock";
import { loadRecentEvents, lockEmployeeClock, monitoringPolicyPublished } from "@/modules/attendance/service";
import { notify } from "@/modules/notifications/service";
import { timeNoticeUserIds } from "@/modules/org/service";
import { writeAudit } from "@/modules/audit/write";
import { mirrorSendsEnabled, selfTestEmails, sendsAllowed } from "./client";
import type { JibbleClient } from "./http-client";
import { closeWorkingMismatches, recordOutMismatch, recordWorkingMismatch } from "./mismatch-lifecycle";
import { claimJibbleOperation, finishJibbleOperation, runGuardedJibbleEffect } from "./operation-guard";
import { createJibbleStartProposal } from "./jibble-proposal";
import { jibbleLinkLog } from "./schema";
import { eq } from "drizzle-orm";

/** Observe one person's mismatch; uncertain Jibble-only entries become review issues, never automatic hours. */
export async function checkWorkingMismatch(employeeId: string, client: JibbleClient, now = new Date()): Promise<"checked" | "skipped" | "unknown"> {
  if (!mirrorSendsEnabled()) return "skipped";
  const token = await claimJibbleOperation(employeeId, { kind: "reconcile" });
  if (!token) return "skipped";
  let wakeQueue = false;
  try {
    const eligible = async (executor: Pick<typeof db, "execute" | "select" | "insert" | "update" | "delete"> = db, ignoreLogId?: string) => {
      const [row] = (await executor.execute(sql`select p.jibble_person_id, u.email, coalesce(r.jibble_mirror, false) as enabled,
        coalesce((select paused from time.jibble_settings where id = 1), false) as paused,
        exists(select 1 from time.jibble_link_log l where l.employee_id = e.id and l.status = 'queued' ${ignoreLogId ? sql`and l.id <> ${ignoreLogId}::uuid` : sql``}) as queued
        from core.employees e join time.jibble_people p on p.employee_id = e.id
        left join core.users u on u.id = e.user_id left join time.clock_rules r on r.team_id = e.team_id
        where e.id = ${employeeId} and e.archived_at is null and e.status <> 'separated'`)) as unknown as
          { jibble_person_id: string; email: string | null; enabled: boolean; paused: boolean; queued: boolean }[];
      if (!row || row.paused || row.queued || !sendsAllowed(row.jibble_person_id)) return null;
      const selfTest = row.email !== null && selfTestEmails().includes(row.email.trim().toLowerCase());
      if (!selfTest && (!row.enabled || !(await monitoringPolicyPublished(executor)))) return null;
      return row;
    };
    const initial = await eligible();
    if (!initial) return "skipped";
    const before = await loadRecentEvents(db, employeeId, 60);
    const last = before.at(-1);
    const beforeState = replayClock(before).state;
    if (last && now.getTime() - last.at < 3 * MINUTE) return "skipped";
    if (beforeState === "break") {
      return await db.transaction(async (tx) => {
        await lockEmployeeClock(tx, employeeId);
        const after = await loadRecentEvents(tx, employeeId, 60);
        if ((after.at(-1)?.id ?? null) !== (last?.id ?? null) || replayClock(after).state !== "break") return "skipped" as const;
        await closeWorkingMismatches(employeeId, now, tx, "ELEVATE on break");
        return "checked" as const;
      });
    }
    if (beforeState === "working" && !last?.id) return "skipped";
    let entry: Awaited<ReturnType<NonNullable<JibbleClient["latestEntry"]>>> = null;
    let state;
    try {
      if (beforeState === "out") {
        if (!client.latestEntry) return "unknown";
        entry = await client.latestEntry(initial.jibble_person_id);
        state = entry?.state ?? null;
      } else state = await client.latestState(initial.jibble_person_id);
    } catch { return "unknown"; }
    if (state === null) return "unknown";
    if (entry && (!entry.id.trim() || !Number.isFinite(Date.parse(entry.time)) || Date.parse(entry.time) > now.getTime() + MINUTE)) return "unknown";
    let evidence: Awaited<ReturnType<NonNullable<JibbleClient["entryEvidence"]>>> = null;
    if (beforeState === "out" && state === "in" && entry && client.entryEvidence && client.latestEntry && (!last || last.type === "clock_out")) {
      try {
        const source = await client.entryEvidence(initial.jibble_person_id, entry.id);
        const confirmedLatest = await client.latestEntry(initial.jibble_person_id);
        if (source && source.id === entry.id && source.personId === initial.jibble_person_id && source.state === "in" && source.time === entry.time &&
            confirmedLatest?.id === entry.id && confirmedLatest.state === "in" && confirmedLatest.time === entry.time) evidence = source;
      } catch { /* Evidence is optional: keep the issue for review instead of guessing. */ }
    }
    let stopLogId: string | null = null;
    const checked = await db.transaction(async (tx) => {
      // Clock writes use the same lock, so an ELEVATE click cannot race the final check and notification commit.
      await lockEmployeeClock(tx, employeeId);
      const current = await eligible(tx);
      const after = await loadRecentEvents(tx, employeeId, 60);
      if (!current || current.jibble_person_id !== initial.jibble_person_id || (after.at(-1)?.id ?? null) !== (last?.id ?? null) || replayClock(after).state !== beforeState) return "skipped" as const;
      if ((beforeState === "working" && state === "in") || (beforeState === "out" && state === "out")) await closeWorkingMismatches(employeeId, now, tx);
      else if (beforeState === "working") await recordWorkingMismatch(employeeId, state === "out" ? "working_jibble_out" : "working_jibble_break", now, tx);
      else if (entry) {
        await closeWorkingMismatches(employeeId, now, tx, "ELEVATE clocked out");
        const startedBeforeClockOut = last?.type === "clock_out" && Date.parse(entry.time) <= last.at;
        await recordOutMismatch(employeeId, startedBeforeClockOut ? "elevate_out_jibble_in" : "possible_jibble_only", entry, now, tx);
        if (process.env.JIBBLE_COORDINATION_ENABLED === "true" && evidence && !startedBeforeClockOut) await createJibbleStartProposal(tx, employeeId, evidence, now, last?.type === "clock_out" ? last.at : null);
        if (process.env.JIBBLE_COORDINATION_ENABLED === "true" && startedBeforeClockOut && evidence && last?.id && now.getTime() - last.at <= 30 * MINUTE &&
            evidence.state === "in" && evidence.createdAt === evidence.updatedAt && Math.abs(Date.parse(evidence.time) - Date.parse(evidence.createdAt)) <= MINUTE) {
          const [event] = (await tx.execute(sql`select source, (extract(epoch from created_at) * 1000)::float8 as created_ms from time.clock_events where id = ${last.id}::uuid`)) as unknown as { source: string; created_ms: number }[];
          if (event?.source === "web" && Math.abs(Number(event.created_ms) - last.at) <= MINUTE) {
            const [log] = await tx.insert(jibbleLinkLog).values({ employeeId, action: "Out", status: "queued", source: "repair", lastError: "verified ELEVATE clock-out: preparing Jibble stop" }).returning({ id: jibbleLinkLog.id });
            await writeAudit({ actor: null, action: "jibble.stop_prepared", targetType: "employee", targetId: employeeId, metadata: { logId: log.id, clockOutEventId: last.id } }, tx);
            stopLogId = log.id;
          }
        }
      }
      return "checked" as const;
    });
    if (!stopLogId || checked !== "checked" || !entry || !last?.id) return checked;
    const pendingId: string = stopLogId;
    // A fresh check after creating the intent avoids acting on a changed clock, mapping, pause or Jibble entry.
    let latestEntry = null;
    try { latestEntry = await client.latestEntry?.(initial.jibble_person_id) ?? null; } catch { /* retain the issue for review */ }
    const current = await eligible(db, pendingId);
    const latestClock = await loadRecentEvents(db, employeeId, 60);
    if (!current || current.jibble_person_id !== initial.jibble_person_id || latestClock.at(-1)?.id !== last.id || replayClock(latestClock).state !== "out" || latestEntry?.id !== entry.id || latestEntry.state !== "in" || latestEntry.time !== entry.time) {
      await db.update(jibbleLinkLog).set({ status: "skipped", lastError: "status changed before Jibble stop" }).where(eq(jibbleLinkLog.id, pendingId));
      wakeQueue = true;
      return "skipped";
    }
    try {
      const requestId = randomUUID();
      await runGuardedJibbleEffect({
        employeeId, token, operation: { action: "Out", jibblePersonId: initial.jibble_person_id, logId: pendingId, requestId },
        send: () => client.clock(initial.jibble_person_id, "Out", { requestId }),
        persist: async ({ entryId }) => { await db.transaction(async (tx) => {
          await tx.update(jibbleLinkLog).set({ status: "sent", attempts: 1, sentAt: new Date(), jibbleEntryId: entryId, lastError: "stopped after verified ELEVATE clock-out" }).where(eq(jibbleLinkLog.id, pendingId));
          await writeAudit({ actor: null, action: "jibble.stop_sent", targetType: "employee", targetId: employeeId, metadata: { logId: pendingId } }, tx);
        }); },
      });
      wakeQueue = true;
      return "checked";
    } catch {
      await db.update(jibbleLinkLog).set({ lastError: "Jibble stop outcome uncertain: review required" }).where(eq(jibbleLinkLog.id, pendingId));
      await writeAudit({ actor: null, action: "jibble.stop_uncertain", targetType: "employee", targetId: employeeId, metadata: { logId: pendingId } });
      const [person] = (await db.execute(sql`select user_id from core.employees where id = ${employeeId}::uuid`)) as unknown as { user_id: string | null }[];
      const leads = await timeNoticeUserIds(db, employeeId);
      const recipients = new Set([...(person?.user_id ? [person.user_id] : []), ...leads]);
      await notify(db, [...recipients].map((userId) => ({ userId, kind: "jibble.stop_uncertain", title: "Jibble clock-out needs attention", body: "ELEVATE attempted to stop Jibble after clock-out, but the result is uncertain. Check both apps; no automatic retry will be made.", link: "/attendance" })));
      return "unknown";
    }
  } finally {
    const released = await finishJibbleOperation(employeeId, token);
    if (released && wakeQueue && process.env.JIBBLE_COORDINATION_ENABLED === "true") {
      // A new ELEVATE click may have queued while the guarded Jibble request was running.
      const { processMirrorQueue } = await import("./jobs");
      await processMirrorQueue(new Date(), client, { employeeId });
    }
  }
}
