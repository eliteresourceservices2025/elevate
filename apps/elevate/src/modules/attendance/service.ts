import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { formatInZone, resolveTimeZone } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { employees } from "@/modules/people/schema";
import { MINUTE, breakLabel, ipAllowed, overbreakOf, replayClock, roundCoordinate, transition, validCoordinates, type ClockEventLite, type ClockState, type ClockType } from "./clock";
import { clockEvents, clockPrefs, clockRules, clockSelfies, correctionEvidence, overbreakNotices } from "./schema";

// Server-only helpers for the time clock (not server actions, so they may take the acting user or a transaction).
// Callers authorize first (CLAUDE.md rule 4).

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update" | "delete">;

export const SELFIE_MAX_BYTES = 1_500_000;
export const SELFIE_KEEP_DAYS = 30;

/** One person's clock writes happen one at a time, so two clicks can never both pass a state check. */
export async function lockEmployeeClock(tx: Executor, employeeId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clock:${employeeId}`}))`);
}

/** The most recent events for one person (enough to know the current state), oldest first. */
export async function loadRecentEvents(executor: Executor, employeeId: string, limit = 60): Promise<ClockEventLite[]> {
  const rows = (await executor.execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms, planned_break_minutes as planned
    from time.clock_events where employee_id = ${employeeId} order by occurred_at desc, created_at desc limit ${limit}`)) as unknown as {
    id: string; type: ClockType; at: number; created_ms: number; planned: number | null;
  }[];
  return rows.reverse().map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms), plannedBreakMinutes: r.planned }));
}

/** Every event between two instants (inclusive), for timesheets and rebuilding days. */
export async function loadEventsBetween(executor: Executor, employeeId: string, fromMs: number, toMs: number): Promise<ClockEventLite[]> {
  const rows = (await executor.execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms, planned_break_minutes as planned
    from time.clock_events
    where employee_id = ${employeeId} and occurred_at >= to_timestamp(${fromMs / 1000}) and occurred_at <= to_timestamp(${toMs / 1000})
    order by occurred_at, created_at`)) as unknown as { id: string; type: ClockType; at: number; created_ms: number; planned: number | null }[];
  return rows.map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms), plannedBreakMinutes: r.planned }));
}

export type EffectiveRules = { allowedCidrs: string[]; selfieRequired: boolean; idleMinutes: number | null; graceMinutes: number; eodExpected: boolean };
export const DEFAULT_RULES: EffectiveRules = { allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, eodExpected: false };

/** The rules of the person's team (or the defaults when the team has none). */
export async function rulesFor(executor: Executor, employeeId: string): Promise<EffectiveRules> {
  const [row] = await executor
    .select({ allowedCidrs: clockRules.allowedCidrs, selfieRequired: clockRules.selfieRequired, idleMinutes: clockRules.idleMinutes, graceMinutes: clockRules.graceMinutes, eodExpected: clockRules.eodExpected })
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

export type ClockInput = { latitude?: number; longitude?: number; selfiePath?: string; /** break_start only: 15, 30 or 60. */ breakMinutes?: 15 | 30 | 60 };
export type ClockResult = {
  state: ClockState;
  at: string;
  outsideAllowedRange: boolean;
  /** On a clock-out: the clock-in event of the session that just ended, so an end-of-day note can attach to it. */
  sessionId: string | null;
};

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

    if (replay.state !== "out" && (await pendingClockOut(tx, person.id))) {
      throw new ActionFailure("Your clock-out request is waiting for approval. Cancel it first if you are still working.");
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
    let breakEndedAt: number | null = null;
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
          plannedBreakMinutes: t === "break_start" ? (input.breakMinutes ?? null) : null,
          approxLat: t === type && location ? location.lat : null,
          approxLng: t === type && location ? location.lng : null,
          createdBy: actor.id,
        })
        .returning({ id: clockEvents.id, occurredAt: clockEvents.occurredAt });
      if (t === "break_end") breakEndedAt = last!.occurredAt.getTime();
    }

    // A timed break that ran past its length is reported to the lead (once) when it ends.
    const openBreak = replay.sessions[replay.sessions.length - 1]?.breaks.find((b) => b.endAt === null);
    if (breakEndedAt !== null && openBreak?.startEventId && openBreak.plannedMinutes !== null) {
      const over = overbreakOf({ ...openBreak, endAt: breakEndedAt }, breakEndedAt);
      if (over > 0) await notifyOverbreak(tx, person.id, openBreak.startEventId, over, openBreak.plannedMinutes);
    }

    if (type === "clock_in" && input.selfiePath && rules.selfieRequired && monitoring && last) {
      await tx.insert(clockSelfies).values({ eventId: last.id, employeeId: person.id, storagePath: input.selfiePath });
    }
    await writeAudit({ actor, action: `clock.${type}`, targetType: "employee", targetId: person.id, metadata: { outsideAllowedRange, withLocation: Boolean(location), withSelfie: Boolean(input.selfiePath && rules.selfieRequired) } }, tx);
    if (type === "clock_in") await touchPresence(tx, person.id);
    await afterClockEvent(tx, person.id, type);

    return {
      state: transition(endsBreakToo ? "working" : replay.state, endsBreakToo ? "clock_out" : type)!,
      at: last!.occurredAt.toISOString(),
      outsideAllowedRange,
      sessionId: type === "clock_out" ? (replay.sessions[replay.sessions.length - 1]?.startEventId ?? null) : null,
    };
  });
}

/**
 * Hook for Phase 2.4: ELEVATE mirrors clock-in and clock-out to Jibble (queued, retried, logged) so its screenshot
 * app runs only while ELEVATE says the person is working. Nothing is read back from Jibble. Intentionally empty now.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function afterClockEvent(_tx: Executor, _employeeId: string, _type: ClockType): Promise<void> {}

/**
 * Tells the person's lead (HR when nobody is above them) that a timed break ran over. Once per break: the first caller
 * (the person ending the break, or the alert job while it is still running) wins.
 */
export async function notifyOverbreak(tx: Executor, employeeId: string, startEventId: string, overMs: number, plannedMinutes: number): Promise<boolean> {
  const minutes = Math.max(1, Math.round(overMs / MINUTE));
  const claimed = await tx.insert(overbreakNotices).values({ eventId: startEventId, minutesOver: minutes }).onConflictDoNothing().returning({ id: overbreakNotices.eventId });
  if (claimed.length === 0) return false;

  const [me] = await tx.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName }).from(employees).where(eq(employees.id, employeeId));
  const chain = await managerChainUserIds(tx, employeeId);
  const targets = (chain.length > 0 ? chain.slice(0, 1) : await hrUserIds()).filter((id) => id !== me.userId);
  await notify(
    tx,
    targets.map((userId) => ({
      userId,
      kind: "attendance.overbreak",
      title: `${reportName(me)} went over their ${breakLabel(plannedMinutes)} break`,
      body: `${minutes} ${minutes === 1 ? "minute" : "minutes"} over.`,
      link: "/attendance?tab=team",
    })),
  );
  return true;
}

// --- Presence, claims and evidence ---------------------------------------------------------------

/** Records "still here" for a clocked-in person (the database clock). One row per person, no history. */
export async function touchPresence(executor: Executor, employeeId: string): Promise<void> {
  await executor.execute(sql`insert into time.clock_presence (employee_id, last_seen_at) values (${employeeId}, clock_timestamp()) on conflict (employee_id) do update set last_seen_at = clock_timestamp()`);
}

/** A waiting request that adds a clock-out for this person (the "I stopped at ..." flow). */
export async function pendingClockOut(executor: Executor, employeeId: string): Promise<{ id: string; atMs: number } | null> {
  const [row] = (await executor.execute(sql`
    select c.id, (select max((p->>'at')::timestamptz) from jsonb_array_elements(c.proposed) p where p->>'type' = 'clock_out') as at
    from time.clock_corrections c
    where c.employee_id = ${employeeId} and c.status = 'pending' and c.proposed @> '[{"type":"clock_out"}]'::jsonb
    order by c.created_at desc limit 1`)) as unknown as { id: string; at: string | Date }[];
  return row ? { id: row.id, atMs: new Date(row.at).getTime() } : null;
}

export const EVIDENCE_KEEP_DAYS = 90;
const EXT = new Map([["image/jpeg", "jpg"], ["image/png", "png"]]);

/** time-evidence/<employeeId>/<uuid>.<ext>, owned by the person. */
export const evidencePath = (employeeId: string, mime: string) => `time-evidence/${employeeId}/${randomUUID()}.${EXT.get(mime) ?? "jpg"}`;

/** The real type of an image from its first bytes, or null when it is neither JPEG nor PNG. */
export function imageType(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}

/**
 * Checks the screenshots a person wants to attach: they must be the person's own, not attached yet, really there, a real
 * JPEG or PNG and small enough. A bad file is deleted. Fills in the size and checksum and returns the verified ids.
 */
export async function verifyEvidence(tx: Executor, employeeId: string, ids: string[], maxBytes: number): Promise<string[]> {
  const unique = [...new Set(ids)];
  const verified: string[] = [];
  for (const id of unique) {
    const [row] = await tx.select().from(correctionEvidence).where(and(eq(correctionEvidence.id, id), eq(correctionEvidence.employeeId, employeeId), isNull(correctionEvidence.correctionId), isNull(correctionEvidence.purgedAt))).limit(1);
    if (!row) throw new ActionFailure("One of the screenshots is not valid. Add it again.");
    const bytes = await getDocumentStorage().read(BUCKETS.employee, row.storagePath);
    const type = bytes ? imageType(bytes) : null;
    if (!bytes || !type || type !== row.mime || bytes.length > maxBytes) {
      await getDocumentStorage().remove(BUCKETS.employee, [row.storagePath]).catch(() => undefined);
      await tx.delete(correctionEvidence).where(eq(correctionEvidence.id, row.id));
      throw new ActionFailure("A screenshot could not be used. Use a JPG or PNG under 5 MB and add it again.");
    }
    await tx.update(correctionEvidence).set({ sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }).where(eq(correctionEvidence.id, row.id));
    verified.push(row.id);
  }
  return verified;
}
