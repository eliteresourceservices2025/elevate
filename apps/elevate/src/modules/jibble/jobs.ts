import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { prefsFor } from "@/modules/attendance/service";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { breakMode, getJibbleClient, mismatchToleranceMinutes } from "./client";
import { JibbleError, type JibbleClient } from "./http-client";
import { MAX_ATTEMPTS, backoffMs, isMismatch, type JibbleAction } from "./mirror-rules";
import { jibbleDaily, jibbleLinkLog, jibblePeople } from "./schema";

// Background work for the Jibble link. src/inngest wraps these in scheduled functions.

const DAY_MS = 86_400_000;
const ONE_DAY_ALERT = "jibble.failing";

type Due = { id: string; employee_id: string; action: JibbleAction; attempts: number; next_attempt_at: Date; jibble_person_id: string | null; planned: number | null; previous_entry: string | null };

/** HR hears about Jibble trouble at most once a day. */
async function alertHr(title: string, body: string): Promise<void> {
  const [recent] = (await db.execute(sql`select 1 as ok from ops.notifications where kind = ${ONE_DAY_ALERT} and created_at > now() - interval '24 hours' limit 1`)) as unknown as { ok: number }[];
  if (recent) return;
  const hr = await hrUserIds();
  await notify(db, hr.map((userId) => ({ userId, kind: ONE_DAY_ALERT, title, body, link: "/attendance?tab=jibble" })));
}

export type MirrorRun = { sent: number; retrying: number; failed: number; skipped: number };

/**
 * Sends the waiting calls to Jibble, one person at a time and in the order the clicks happened (a later call waits for an earlier
 * one that is retrying). A refusal is final; network trouble, rate limits and server errors are retried with a growing delay
 * (about an hour in all), then marked failed. "Already in that state" (409) counts as sent. Jibble being down never touches the clock.
 */
export async function processMirrorQueue(now = new Date(), client: JibbleClient | null = getJibbleClient()): Promise<MirrorRun> {
  const run: MirrorRun = { sent: 0, retrying: 0, failed: 0, skipped: 0 };
  if (!client) return run;

  const rows = (await db.execute(sql`
    select l.id, l.employee_id, l.action, l.attempts, l.next_attempt_at, p.jibble_person_id, ev.planned_break_minutes as planned,
      -- the entry that started the break, so ending it can point at it
      (select l2.jibble_entry_id from time.jibble_link_log l2 where l2.employee_id = l.employee_id and l2.action = 'StartBreak' and l2.status = 'sent' and l2.created_at < l.created_at
        order by l2.created_at desc limit 1) as previous_entry
    from time.jibble_link_log l left join time.jibble_people p on p.employee_id = l.employee_id left join time.clock_events ev on ev.id = l.event_id
    where l.status = 'queued' order by l.employee_id, l.created_at limit 500`)) as unknown as Due[];

  const byPerson = new Map<string, Due[]>();
  for (const r of rows) byPerson.set(r.employee_id, [...(byPerson.get(r.employee_id) ?? []), r]);

  let authProblem = false;
  /** The break-start entry sent earlier in this same run, per person (the database list above was read before it was sent). */
  const startedBreak = new Map<string, string | null>();
  let terminal = 0;
  for (const list of byPerson.values()) {
    for (const row of list) {
      if (new Date(row.next_attempt_at).getTime() > now.getTime()) break; // an earlier call is waiting to retry: keep the order
      if (!row.jibble_person_id) {
        await db.update(jibbleLinkLog).set({ status: "skipped", lastError: "no Jibble person matched" }).where(eq(jibbleLinkLog.id, row.id));
        run.skipped += 1;
        continue;
      }
      try {
        // A break start sends the length chosen in ELEVATE (to pick the matching Jibble break); a break end points at the entry that started it.
        const { entryId } = await client.clock(row.jibble_person_id, row.action, row.action === "StartBreak" ? { breakMinutes: row.planned === null ? null : Number(row.planned) } : row.action === "EndBreak" ? { previousEntryId: startedBreak.get(row.employee_id) ?? row.previous_entry } : undefined);
        if (row.action === "StartBreak") startedBreak.set(row.employee_id, entryId);
        await db.update(jibbleLinkLog).set({ status: "sent", attempts: row.attempts + 1, sentAt: new Date(), jibbleEntryId: entryId, lastError: null }).where(eq(jibbleLinkLog.id, row.id));
        run.sent += 1;
      } catch (error) {
        const e = error instanceof JibbleError ? error : new JibbleError(null, "unexpected");
        if (e.status === 409) {
          await db.update(jibbleLinkLog).set({ status: "sent", attempts: row.attempts + 1, sentAt: new Date(), lastError: "already in that state" }).where(eq(jibbleLinkLog.id, row.id));
          run.sent += 1;
          continue;
        }
        if (e.status === 401 || e.status === 403) authProblem = true;
        const attempts = row.attempts + 1;
        if (e.retryable && attempts < MAX_ATTEMPTS) {
          await db.update(jibbleLinkLog).set({ attempts, lastError: e.message, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) }).where(eq(jibbleLinkLog.id, row.id));
          run.retrying += 1;
          break; // later calls for this person wait their turn
        }
        await db.update(jibbleLinkLog).set({ status: "failed", attempts, lastError: e.message }).where(eq(jibbleLinkLog.id, row.id));
        run.failed += 1;
        terminal += 1;
      }
    }
  }

  if (authProblem) await alertHr("ELEVATE cannot sign in to Jibble", "Jibble refused the access token. Screenshots may not be starting. Check the token (it may have expired) in the Jibble tab.");
  else if (terminal > 0) await alertHr("Some Jibble calls failed", `${terminal} clock ${terminal === 1 ? "call" : "calls"} could not be sent to Jibble. See the Jibble tab and retry them.`);
  return run;
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
    const taken = await db.select({ id: jibblePeople.employeeId }).from(jibblePeople).where(and(eq(jibblePeople.jibblePersonId, found.id), sql`${jibblePeople.employeeId} <> ${e.id}`)).limit(1);
    if (taken.length > 0) {
      unmatched += 1;
      continue;
    }
    await db
      .insert(jibblePeople)
      .values({ employeeId: e.id, jibblePersonId: found.id, matchedBy: "email" })
      .onConflictDoUpdate({ target: jibblePeople.employeeId, set: { jibblePersonId: found.id, matchedBy: "email", matchedAt: new Date() } });
    matched += 1;
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

