import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { MINUTE, replayClock } from "@/modules/attendance/clock";
import { loadRecentEvents, monitoringPolicyPublished, prefsFor } from "@/modules/attendance/service";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { reportName } from "@/modules/org/service";
import { breakMode, getJibbleClient, mirrorSendsEnabled, mismatchToleranceMinutes, selfTestEmails, sendsAllowed } from "./client";
import { JibbleError, type JibbleClient } from "./http-client";
import { MAX_ATTEMPTS, backoffMs, isMismatch, repairAction, targetState, type JibbleAction } from "./mirror-rules";
import { jibbleCheckCursor, jibbleDaily, jibbleLinkLog, jibblePeople } from "./schema";
import { claimJibbleOperation, finishJibbleOperation, runGuardedJibbleEffect, updateJibbleInFlightAction } from "./operation-guard";
import { checkWorkingMismatch } from "./working-mismatch-check";

// Background work for the Jibble link. src/inngest wraps these in scheduled functions.

const DAY_MS = 86_400_000;

type Due = {
  id: string;
  employee_id: string;
  action: JibbleAction;
  attempts: number;
  created_at: Date;
  next_attempt_at: Date;
  jibble_person_id: string | null;
  planned: number | null;
  previous_entry: string | null;
  previous_fallback: boolean | null;
};

/** HR is told about one kind of Jibble trouble at most once in the window (hours), so a long outage is one alert, not hundreds. */
async function alertHr(kind: string, title: string, body: string, windowHours: number): Promise<void> {
  const since = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const [recent] = (await db.execute(sql`select 1 as ok from ops.notifications where kind = ${kind} and created_at > ${since}::timestamptz limit 1`)) as unknown as { ok: number }[];
  if (recent) return;
  const hr = await hrUserIds();
  await notify(db, hr.map((userId) => ({ userId, kind, title, body, link: "/jibble" })));
}

/** HR's pause switch: while paused nothing is sent to Jibble and calls wait in the queue. */
export async function jibblePaused(): Promise<boolean> {
  const [row] = (await db.execute(sql`select paused from time.jibble_settings where id = 1`)) as unknown as { paused: boolean }[];
  return Boolean(row?.paused);
}

export type MirrorRun = { sent: number; retrying: number; failed: number; skipped: number };

/** A queued event does not grant ongoing permission after a mapping, policy or team rule changes. */
export async function maySendNow(employeeId: string, personId: string): Promise<boolean> {
  if (!mirrorSendsEnabled() || !sendsAllowed(personId)) return false;
  const [row] = (await db.execute(sql`select p.jibble_person_id, u.email, coalesce(r.jibble_mirror, false) as enabled
    from core.employees e join time.jibble_people p on p.employee_id = e.id
    left join core.users u on u.id = e.user_id left join time.clock_rules r on r.team_id = e.team_id
    where e.id = ${employeeId} and e.archived_at is null and e.status <> 'separated'`)) as unknown as { jibble_person_id: string; email: string | null; enabled: boolean }[];
  if (!row || row.jibble_person_id !== personId) return false;
  if (row.email && selfTestEmails().includes(row.email.trim().toLowerCase())) return true;
  return row.enabled && await monitoringPolicyPublished(db);
}

/**
 * Sends the waiting calls to Jibble, one person at a time and in the order the clicks happened (a later call waits for an earlier
 * one that is retrying). A refusal is final; network trouble, rate limits and server errors are retried with a growing delay
 * (about an hour in all, longer if Jibble says to wait), then marked failed. A retry first checks Jibble's state, so a call that
 * actually went through is not sent twice. A 409 counts as sent only when a state check confirms it. A break start that Jibble refuses (no break
 * set up for the person, or already used) clocks them out instead, so screenshots still stop, and its end clocks them back in.
 * Nothing is sent while paused, or outside production except to named test people. Jibble being down never touches the clock.
 */
export async function processMirrorQueue(now = new Date(), client: JibbleClient | null = getJibbleClient(), only?: { employeeId: string }, guardToken?: string, pass = 0): Promise<MirrorRun> {
  const run: MirrorRun = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  if (!client || (await jibblePaused())) return run;

  const rows = (await db.execute(sql`
    select l.id, l.employee_id, l.action, l.attempts, l.created_at, l.next_attempt_at, p.jibble_person_id, ev.planned_break_minutes as planned,
      -- the break start sent before this call: its entry (so ending the break can point at it) and whether it fell back to a clock-out
      (select l2.jibble_entry_id from time.jibble_link_log l2 where l2.employee_id = l.employee_id and l2.action = 'StartBreak' and l2.status = 'sent' and l2.created_at < l.created_at
        order by l2.created_at desc limit 1) as previous_entry,
      (select l2.fallback from time.jibble_link_log l2 where l2.employee_id = l.employee_id and l2.action = 'StartBreak' and l2.status = 'sent' and l2.created_at < l.created_at
        order by l2.created_at desc limit 1) as previous_fallback
    from time.jibble_link_log l left join time.jibble_people p on p.employee_id = l.employee_id left join time.clock_events ev on ev.id = l.event_id
    where l.status = 'queued' ${only ? sql`and l.employee_id = ${only.employeeId}::uuid` : sql``} order by l.employee_id, l.created_at limit 500`)) as unknown as Due[];

  const byPerson = new Map<string, Due[]>();
  for (const r of rows) byPerson.set(r.employee_id, [...(byPerson.get(r.employee_id) ?? []), r]);

  // Claim first, then read each person's queue again inside the reservation. A snapshot taken by a competing worker may be stale.
  if (!guardToken && process.env.JIBBLE_COORDINATION_ENABLED === "true") {
    for (const employeeId of byPerson.keys()) {
      const token = await claimJibbleOperation(employeeId, { kind: "send" });
      if (!token) continue;
      try {
        const personRun = await processMirrorQueue(now, client, { employeeId }, token);
        run.sent += personRun.sent; run.retrying += personRun.retrying; run.failed += personRun.failed; run.skipped += personRun.skipped;
      } finally {
        // This fails closed if a request was left in flight or uncertain.
        await finishJibbleOperation(employeeId, token);
      }
    }
    return run;
  }

  let authProblem = false;
  /** What an earlier call in this same run did for a person's break (the database list above was read before it was sent). */
  const startedBreak = new Map<string, { entryId: string | null; fellBack: boolean }>();
  let terminal = 0;
  const markSent = (id: string, attempts: number, entryId: string | null, note: string | null, fallback = false) =>
    db.update(jibbleLinkLog).set({ status: "sent", attempts, sentAt: new Date(), jibbleEntryId: entryId, lastError: note, fallback }).where(eq(jibbleLinkLog.id, id));

  for (const list of byPerson.values()) {
    for (const row of list) {
      const [fresh] = (await db.execute(sql`select l.status, p.jibble_person_id from time.jibble_link_log l
        left join time.jibble_people p on p.employee_id = l.employee_id where l.id = ${row.id}::uuid`)) as unknown as { status: string; jibble_person_id: string | null }[];
      if (!fresh || fresh.status !== "queued" || fresh.jibble_person_id !== row.jibble_person_id || await jibblePaused()) break;
      if (guardToken && now.getTime() - new Date(row.created_at).getTime() > 10 * MINUTE) {
        // A past action is not evidence of the state desired now. Hold it until current-state recovery is available.
        await db.update(jibbleLinkLog).set({ lastError: "stale call: review current status" }).where(eq(jibbleLinkLog.id, row.id));
        run.retrying += 1;
        break;
      }
      if (new Date(row.next_attempt_at).getTime() > now.getTime()) break; // an earlier call is waiting to retry: keep the order
      if (!row.jibble_person_id) {
        await db.update(jibbleLinkLog).set({ status: "skipped", lastError: "no Jibble person matched" }).where(eq(jibbleLinkLog.id, row.id));
        run.skipped += 1;
        continue;
      }
      if (!sendsAllowed(row.jibble_person_id)) {
        await db.update(jibbleLinkLog).set({ status: "skipped", lastError: "not sent: not the production environment" }).where(eq(jibbleLinkLog.id, row.id));
        run.skipped += 1;
        continue;
      }
      if (guardToken && !(await maySendNow(row.employee_id, row.jibble_person_id))) {
        await db.update(jibbleLinkLog).set({ lastError: "sending permission changed: review required" }).where(eq(jibbleLinkLog.id, row.id));
        run.retrying += 1;
        break;
      }
      if (guardToken) {
        const current = replayClock(await loadRecentEvents(db, row.employee_id, 120)).state;
        if ((row.action === "In" && current === "out") || (row.action === "Out" && current === "working") || (row.action === "StartBreak" && current !== "break") || (row.action === "EndBreak" && current === "break")) {
          await db.update(jibbleLinkLog).set({ status: "skipped", lastError: "superseded by current ELEVATE status" }).where(eq(jibbleLinkLog.id, row.id));
          run.skipped += 1;
          continue;
        }
      }
      let requestStarted = false;
      try {
        // A retry: the earlier try may have gone through even though we never heard back. Look before sending again.
        if (row.attempts > 0) {
          // A previous request may have succeeded despite a timeout. Do not send again if its outcome cannot be checked.
          const state = await client.latestState(row.jibble_person_id);
          if (state === null) throw new JibbleError(null, "cannot confirm Jibble state");
          if (state === targetState(row.action)) {
            await markSent(row.id, row.attempts + 1, null, "already in that state (checked)");
            run.sent += 1;
            continue;
          }
        }
        const earlier = startedBreak.get(row.employee_id);
        const fellBackEarlier = earlier ? earlier.fellBack : row.previous_fallback === true;
        const personId = row.jibble_person_id;
        // A status lookup can take time; check permission and pause again immediately before recording send intent.
        if (guardToken && ((await jibblePaused()) || !(await maySendNow(row.employee_id, personId)))) {
          await db.update(jibbleLinkLog).set({ lastError: "sending permission changed: review required" }).where(eq(jibbleLinkLog.id, row.id));
          run.retrying += 1;
          break;
        }
        const effectiveAction = row.action === "EndBreak" && fellBackEarlier ? "In" as const : row.action;
        const requestId = guardToken && (effectiveAction === "In" || effectiveAction === "Out") ? randomUUID() : undefined;
        const effect = {
          employeeId: row.employee_id, token: guardToken ?? "",
          operation: { action: effectiveAction, jibblePersonId: personId, logId: row.id, requestId },
          send: async () => {
            let entryId: string | null;
            let fallback = false;
            if (row.action === "EndBreak" && fellBackEarlier) {
              ({ entryId } = await client.clock(personId, "In", requestId ? { requestId } : undefined));
              fallback = true;
            } else if (row.action === "StartBreak") {
              try {
                ({ entryId } = await client.clock(personId, "StartBreak", { breakMinutes: row.planned === null ? null : Number(row.planned) }));
              } catch (error) {
                const refused = error instanceof JibbleError && !error.retryable && error.status !== 401 && error.status !== 403 && error.status !== 409;
                if (!refused) throw error;
                const fallbackId = guardToken ? randomUUID() : undefined;
                if (guardToken && fallbackId && !(await updateJibbleInFlightAction(row.employee_id, guardToken, "Out", fallbackId))) throw new Error("Jibble fallback intent could not be saved");
                ({ entryId } = await client.clock(personId, "Out", fallbackId ? { requestId: fallbackId } : undefined));
                fallback = true;
              }
            } else if (row.action === "EndBreak") {
              ({ entryId } = await client.clock(personId, "EndBreak", { previousEntryId: earlier?.entryId ?? row.previous_entry }));
            } else {
              ({ entryId } = await client.clock(personId, row.action, requestId ? { requestId } : undefined));
            }
            return { entryId, fallback };
          },
          persist: async ({ entryId, fallback }: { entryId: string | null; fallback: boolean }) => { await markSent(row.id, row.attempts + 1, entryId, fallback && row.action === "StartBreak" ? "no Jibble break available: clocked out instead" : null, fallback); },
        };
        requestStarted = true;
        const result = guardToken ? await runGuardedJibbleEffect(effect) : await effect.send().then(async (value) => { await effect.persist(value); return value; });
        if (row.action === "StartBreak") startedBreak.set(row.employee_id, { entryId: result.entryId, fellBack: result.fallback });
        run.sent += 1;
      } catch (error) {
        const e = error instanceof JibbleError ? error : new JibbleError(null, "unexpected");
        if (guardToken && requestStarted) {
          // Any failed guarded request remains blocked for review; it must not be replayed or followed by another call.
          // A reviewer may have confirmed this exact request while the failing worker was unwinding.
          // Do not overwrite the confirmation or annotate a later operation owned by a different token.
          await db.execute(sql`update time.jibble_link_log set last_error = 'outcome uncertain: review required'
            where id = ${row.id}::uuid and status = 'queued'
              and exists (select 1 from time.jibble_operation_guard where employee_id = ${row.employee_id}::uuid and token = ${guardToken}::uuid and phase = 'uncertain')`);
          run.retrying += 1;
          break;
        }
        if (e.status === 409) {
          // A conflict can have more than one cause; only mark it sent if Jibble confirms the intended state.
          const state = await client.latestState(row.jibble_person_id).catch(() => null);
          if (state !== null && state === targetState(row.action)) {
            await markSent(row.id, row.attempts + 1, null, "already in that state (checked)");
            run.sent += 1;
            continue;
          }
        }
        if (e.status === 401 || e.status === 403) authProblem = true;
        const attempts = row.attempts + 1;
        if (e.retryable && attempts < MAX_ATTEMPTS) {
          await db.update(jibbleLinkLog).set({ attempts, lastError: e.message, nextAttemptAt: new Date(now.getTime() + Math.max(backoffMs(attempts), e.retryAfterMs ?? 0)) }).where(eq(jibbleLinkLog.id, row.id));
          run.retrying += 1;
          break; // later calls for this person wait their turn
        }
        await db.update(jibbleLinkLog).set({ status: "failed", attempts, lastError: e.message }).where(eq(jibbleLinkLog.id, row.id));
        run.failed += 1;
        terminal += 1;
      }
    }
  }

  if (guardToken && only && pass < 2) {
    const [guard] = (await db.execute(sql`select phase from time.jibble_operation_guard where employee_id = ${only.employeeId}::uuid and token = ${guardToken}::uuid`)) as unknown as { phase: string }[];
    if (guard?.phase === "claimed") {
      const known = new Set(rows.map((row) => row.id));
      const pending = (await db.execute(sql`select id from time.jibble_link_log where employee_id = ${only.employeeId}::uuid and status = 'queued' order by created_at, id limit 500`)) as unknown as { id: string }[];
      if (pending.some((row) => !known.has(row.id))) {
        const next = await processMirrorQueue(new Date(Math.max(now.getTime(), Date.now())), client, only, guardToken, pass + 1);
        run.sent += next.sent; run.retrying += next.retrying; run.failed += next.failed; run.skipped += next.skipped;
      }
    }
  }

  if (authProblem) {
    await alertHr("jibble.auth", "ELEVATE cannot sign in to Jibble", "Jibble refused the access keys. Screenshots may not be starting. Check the keys (they may have been changed or the plan may have lapsed) in the Jibble page.", 2);
  } else if (terminal > 0) {
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from time.jibble_link_log where status = 'failed' and created_at > now() - interval '2 hours'`)) as unknown as { n: number }[];
    if (n >= 3) await alertHr("jibble.failing", "Jibble calls are failing", `${n} clock calls failed in the last 2 hours, so screenshots may not be starting for some people. Review the calls and current status on the Jibble page.`, 6);
  }
  return run;
}

export type RepairRun = { checked: number; repaired: number; failed: number };

/**
 * Legacy repair runs from a 30-minute schedule and a 15-minute backstop. The experimental coordination path only checks working
 * mismatches and never restarts Jibble; the remaining guarded recovery workflow must be completed before enabling it in production.
 */
export async function runJibbleRepair(now = new Date(), client: JibbleClient | null = getJibbleClient()): Promise<RepairRun> {
  const run: RepairRun = { checked: 0, repaired: 0, failed: 0 };
  if (!client || !mirrorSendsEnabled() || (await jibblePaused())) return run;

  // People on a team that uses Jibble, plus anyone listed for a self-test (JIBBLE_SELF_TEST_EMAILS).
  const selfTest = selfTestEmails();
  const selfTestMatch = selfTest.length > 0 ? sql`lower(u.email) in (${sql.join(selfTest.map((e) => sql`${e}`), sql`, `)})` : sql`false`;
  const coordinating = process.env.JIBBLE_COORDINATION_ENABLED === "true";
  const candidates = (await db.execute(sql`
    select e.id as employee_id, p.jibble_person_id
    from core.employees e
    left join time.clock_rules r on r.team_id = e.team_id
    left join core.users u on u.id = e.user_id
    join time.jibble_people p on p.employee_id = e.id
    ${coordinating ? sql`left join time.jibble_check_cursor scan_cursor on scan_cursor.employee_id = e.id` : sql``}
    where (coalesce(r.jibble_mirror, false) or ${selfTestMatch}) and e.archived_at is null and e.status <> 'separated'
      ${coordinating ? sql`` : sql`and exists (select 1 from time.v_clock_events c where c.employee_id = e.id and c.occurred_at > ${new Date(now.getTime() - 2 * DAY_MS).toISOString()}::timestamptz)`}
    ${coordinating ? sql`order by scan_cursor.checked_at asc nulls first, e.id` : sql``}
    limit ${coordinating ? 150 : 400}`)) as unknown as { employee_id: string; jibble_person_id: string }[];

  if (coordinating) {
    // Until guarded recovery is available, never let the legacy repair path race a guarded sender or restart Jibble.
    for (const candidate of candidates) {
      try {
        const result = await checkWorkingMismatch(candidate.employee_id, client, now);
        if (result === "checked") run.checked += 1;
        else if (result === "unknown") run.failed += 1;
      } catch (error) {
        run.failed += 1;
        console.error("jibble mismatch check failed:", error instanceof Error ? error.name : "unknown error");
      } finally {
        await db.insert(jibbleCheckCursor).values({ employeeId: candidate.employee_id, checkedAt: now })
          .onConflictDoUpdate({ target: jibbleCheckCursor.employeeId, set: { checkedAt: now } });
      }
    }
    return run;
  }

  let authProblem = false;
  for (const c of candidates) {
    if (run.checked >= 150) break;
    if (!sendsAllowed(c.jibble_person_id)) continue;
    const events = await loadRecentEvents(db, c.employee_id, 30);
    const last = events[events.length - 1];
    if (!last) continue;
    const replay = replayClock(events);
    const recentlyOut = last.type === "clock_out" && now.getTime() - last.at < 30 * MINUTE;
    if (replay.state === "out" && !recentlyOut) continue;
    if (now.getTime() - last.at < 3 * MINUTE) continue; // the queue is handling this click
    const [busy] = (await db.execute(sql`
      select 1 as ok from time.jibble_link_log where employee_id = ${c.employee_id}
        and (status = 'queued' or (source = 'repair' and created_at > ${new Date(now.getTime() - 9 * MINUTE).toISOString()}::timestamptz)) limit 1`)) as unknown as { ok: number }[];
    if (busy) continue;

    run.checked += 1;
    let state: Awaited<ReturnType<JibbleClient["latestState"]>>;
    try {
      state = await client.latestState(c.jibble_person_id);
    } catch (error) {
      if (error instanceof JibbleError && (error.status === 401 || error.status === 403)) authProblem = true;
      continue;
    }
    if (state === null) continue;
    const action = repairAction(replay.state, state, breakMode());
    if (!action) continue;

    const openBreak = replay.sessions[replay.sessions.length - 1]?.breaks.find((b) => b.endAt === null);
    try {
      const { entryId } = await client.clock(c.jibble_person_id, action, action === "StartBreak" ? { breakMinutes: openBreak?.plannedMinutes ?? null } : undefined);
      await db.insert(jibbleLinkLog).values({ employeeId: c.employee_id, eventId: null, source: "repair", action, status: "sent", attempts: 1, sentAt: new Date(), jibbleEntryId: entryId, lastError: `repair: Jibble was ${state}, ELEVATE says ${replay.state === "break" ? "on a break" : replay.state}` });
      run.repaired += 1;
    } catch (error) {
      const e = error instanceof JibbleError ? error : new JibbleError(null, "unexpected");
      if (e.status === 401 || e.status === 403) authProblem = true;
      await db.insert(jibbleLinkLog).values({ employeeId: c.employee_id, eventId: null, source: "repair", action, status: "failed", attempts: 1, lastError: e.message });
      run.failed += 1;
    }
  }
  if (authProblem) await alertHr("jibble.auth", "ELEVATE cannot sign in to Jibble", "Jibble refused the access keys. Screenshots may not be starting. Check the keys (they may have been changed or the plan may have lapsed) in the Jibble page.", 2);
  return run;
}

/**
 * Daily: notify HR about unmatched ELEVATE clock calls so they can check screenshot coverage and fix the match.
 */
export async function runJibbleUnmatchedReport(now = new Date()): Promise<{ people: number }> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const rows = (await db.execute(sql`
    select distinct e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.jibble_link_log l join core.employees e on e.id = l.employee_id
    where l.status = 'skipped' and l.last_error = 'no Jibble person matched' and l.created_at > ${since}::timestamptz`)) as unknown as { id: string; first: string; last: string; preferred: string | null }[];
  if (rows.length === 0) return { people: 0 };
  const names = rows.map((r) => reportName({ first: r.first, last: r.last, preferred: r.preferred })).sort();
  const shown = names.slice(0, 10).join(", ");
  const hr = await hrUserIds();
  await notify(db, hr.map((userId) => ({ userId, kind: "jibble.unmatched", title: `${rows.length} ${rows.length === 1 ? "person" : "people"} clocked in without a Jibble match`, body: `${shown}${names.length > 10 ? `, and ${names.length - 10} more` : ""}. ELEVATE could not send their clock calls to Jibble. Check screenshot coverage and match them on the Jibble page or add them in Jibble.`, link: "/jibble" })));
  return { people: rows.length };
}

export type PeopleSync = { jibblePeople: number; matched: number; unmatched: number };

/** Matches people to Jibble accounts by work email. Hand-made matches are never overwritten. Safe to run any time. */
export async function syncJibblePeople(client: JibbleClient | null = getJibbleClient()): Promise<PeopleSync> {
  if (!client) return { jibblePeople: 0, matched: 0, unmatched: 0 };
  const people = await client.listPeople();
  const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email!.trim().toLowerCase(), p]));

  const employees = (await db.execute(sql`
    select e.id, lower(e.work_email) as email, p.matched_by from core.employees e
    left join time.jibble_people p on p.employee_id = e.id
    where e.archived_at is null and e.status <> 'separated' and e.work_email is not null`)) as unknown as { id: string; email: string; matched_by: string | null }[];

  let matched = 0;
  let unmatched = 0;
  for (const e of employees) {
    if (e.matched_by === "manual") {
      matched += 1;
      continue;
    }
    const found = byEmail.get(e.email);
    if (!found) {
      unmatched += 1;
      continue;
    }
    const guardedMapping = process.env.JIBBLE_COORDINATION_ENABLED === "true";
    const token = guardedMapping ? await claimJibbleOperation(e.id, { kind: "reconcile" }) : null;
    if (guardedMapping && !token) { unmatched += 1; continue; }
    try {
    if (guardedMapping) {
      const [current] = (await db.execute(sql`select matched_by from time.jibble_people where employee_id = ${e.id}::uuid`)) as unknown as { matched_by: string }[];
      if (current?.matched_by === "manual") { matched += 1; continue; }
    }
    // Who else holds this Jibble account? A record that was archived or has left no longer needs it (a duplicate after an import, a
    // person who left): its old link is dropped so the account goes to the current record. A current person's link is never taken.
    const holders = (await db.execute(sql`
      select p.employee_id as id, (e.archived_at is not null or e.status = 'separated') as stale
      from time.jibble_people p join core.employees e on e.id = p.employee_id
      where p.jibble_person_id = ${found.id} and p.employee_id <> ${e.id}`)) as unknown as { id: string; stale: boolean }[];
    if (holders.some((h) => !h.stale)) {
      unmatched += 1;
      continue;
    }
    if (guardedMapping && holders.length) { unmatched += 1; continue; }
    for (const h of holders) await db.delete(jibblePeople).where(eq(jibblePeople.employeeId, h.id));
    await db
      .insert(jibblePeople)
      .values({ employeeId: e.id, jibblePersonId: found.id, matchedBy: "email" })
      .onConflictDoUpdate({ target: jibblePeople.employeeId, set: { jibblePersonId: found.id, matchedBy: "email", matchedAt: new Date() } });
    matched += 1;
    } finally {
      if (token) await finishJibbleOperation(e.id, token);
    }
  }
  return { jibblePeople: people.length, matched, unmatched };
}

export type ComparisonRun = { compared: number; flagged: number };

/**
 * Nightly, after the attendance rebuild: for people on teams that use Jibble, compare the minutes Jibble tracked yesterday
 * (in the person's own zone) with the minutes ELEVATE counts. Differing by more than the tolerance flags the day
 * (jibble_mismatch). Only totals are read and kept (35 days); Jibble's numbers never become hours.
 */
export async function runJibbleComparison(now = new Date(), client: JibbleClient | null = getJibbleClient()): Promise<ComparisonRun> {
  const run: ComparisonRun = { compared: 0, flagged: 0 };
  if (!client) return run;
  const tolerance = mismatchToleranceMinutes();
  const mode = breakMode();

  const people = (await db.execute(sql`
    select e.id as employee_id, p.jibble_person_id from core.employees e
    join time.clock_rules r on r.team_id = e.team_id and r.jibble_mirror
    join time.jibble_people p on p.employee_id = e.id
    where e.archived_at is null and e.status <> 'separated'`)) as unknown as { employee_id: string; jibble_person_id: string }[];

  // Each person's "yesterday" depends on their own zone, so group people by the date they need.
  const byDate = new Map<string, { employee_id: string; jibble_person_id: string }[]>();
  for (const p of people) {
    const date = formatInZone(now.getTime() - DAY_MS, (await prefsFor(db, p.employee_id)).zone, "yyyy-MM-dd");
    byDate.set(date, [...(byDate.get(date) ?? []), p]);
  }

  for (const [date, list] of byDate) {
    const days = await client.dailyTracked(list.map((p) => p.jibble_person_id), date, date);
    const tracked = new Map<string, number>();
    for (const d of days) if (d.date === date) tracked.set(d.personId, (tracked.get(d.personId) ?? 0) + d.trackedMinutes);

    for (const p of list) {
      const [day] = (await db.execute(sql`select worked_minutes, break_minutes from time.attendance_days where employee_id = ${p.employee_id} and date = ${date}::date`)) as unknown as { worked_minutes: number; break_minutes: number }[];
      // Where breaks are not mirrored, Jibble keeps running through them, so its total includes them.
      const elevate = (day?.worked_minutes ?? 0) + (mode === "off" ? (day?.break_minutes ?? 0) : 0);
      const jibble = Math.round(tracked.get(p.jibble_person_id) ?? 0);
      if (elevate === 0 && jibble === 0) continue;
      const flagged = isMismatch(elevate, jibble, tolerance);
      await db
        .insert(jibbleDaily)
        .values({ employeeId: p.employee_id, date, jibbleMinutes: jibble, elevateMinutes: elevate, flagged })
        .onConflictDoUpdate({ target: [jibbleDaily.employeeId, jibbleDaily.date], set: { jibbleMinutes: jibble, elevateMinutes: elevate, flagged, comparedAt: new Date() } });
      run.compared += 1;
      if (flagged) run.flagged += 1;

      // Put the flag on the day. A day ELEVATE has no row for (nobody clocked in) gets one so the lead sees it.
      if (flagged) {
        await db.execute(sql`
          insert into time.attendance_days (employee_id, date, flags) values (${p.employee_id}, ${date}::date, array['jibble_mismatch'])
          on conflict (employee_id, date) do update set flags = case when 'jibble_mismatch' = any(time.attendance_days.flags) then time.attendance_days.flags else array_append(time.attendance_days.flags, 'jibble_mismatch') end`);
      } else {
        await db.execute(sql`update time.attendance_days set flags = array_remove(flags, 'jibble_mismatch') where employee_id = ${p.employee_id} and date = ${date}::date`);
      }
    }
  }
  return run;
}

/** Daily: comparison totals are kept 35 days and send logs 90 days. */
export async function purgeJibbleData(now = new Date()): Promise<{ daily: number; logs: number }> {
  const daily = (await db.execute(sql`delete from time.jibble_daily where compared_at < ${new Date(now.getTime() - 35 * DAY_MS).toISOString()}::timestamptz returning 1`)) as unknown as unknown[];
  const logs = (await db.execute(sql`delete from time.jibble_link_log where status <> 'queued' and created_at < ${new Date(now.getTime() - 90 * DAY_MS).toISOString()}::timestamptz returning 1`)) as unknown as unknown[];
  return { daily: daily.length, logs: logs.length };
}

