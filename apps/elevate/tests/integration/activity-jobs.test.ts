import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// The tracker's daily rollup, its day flags, the screenshot clean-up and the offline alert, against a real database.

const { db } = await import("@/lib/db");
const jobs = await import("@/modules/activity/jobs");
const { activityFlagsFor } = await import("@/modules/activity/flags");
const { setDocumentStorage } = await import("@/modules/documents/storage");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const MIN = 60_000;
const fake = new FakeStorage();
let counter = 0;

async function makePerson(opts: { managerId?: string; device?: boolean } = {}) {
  const userId = randomUUID();
  const email = `job${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${email})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id) values ('Job', 'Er', ${email}, 'active', ${userId}, ${opts.managerId ?? null}) returning id`);
  let deviceId = "";
  if (opts.device !== false) {
    const [d] = await rows<{ id: string }>(sql`insert into time.tracker_devices (employee_id, name, os, token_hash, created_at) values (${e.id}, 'PC', 'windows', ${randomUUID()}, now() - interval '2 days') returning id`);
    deviceId = d.id;
  }
  return { userId, employeeId: e.id, deviceId };
}

const clock = (employeeId: string, type: string, at: Date) => db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${at.toISOString()})`);
const segment = (p: { employeeId: string; deviceId: string }, start: Date, end: Date, app: string, state = "active") =>
  db.execute(sql`insert into time.activity_segments (employee_id, device_id, started_at, ended_at, app, state) values (${p.employeeId}, ${p.deviceId}, ${start.toISOString()}, ${end.toISOString()}, ${app}, ${state})`);

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

beforeAll(() => setDocumentStorage(fake));

describe("rebuildActivityMinutes", () => {
  it("sums active, idle, work and non-work minutes for the day in the person's zone", async () => {
    const p = await makePerson();
    await db.execute(sql`insert into time.activity_categories (pattern, category, rank) values ('^zzchrome$', 'work', 10), ('^zzspotify$', 'non_work', 10)`);
    // 17:00Z is 10:00 in Phoenix (UTC-7, no daylight saving).
    const t = (min: number) => new Date(Date.UTC(2026, 10, 10, 17, 0) + min * MIN);
    await segment(p, t(0), t(30), "ZzChrome");
    await segment(p, t(30), t(60), "ZzChrome");
    await segment(p, t(60), t(90), "ZzChrome", "idle");
    await segment(p, t(90), t(105), "ZzSpotify");
    await jobs.rebuildActivityMinutes("2026-11-10", p.employeeId);
    const [r] = await rows<{ active_minutes: number; idle_minutes: number; work_minutes: number; non_work_minutes: number; top_apps: { app: string; minutes: number }[] }>(
      sql`select active_minutes, idle_minutes, work_minutes, non_work_minutes, top_apps from time.activity_minutes where employee_id = ${p.employeeId} and date = '2026-11-10'`,
    );
    expect(r.active_minutes).toBe(75);
    expect(r.idle_minutes).toBe(30);
    expect(r.work_minutes).toBe(60);
    expect(r.non_work_minutes).toBe(15);
    expect(r.top_apps[0]).toEqual({ app: "ZzChrome", minutes: 60 });
  });

  it("puts a segment that crosses midnight in the zone into both days, and is safe to run twice", async () => {
    const p = await makePerson();
    // 06:50Z is 23:50 on the 10th in Phoenix; the segment runs to 00:10 on the 11th.
    await segment(p, new Date(Date.UTC(2026, 10, 11, 6, 50)), new Date(Date.UTC(2026, 10, 11, 7, 10)), "ZzMidnight");
    await jobs.rebuildActivityMinutes("2026-11-10", p.employeeId);
    await jobs.rebuildActivityMinutes("2026-11-10", p.employeeId);
    await jobs.rebuildActivityMinutes("2026-11-11", p.employeeId);
    const got = await rows<{ date: string; active_minutes: number }>(sql`select date::text as date, active_minutes from time.activity_minutes where employee_id = ${p.employeeId} order by date`);
    expect(got).toEqual([{ date: "2026-11-10", active_minutes: 10 }, { date: "2026-11-11", active_minutes: 10 }]);
  });
});

describe("activityFlagsFor", () => {
  const worked = async (p: { employeeId: string }, now: Date, hours: number) => {
    await clock(p.employeeId, "clock_in", new Date(now.getTime() - hours * 60 * MIN));
    await clock(p.employeeId, "clock_out", new Date(now.getTime() - 1 * MIN));
  };

  it("is empty for someone with no tracker, however much they worked", async () => {
    const now = new Date();
    const p = await makePerson({ device: false });
    await worked(p, now, 3);
    await withPolicy(async () => expect(await activityFlagsFor(p.employeeId, now.getTime() - 4 * 60 * MIN, now.getTime())).toEqual([]));
  });

  it("is empty for someone on the Jibble clock: their hours are imported, so the tracker cannot judge them", async () => {
    const now = new Date();
    const p = await makePerson();
    await db.execute(sql`insert into time.clock_source (employee_id, source, set_by) values (${p.employeeId}, 'jibble', ${p.userId})`);
    await worked(p, now, 3);
    await withPolicy(async () => expect(await activityFlagsFor(p.employeeId, now.getTime() - 4 * 60 * MIN, now.getTime())).toEqual([]));
  });

  it("is empty while no monitoring policy is published", async () => {
    const now = new Date();
    const p = await makePerson();
    await worked(p, now, 3);
    expect(await activityFlagsFor(p.employeeId, now.getTime() - 4 * 60 * MIN, now.getTime())).toEqual([]);
  });

  it("flags a tracker that recorded nothing for hours of work", async () => {
    const now = new Date();
    const p = await makePerson();
    await worked(p, now, 3);
    await withPolicy(async () => expect((await activityFlagsFor(p.employeeId, now.getTime() - 4 * 60 * MIN, now.getTime())).sort()).toEqual(["no_shots", "tracker_offline"]));
  });

  it("is clean with full recording, mostly active, and a screenshot", async () => {
    const now = new Date();
    const p = await makePerson();
    await worked(p, now, 2);
    await segment(p, new Date(now.getTime() - 2 * 60 * MIN), new Date(now.getTime() - 90 * MIN), "ZzApp");
    await segment(p, new Date(now.getTime() - 90 * MIN), new Date(now.getTime() - 60 * MIN), "ZzApp");
    await segment(p, new Date(now.getTime() - 60 * MIN), new Date(now.getTime() - 30 * MIN), "ZzApp");
    await segment(p, new Date(now.getTime() - 30 * MIN), new Date(now.getTime() - 1 * MIN), "ZzApp");
    await db.execute(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at, finalized_at) values (${p.employeeId}, ${p.deviceId}, ${Math.floor(now.getTime() / 600000)}, ${`shots/${p.employeeId}/f.jpg`}, ${new Date(now.getTime() - 30 * MIN).toISOString()}, now())`);
    await withPolicy(async () => expect(await activityFlagsFor(p.employeeId, now.getTime() - 4 * 60 * MIN, now.getTime())).toEqual([]));
  });
});

describe("purgeShots", () => {
  it("deletes files older than 30 days, keeps the row, and leaves recent ones", async () => {
    const p = await makePerson();
    const oldPath = `shots/${p.employeeId}/old.jpg`;
    const newPath = `shots/${p.employeeId}/new.jpg`;
    await fake.write("activity-shots", oldPath, PNG_BYTES);
    await fake.write("activity-shots", newPath, PNG_BYTES);
    await db.execute(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at, finalized_at) values
      (${p.employeeId}, ${p.deviceId}, 1, ${oldPath}, now() - interval '31 days', now() - interval '31 days'),
      (${p.employeeId}, ${p.deviceId}, 2, ${newPath}, now() - interval '2 days', now() - interval '2 days')`);
    const r = await jobs.purgeShots();
    expect(r.purged).toBeGreaterThanOrEqual(1);
    expect(fake.objects.has(fake.key("activity-shots", oldPath))).toBe(false);
    expect(fake.objects.has(fake.key("activity-shots", newPath))).toBe(true);
    const got = await rows<{ storage_path: string; purged: boolean }>(sql`select storage_path, purged_at is not null as purged from time.activity_shots where employee_id = ${p.employeeId} order by window_index`);
    expect(got).toEqual([{ storage_path: oldPath, purged: true }, { storage_path: newPath, purged: false }]);
  });
});

describe("purgeShots in batches", () => {
  it("keeps going until every stale screenshot is gone, however many there are", async () => {
    const p = await makePerson();
    for (let i = 0; i < 5; i++) {
      const path = `shots/${p.employeeId}/batch${i}.jpg`;
      await fake.write("activity-shots", path, PNG_BYTES);
      await db.execute(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at, finalized_at) values (${p.employeeId}, ${p.deviceId}, ${100 + i}, ${path}, now() - interval '45 days', now() - interval '45 days')`);
    }
    const r = await jobs.purgeShots(new Date(), 2); // a batch of 2 needs three passes
    expect(r.purged).toBeGreaterThanOrEqual(5);
    const [left] = await rows<{ n: number }>(sql`select count(*)::int as n from time.activity_shots where employee_id = ${p.employeeId} and purged_at is null`);
    expect(left.n).toBe(0);
  });
});

describe("runTrackerOfflineAlerts", () => {
  it("tells the lead once when a clocked-in person's tracker has been quiet too long", async () => {
    const now = new Date();
    const lead = await makePerson({ device: false });
    const p = await makePerson({ managerId: lead.employeeId });
    await clock(p.employeeId, "clock_in", new Date(now.getTime() - 60 * MIN));
    await segment(p, new Date(now.getTime() - 55 * MIN), new Date(now.getTime() - 40 * MIN), "ZzApp");
    await withPolicy(async () => {
      const first = await jobs.runTrackerOfflineAlerts(now);
      expect(first.noticed).toBeGreaterThanOrEqual(1);
      expect(await jobs.runTrackerOfflineAlerts(now)).toEqual({ noticed: 0 });
      const n = await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${lead.userId} and kind = 'tracker.offline'`);
      expect(n).toHaveLength(1);
      expect(n[0].title).not.toMatch(/ZzApp|Job Er/); // no app names and no person's name in a notice (the spec: counts and links only)
    });
  });

  it("stays quiet for someone whose tracker reported recently", async () => {
    const now = new Date();
    const lead = await makePerson({ device: false });
    const p = await makePerson({ managerId: lead.employeeId });
    await clock(p.employeeId, "clock_in", new Date(now.getTime() - 60 * MIN));
    await segment(p, new Date(now.getTime() - 20 * MIN), new Date(now.getTime() - 2 * MIN), "ZzApp");
    await withPolicy(async () => {
      await jobs.runTrackerOfflineAlerts(now);
      expect(await rows(sql`select 1 from ops.notifications where user_id = ${lead.userId} and kind = 'tracker.offline'`)).toHaveLength(0);
    });
  });
});
