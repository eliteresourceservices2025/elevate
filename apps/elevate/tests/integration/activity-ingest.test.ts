import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeStorage, PDF_BYTES, PNG_BYTES } from "./fake-storage";

// The tracker's ingest rules against a real database: segments are clipped to working time, retries do not double count,
// and screenshots are limited by window, type and size.

const { db } = await import("@/lib/db");
const ingest = await import("@/modules/activity/ingest");
const { setDocumentStorage } = await import("@/modules/documents/storage");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const MIN = 60_000;
const fake = new FakeStorage();
let counter = 0;

async function makeDevice() {
  const id = randomUUID();
  const email = `ing${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('In', 'Gest', ${email}, 'active', ${id}) returning id`);
  const [d] = await rows<{ id: string }>(sql`insert into time.tracker_devices (employee_id, name, os, token_hash) values (${e.id}, 'PC', 'windows', ${randomUUID()}) returning id`);
  return { employeeId: e.id, deviceId: d.id };
}

const event = (employeeId: string, type: string, at: Date) =>
  db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${at.toISOString()})`);

async function withPolicy<T>(fn: () => Promise<T>): Promise<T> {
  const [p] = await rows<{ id: string }>(sql`select id from docs.policies where kind = 'monitoring'`);
  await db.execute(sql`update docs.policies set archived_at = null where id = ${p.id}`);
  await db.execute(sql`
    insert into docs.policy_versions (policy_id, version, body, status, requires_ack, published_by, published_at)
    select ${p.id}, coalesce(max(version), 0) + 1, 'Test monitoring policy', 'published', true, ${randomUUID()}, now() from docs.policy_versions where policy_id = ${p.id}`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`update docs.policies set archived_at = now() where id = ${p.id}`);
  }
}

const seg = (now: Date, fromMinAgo: number, toMinAgo: number, app = "Chrome", state: "active" | "idle" = "active") => ({
  start: new Date(now.getTime() - fromMinAgo * MIN).toISOString(),
  end: new Date(now.getTime() - toMinAgo * MIN).toISOString(),
  app,
  state,
});

const stored = (employeeId: string) =>
  rows<{ s: number; e: number }>(sql`select (extract(epoch from started_at) * 1000)::float8 as s, (extract(epoch from ended_at) * 1000)::float8 as e from time.activity_segments where employee_id = ${employeeId} order by started_at`);

beforeAll(() => setDocumentStorage(fake));

/** Clocked in 60 minutes ago, on a break from 40 to 30 minutes ago, still working. */
async function workingPerson(now: Date) {
  const p = await makeDevice();
  await event(p.employeeId, "clock_in", new Date(now.getTime() - 60 * MIN));
  await event(p.employeeId, "break_start", new Date(now.getTime() - 40 * MIN));
  await event(p.employeeId, "break_end", new Date(now.getTime() - 30 * MIN));
  return p;
}

describe("clock state", () => {
  it("tells the app whether to record", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    const state = await ingest.clockStateFor(p.employeeId, now);
    expect(state.state).toBe("working");
    const idle = await makeDevice();
    expect((await ingest.clockStateFor(idle.employeeId, now)).state).toBe("out");
  });
});

describe("ingestSegments", () => {
  it("clips a segment to the working time and leaves the break out", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const r = await ingest.ingestSegments(p, { segments: [seg(now, 50, 20)] }, now);
      expect(r).toMatchObject({ ok: true, accepted: 2, clipped: 1, duplicate: 0 });
      const got = await stored(p.employeeId);
      expect(got.map((g) => [Math.round((now.getTime() - g.s) / MIN), Math.round((now.getTime() - g.e) / MIN)])).toEqual([[50, 40], [30, 20]]);
    });
  });

  it("ignores a retried batch instead of counting it twice", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const body = { segments: [seg(now, 25, 20), seg(now, 20, 15, "Excel")] };
      expect(await ingest.ingestSegments(p, body, now)).toMatchObject({ ok: true, accepted: 2 });
      expect(await ingest.ingestSegments(p, body, now)).toMatchObject({ ok: true, accepted: 0, duplicate: 2 });
      expect(await stored(p.employeeId)).toHaveLength(2);
    });
  });

  it("rejects future and too-old segments by reason and stores nothing for them", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const future = { start: new Date(now.getTime() + 10 * MIN).toISOString(), end: new Date(now.getTime() + 15 * MIN).toISOString(), app: "Chrome", state: "active" as const };
      const old = { start: new Date(now.getTime() - 48 * 60 * MIN).toISOString(), end: new Date(now.getTime() - 48 * 60 * MIN + 10 * MIN).toISOString(), app: "Chrome", state: "active" as const };
      const r = await ingest.ingestSegments(p, { segments: [future, old] }, now);
      expect(r).toMatchObject({ ok: true, accepted: 0, rejected: { future: 1, too_old: 1 } });
      expect(await stored(p.employeeId)).toHaveLength(0);
    });
  });

  it("drops time while the person is on a break or clocked out", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const r = await ingest.ingestSegments(p, { segments: [seg(now, 38, 32)] }, now); // wholly inside the break
      expect(r).toMatchObject({ ok: true, accepted: 0, rejected: { not_working: 1 } });
      const nobody = await makeDevice();
      expect(await ingest.ingestSegments(nobody, { segments: [seg(now, 10, 5)] }, now)).toMatchObject({ ok: true, accepted: 0, rejected: { not_working: 1 } });
    });
  });

  it("stores nothing at all when no monitoring policy is published", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    expect(await ingest.ingestSegments(p, { segments: [seg(now, 25, 20)] }, now)).toEqual({ ok: false, reason: "policy" });
    expect(await stored(p.employeeId)).toHaveLength(0);
  });

  it("keeps only an app name: control characters go and long names are cut", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      await ingest.ingestSegments(p, { segments: [seg(now, 25, 20, `  Chrome\u0007 ${"x".repeat(200)}`)] }, now);
      const [r] = await rows<{ app: string }>(sql`select app from time.activity_segments where employee_id = ${p.employeeId}`);
      expect(r.app.startsWith("Chrome x")).toBe(true);
      expect(r.app.length).toBeLessThanOrEqual(80);
    });
  });
});

describe("screenshots", () => {
  it("allows one per 10-minute window", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const takenAt = new Date(now.getTime() - 5 * MIN).toISOString();
      const first = await ingest.requestShot(p, { takenAt }, now);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      fake.put("activity-shots", first.path, PNG_BYTES);
      expect(await ingest.finalizeShot(p, { shotId: first.shotId })).toEqual({ ok: true });
      expect(await ingest.requestShot(p, { takenAt }, now)).toEqual({ ok: false, reason: "window_used" });
    });
  });

  it("refuses a screenshot taken during a break", async () => {
    const now = new Date();
    const p = await makeDevice();
    await event(p.employeeId, "clock_in", new Date(now.getTime() - 60 * MIN));
    await event(p.employeeId, "break_start", new Date(now.getTime() - 20 * MIN));
    await event(p.employeeId, "break_end", new Date(now.getTime() - 10 * MIN));
    await withPolicy(async () => {
      expect(await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 15 * MIN).toISOString() }, now)).toEqual({ ok: false, reason: "not_working" });
    });
  });

  it("refuses a wrong file type and an oversized file, and removes them", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    await withPolicy(async () => {
      const a = await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 5 * MIN).toISOString() }, now);
      if (!a.ok) throw new Error(a.reason);
      fake.put("activity-shots", a.path, PDF_BYTES);
      expect(await ingest.finalizeShot(p, { shotId: a.shotId })).toEqual({ ok: false, reason: "bad_type" });
      expect(fake.objects.has(fake.key("activity-shots", a.path))).toBe(false);

      const b = await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 5 * MIN).toISOString() }, now);
      if (!b.ok) throw new Error(b.reason);
      const big = new Uint8Array(400 * 1024);
      big.set(PNG_BYTES);
      fake.put("activity-shots", b.path, big);
      expect(await ingest.finalizeShot(p, { shotId: b.shotId })).toEqual({ ok: false, reason: "too_large" });
      expect(fake.objects.has(fake.key("activity-shots", b.path))).toBe(false);
    });
  });

  it("refuses a screenshot when no policy is published or the time is too old", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    expect(await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 5 * MIN).toISOString() }, now)).toEqual({ ok: false, reason: "policy" });
    await withPolicy(async () => {
      expect(await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 3 * 60 * MIN).toISOString() }, now)).toEqual({ ok: false, reason: "too_old" });
    });
  });

  it("only finalizes the device's own screenshot", async () => {
    const now = new Date();
    const p = await workingPerson(now);
    const q = await workingPerson(now);
    await withPolicy(async () => {
      const a = await ingest.requestShot(p, { takenAt: new Date(now.getTime() - 5 * MIN).toISOString() }, now);
      if (!a.ok) throw new Error(a.reason);
      fake.put("activity-shots", a.path, PNG_BYTES);
      expect(await ingest.finalizeShot(q, { shotId: a.shotId })).toEqual({ ok: false, reason: "missing" });
    });
  });
});
