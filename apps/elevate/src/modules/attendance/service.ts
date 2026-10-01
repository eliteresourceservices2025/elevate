import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone, resolveTimeZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { employees } from "@/modules/people/schema";
import { replayClock, ipAllowed, roundCoordinate, transition, validCoordinates, type ClockEventLite, type ClockState, type ClockType } from "./clock";
import { clockEvents, clockRules, clockSelfies, clockPrefs } from "./schema";

// Server-only helpers for the time clock (not server actions, so they may take the acting user or a transaction).
// Callers authorize first (CLAUDE.md rule 4).

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update">;

export const SELFIE_MAX_BYTES = 1_500_000;
export const SELFIE_KEEP_DAYS = 30;

/** One person's clock writes happen one at a time, so two clicks can never both pass a state check. */
export async function lockEmployeeClock(tx: Executor, employeeId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clock:${employeeId}`}))`);
}

/** The most recent events for one person (enough to know the current state), oldest first. */
export async function loadRecentEvents(executor: Executor, employeeId: string, limit = 60): Promise<ClockEventLite[]> {
  const rows = (await executor.execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms
    from time.clock_events where employee_id = ${employeeId} order by occurred_at desc, created_at desc limit ${limit}`)) as unknown as {
    id: string; type: ClockType; at: number; created_ms: number;
  }[];
  return rows.reverse().map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms) }));
}

/** Every event between two instants (inclusive), for timesheets and rebuilding days. */
export async function loadEventsBetween(executor: Executor, employeeId: string, fromMs: number, toMs: number): Promise<ClockEventLite[]> {
  const rows = (await executor.execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms
    from time.clock_events
    where employee_id = ${employeeId} and occurred_at >= to_timestamp(${fromMs / 1000}) and occurred_at <= to_timestamp(${toMs / 1000})
    order by occurred_at, created_at`)) as unknown as { id: string; type: ClockType; at: number; created_ms: number }[];
  return rows.map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms) }));
}

export type EffectiveRules = { allowedCidrs: string[]; selfieRequired: boolean; idleMinutes: number | null; graceMinutes: number };
export const DEFAULT_RULES: EffectiveRules = { allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60 };

/** The rules of the person's team (or the defaults when the team has none). */
export async function rulesFor(executor: Executor, employeeId: string): Promise<EffectiveRules> {
  const [row] = await executor
    .select({ allowedCidrs: clockRules.allowedCidrs, selfieRequired: clockRules.selfieRequired, idleMinutes: clockRules.idleMinutes, graceMinutes: clockRules.graceMinutes })
    .from(employees)
    .innerJoin(clockRules, eq(clockRules.teamId, employees.teamId))
    .where(eq(employees.id, employeeId))
    .limit(1);
  return row ?? DEFAULT_RULES;
}

export async function prefsFor(executor: Executor, employeeId: string): Promise<{ shareLocation: boolean; timeZone: string | null; zone: string }> {
  const [p] = await executor.select().from(clockPrefs).where(eq(clockPrefs.employeeId, employeeId)).limit(1);
  return { shareLocation: p?.shareLocation ?? false, timeZone: p?.timeZone ?? null, zone: resolveTimeZone(p?.timeZone) };
}

/** Location and selfie capture are monitoring: they are only available once the monitoring policy is published. */
export async function monitoringPolicyPublished(executor: Executor): Promise<boolean> {
  const [row] = (await executor.execute(sql`
    select 1 as ok from docs.policies p join docs.policy_versions v on v.policy_id = p.id
    where p.kind = 'monitoring' and p.archived_at is null and v.status = 'published' limit 1`)) as unknown as { ok: number }[];
  return Boolean(row);
}

/** Whether the person has approved full-day leave covering this calendar day. */
export async function onFullDayLeave(executor: Executor, employeeId: string, date: string): Promise<boolean> {
  const [row] = (await executor.execute(sql`
    select 1 as ok from time.leave_requests
    where employee_id = ${employeeId} and status = 'approved' and not half_day and start_date <= ${date}::date and end_date >= ${date}::date limit 1`)) as unknown as { ok: number }[];
  return Boolean(row);
}

export type ClockPerson = { id: string; userId: string };

export async function personForUser(executor: Executor, userId: string): Promise<ClockPerson> {
  const [e] = await executor
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.userId, userId), isNull(employees.archivedAt), sql`${employees.status} <> 'separated'`))
    .limit(1);
  if (!e) throw new ActionFailure("Your people record is not set up yet. Ask HR.");
  return { id: e.id, userId };
}

const REFUSALS: Record<string, string> = {
  "working:clock_in": "You are already clocked in.",
  "break:clock_in": "You are already clocked in, on a break.",
  "out:break_start": "Clock in before starting a break.",
  "out:break_end": "You are not on a break.",
  "out:clock_out": "You are not clocked in.",
  "working:break_end": "You are not on a break.",
  "break:break_start": "You are already on a break.",
};

/** A short selfie path, owned by the person: selfies/<employeeId>/<uuid>.jpg */
export const selfiePath = (employeeId: string) => `selfies/${employeeId}/${randomUUID()}.jpg`;
const isOwnSelfie = (employeeId: string, path: string) => path.startsWith(`selfies/${employeeId}/`) && /^[0-9a-f-]{36}.jpg$/.test(path.slice(`selfies/${employeeId}/`.length));

export async function checkSelfie(employeeId: string, path: string): Promise<void> {
  if (!isOwnSelfie(employeeId, path)) throw new ActionFailure("That selfie is not valid. Take it again.");
  const bytes = await getDocumentStorage().read(BUCKETS.employee, path);
  const isJpeg = bytes !== null && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!bytes || !isJpeg || bytes.length > SELFIE_MAX_BYTES) {
    await getDocumentStorage().remove(BUCKETS.employee, [path]).catch(() => undefined);
    throw new ActionFailure("The selfie could not be used. Take it again.");
  }
}

export type ClockInput = { latitude?: number; longitude?: number; selfiePath?: string };
export type ClockResult = { state: ClockState; at: string; outsideAllowedRange: boolean };

/**
 * Records one clock event for the signed-in person. The time is the database clock and the IP comes from the request;
 * nothing the browser sends can change either. Everything is checked inside the person's lock.
 */
export async function performClock(actor: { id: string; email: string }, type: ClockType, input: ClockInput): Promise<ClockResult> {
  const person = await personForUser(db, actor.id);
  if (!(await allowRequest("clock", person.id))) throw new ActionFailure("Too many clock actions. Wait a minute and try again.");
  const rawIp = await clientIp();
  const ip = rawIp === "unknown" ? null : rawIp.slice(0, 64);

  return db.transaction(async (tx) => {
    await lockEmployeeClock(tx, person.id);
    const replay = replayClock(await loadRecentEvents(tx, person.id));
    const prefs = await prefsFor(tx, person.id);
    const rules = await rulesFor(tx, person.id);
    const monitoring = await monitoringPolicyPublished(tx);

    // Ending a break and the shift together: a clock-out while on a break first ends the break.
    const endsBreakToo = type === "clock_out" && replay.state === "break";
    if (!endsBreakToo && transition(replay.state, type) === null) {
      throw new ActionFailure(REFUSALS[`${replay.state}:${type}`] ?? "That is not possible right now.");
    }

    if (type === "clock_in") {
      const today = formatInZone(new Date(), prefs.zone, "yyyy-MM-dd");
      if (await onFullDayLeave(tx, person.id, today)) throw new ActionFailure("You are on approved leave today, so you cannot clock in.");
      if (rules.selfieRequired && monitoring) {
        if (!input.selfiePath) throw new ActionFailure("Your team requires a selfie to clock in.");
        await checkSelfie(person.id, input.selfiePath);
      }
    }

    const location =
      type === "clock_in" && prefs.shareLocation && monitoring && input.latitude !== undefined && input.longitude !== undefined && validCoordinates(input.latitude, input.longitude)
        ? { lat: String(roundCoordinate(input.latitude)), lng: String(roundCoordinate(input.longitude)) }
        : null;
    const outsideAllowedRange = !ipAllowed(ip, rules.allowedCidrs);

    const types: ClockType[] = endsBreakToo ? ["break_end", "clock_out"] : [type];
    let last: { id: string; occurredAt: Date } | undefined;
    for (const t of types) {
      [last] = await tx
        .insert(clockEvents)
        .values({
          employeeId: person.id,
          type: t,
          occurredAt: sql`clock_timestamp()` as unknown as Date, // the real moment, so the two events of a clock-out stay in order
          source: "web",
          ip,
          outsideAllowedRange,
          approxLat: t === type && location ? location.lat : null,
          approxLng: t === type && location ? location.lng : null,
          createdBy: actor.id,
        })
        .returning({ id: clockEvents.id, occurredAt: clockEvents.occurredAt });
    }

    if (type === "clock_in" && input.selfiePath && rules.selfieRequired && monitoring && last) {
      await tx.insert(clockSelfies).values({ eventId: last.id, employeeId: person.id, storagePath: input.selfiePath });
    }
    await writeAudit({ actor, action: `clock.${type}`, targetType: "employee", targetId: person.id, metadata: { outsideAllowedRange, withLocation: Boolean(location), withSelfie: Boolean(input.selfiePath && rules.selfieRequired) } }, tx);
    await afterClockEvent(tx, person.id, type);

    return { state: transition(endsBreakToo ? "working" : replay.state, endsBreakToo ? "clock_out" : type)!, at: last!.occurredAt.toISOString(), outsideAllowedRange };
  });
}

/**
 * Hook for Phase 2.4: ELEVATE mirrors clock-in and clock-out to Jibble (queued, retried, logged) so its screenshot
 * app runs only while ELEVATE says the person is working. Nothing is read back from Jibble. Intentionally empty now.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function afterClockEvent(_tx: Executor, _employeeId: string, _type: ClockType): Promise<void> {}
