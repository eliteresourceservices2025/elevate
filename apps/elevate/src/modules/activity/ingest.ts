import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { clientProjects, clients as clientsTable } from "@/modules/people/schema";
import { db } from "@/lib/db";
import { replayClock } from "@/modules/attendance/clock";
import { computeStopLimit } from "@/modules/attendance/auto-stop-limit";
import { clockSourceOf } from "@/modules/attendance/clock-source";
import { loadEventsBetween, monitoringPolicyPublished, rulesFor } from "@/modules/attendance/service";
import { fromZonedTime } from "date-fns-tz";
import { formatInZone } from "@/lib/time";
import { prefsFor } from "@/modules/attendance/service";
import { summarizeToday } from "@/modules/attendance/today-totals";
import { assignedClientsWithProjects, loadWorkLog } from "@/modules/attendance/work-log";
import { sniffFileKind } from "@/modules/documents/files";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { MAX_AGE_MS, SHOT_WINDOW_MS, clipToIntervals, dropOverlaps, sanitizeApp, shotWindow, validateSegment, workingIntervals, type Interval, type RawSegment } from "./logic";
import { activitySegments, activitySettings, activityShots, trackerDevices } from "./schema";
import type { SegmentsBody } from "./validators";

// What the ELEVATE Tracker app may do, after the route has checked its device token. Everything here is evidence only: it never
// writes clock events and never changes hours. The device's clock is not trusted; the server clock and the clock events decide.

export const SHOT_MAX_BYTES = 300 * 1024;
const SHOT_MAX_AGE_MS = 30 * 60_000;
const SHOT_FUTURE_SLACK_MS = 2 * 60_000;

export type DeviceAuth = { deviceId: string; employeeId: string };

async function sessionsFor(employeeId: string, nowMs: number) {
  const events = await loadEventsBetween(db, employeeId, nowMs - MAX_AGE_MS - 60 * 60_000, nowMs + 60_000);
  return replayClock(events);
}

/** What the app needs to know before and while recording. */
export async function clockStateFor(employeeId: string, now = new Date()) {
  const nowMs = now.getTime();
  const replay = await sessionsFor(employeeId, nowMs);
  const open = replay.sessions.at(-1);
  const since = replay.state === "out" || !open ? null : new Date(replay.state === "break" ? (open.breaks.at(-1)?.startAt ?? open.startAt) : open.startAt).toISOString();
  const [settings] = await db.select().from(activitySettings).where(eq(activitySettings.scope, "default")).limit(1);
  const policy = await monitoringPolicyPublished(db);
  const brk = replay.state === "break" ? open?.breaks.at(-1) : undefined;
  const rules = await rulesFor(db, employeeId);
  const clients = await assignedClientsWithProjects(db, employeeId);
  let current: { clientId: string | null; clientName: string | null; projectId: string | null; projectName: string | null; since: string } | null = null;
  if (replay.state !== "out" && open) {
    const last = open.switches.at(-1);
    const clientId = last ? last.clientId : open.clientId;
    const projectId = last ? last.projectId : open.projectId;
    const [client] = clientId ? await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, clientId)).limit(1) : [];
    const [project] = projectId ? await db.select({ name: clientProjects.name }).from(clientProjects).where(eq(clientProjects.id, projectId)).limit(1) : [];
    current = { clientId, clientName: client?.name ?? null, projectId, projectName: project?.name ?? null, since: new Date(last ? last.at : open.startAt).toISOString() };
  }
  // Today (in the person's own zone): the total worked and the time for each client and project, as of now, so the app can keep counting.
  const { zone } = await prefsFor(db, employeeId);
  const dayStart = fromZonedTime(`${formatInZone(now, zone, "yyyy-MM-dd")}T00:00:00`, zone).getTime();
  const today = { asOf: now.toISOString(), ...summarizeToday(await loadWorkLog(db, employeeId, dayStart, nowMs)) };
  const clockBlockedReason: "jibble" | "selfie" | null = (await clockSourceOf(db, employeeId)) === "jibble" ? "jibble" : rules.selfieRequired && policy ? "selfie" : null;
  // When the clock will stop by itself (the person's hours run out), so the app can warn; null when not working or on the Jibble clock.
  const stopLimit = replay.state === "out" ? null : await computeStopLimit(db, employeeId, nowMs, { replay });
  return {
    state: replay.state,
    since,
    /** When the current clocked-in session began (the break, if any, is inside it); null when clocked out. */
    workingSince: replay.state === "out" || !open ? null : new Date(open.startAt).toISOString(),
    onBreak: brk ? { startedAt: new Date(brk.startAt).toISOString(), plannedMinutes: brk.plannedMinutes } : null,
    /** The clients the person can clock in for today (the app asks when there is more than one). */
    clients,
    /** The client and project the time is going to right now, and since when (the last switch, or the clock-in). */
    current,
    /** Today's worked time (breaks left out): the total and each client and project, as of `asOf`. Evidence for the person's own screen, never hours. */
    today,
    /** Why the app's clock buttons are off: a Jibble-clock person, or a team that needs a selfie (the app cannot take one). */
    clockBlockedReason,
    stopAt: stopLimit ? new Date(stopLimit.limitMs).toISOString() : null,
    warnAt: stopLimit ? new Date(stopLimit.limitMs - rules.autoStopWarnMinutes * 60_000).toISOString() : null,
    policy,
    settings: { idleTimeoutSeconds: settings?.idleTimeoutSeconds ?? 180, shotIntervalMinutes: SHOT_WINDOW_MS / 60_000 },
  };
}

export type IngestResult =
  | { ok: true; accepted: number; clipped: number; duplicate: number; rejected: Record<string, number> }
  | { ok: false; reason: "policy" };

/**
 * Stores a batch of segments. Each one is checked (believable times), cut to the working time (breaks and time off the clock are
 * removed) and trimmed against what is already stored, so a retried upload changes nothing. Existing time is checked across all of
 * the person's computers, so two machines never count the same minutes twice.
 */
export async function ingestSegments(auth: DeviceAuth, body: SegmentsBody, now = new Date()): Promise<IngestResult> {
  if (!(await monitoringPolicyPublished(db))) return { ok: false, reason: "policy" };
  const nowMs = now.getTime();
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  const working = workingIntervals((await sessionsFor(auth.employeeId, nowMs)).sessions, nowMs);
  const clippedPieces: RawSegment[] = [];
  let clipped = 0;
  for (const item of body.segments) {
    const app = sanitizeApp(item.app);
    const raw: RawSegment = { start: Date.parse(item.start), end: Date.parse(item.end), app: app ?? "", state: item.state };
    if (!app) {
      reject("no_app");
      continue;
    }
    const check = validateSegment(raw, nowMs);
    if (check !== "ok") {
      reject(check);
      continue;
    }
    const pieces = clipToIntervals(raw, working);
    if (pieces.length === 0) {
      reject("not_working");
      continue;
    }
    if (pieces.length > 1 || pieces[0].start !== raw.start || pieces[0].end !== raw.end) clipped += 1;
    clippedPieces.push(...pieces);
  }

  let accepted = 0;
  let duplicate = 0;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tracker:${auth.employeeId}`}))`);
    if (clippedPieces.length > 0) {
      const from = Math.min(...clippedPieces.map((p) => p.start));
      const to = Math.max(...clippedPieces.map((p) => p.end));
      const existing = (await tx.execute(sql`
        select (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e
        from time.activity_segments
        where employee_id = ${auth.employeeId} and started_at < to_timestamp(${to / 1000}) and ended_at > to_timestamp(${from / 1000})`)) as unknown as { s: number; e: number }[];
      const taken: Interval[] = existing.map((r) => ({ start: Number(r.s), end: Number(r.e) }));
      const result = dropOverlaps(clippedPieces, taken);
      duplicate = result.dropped;
      if (result.kept.length > 0) {
        await tx.insert(activitySegments).values(
          result.kept.map((p) => ({ employeeId: auth.employeeId, deviceId: auth.deviceId, startedAt: new Date(p.start), endedAt: new Date(p.end), app: p.app, state: p.state })),
        );
        accepted = result.kept.length;
      }
    }
    const health: Partial<typeof trackerDevices.$inferInsert> = {};
    if (body.appVersion) health.appVersion = body.appVersion;
    if (body.permissionsOk !== undefined) health.permissionsOk = body.permissionsOk;
    if (body.queueSize !== undefined) health.queueSize = body.queueSize;
    if (Object.keys(health).length > 0) await tx.update(trackerDevices).set(health).where(eq(trackerDevices.id, auth.deviceId));
  });
  return { ok: true, accepted, clipped, duplicate, rejected };
}

export type ShotRequest = { ok: true; shotId: string; path: string; token: string } | { ok: false; reason: "not_working" | "window_used" | "policy" | "too_old" };

const dayStamp = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** A one-time upload link for one blurred screenshot, if the person is working and the 10-minute window is free. */
export async function requestShot(auth: DeviceAuth, body: { takenAt: string }, now = new Date()): Promise<ShotRequest> {
  if (!(await monitoringPolicyPublished(db))) return { ok: false, reason: "policy" };
  const nowMs = now.getTime();
  const takenMs = Date.parse(body.takenAt);
  if (!Number.isFinite(takenMs) || takenMs < nowMs - SHOT_MAX_AGE_MS || takenMs > nowMs + SHOT_FUTURE_SLACK_MS) return { ok: false, reason: "too_old" };
  const working = workingIntervals((await sessionsFor(auth.employeeId, nowMs)).sessions, nowMs);
  if (!working.some((w) => takenMs >= w.start && takenMs <= w.end)) return { ok: false, reason: "not_working" };

  const windowIndex = shotWindow(takenMs);
  const storage = getDocumentStorage();
  const shotId = randomUUID();
  const path = `shots/${auth.employeeId}/${dayStamp(takenMs)}/${shotId}.jpg`;
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tracker:${auth.employeeId}`}))`);
    const [existing] = await tx
      .select({ id: activityShots.id, path: activityShots.storagePath, finalizedAt: activityShots.finalizedAt })
      .from(activityShots)
      .where(and(eq(activityShots.employeeId, auth.employeeId), eq(activityShots.windowIndex, windowIndex)))
      .limit(1);
    if (existing?.finalizedAt) return { ok: false as const };
    // An earlier request that was never finished (a dropped connection) is replaced.
    if (existing) {
      await tx.delete(activityShots).where(eq(activityShots.id, existing.id));
      await storage.remove(BUCKETS.tracker, [existing.path]).catch(() => undefined);
    }
    await tx.insert(activityShots).values({ id: shotId, employeeId: auth.employeeId, deviceId: auth.deviceId, windowIndex, storagePath: path, takenAt: new Date(takenMs) });
    return { ok: true as const };
  });
  if (!claimed.ok) return { ok: false, reason: "window_used" };
  const { token } = await storage.createSignedUpload(BUCKETS.tracker, path);
  return { ok: true, shotId, path, token };
}

export type ShotFinalize = { ok: true } | { ok: false; reason: "missing" | "too_large" | "bad_type" };

/** Checks the uploaded file by its bytes (a small JPEG or PNG) and activates it; a bad file is deleted. */
export async function finalizeShot(auth: DeviceAuth, body: { shotId: string }): Promise<ShotFinalize> {
  const [shot] = await db
    .select({ id: activityShots.id, path: activityShots.storagePath, finalizedAt: activityShots.finalizedAt })
    .from(activityShots)
    .where(and(eq(activityShots.id, body.shotId), eq(activityShots.employeeId, auth.employeeId), isNull(activityShots.purgedAt)))
    .limit(1);
  if (!shot) return { ok: false, reason: "missing" };
  if (shot.finalizedAt) return { ok: true };
  const storage = getDocumentStorage();
  const discard = async (reason: "missing" | "too_large" | "bad_type"): Promise<ShotFinalize> => {
    await storage.remove(BUCKETS.tracker, [shot.path]).catch(() => undefined);
    await db.delete(activityShots).where(eq(activityShots.id, shot.id));
    return { ok: false, reason };
  };
  const bytes = await storage.read(BUCKETS.tracker, shot.path);
  if (!bytes) return discard("missing");
  if (bytes.length > SHOT_MAX_BYTES) return discard("too_large");
  const kind = sniffFileKind(bytes);
  if (kind !== "jpg" && kind !== "png") return discard("bad_type");
  await db.update(activityShots).set({ finalizedAt: new Date() }).where(eq(activityShots.id, shot.id));
  return { ok: true };
}
