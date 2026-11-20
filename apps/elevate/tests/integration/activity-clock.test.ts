import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// The tracker app's clock buttons against a real database: same rules as the web clock, the server clock and request address decide,
// and the audit row says it came from the app.

const ctx = vi.hoisted(() => ({ ip: "198.51.100.77" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${ctx.ip}, 10.0.0.1` }) }));

const { db } = await import("@/lib/db");
const { clockForDevice } = await import("@/modules/activity/device-clock");
const { clockStateFor } = await import("@/modules/activity/ingest");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;

async function person(opts: { noUser?: boolean } = {}) {
  const id = randomUUID();
  const email = `clk${Date.now().toString(36)}${counter++}@example.com`;
  if (!opts.noUser) await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  const [e] = await rows<{ id: string }>(
    opts.noUser
      ? sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values ('Cl', 'Ock', ${email}, 'active') returning id`
      : sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Cl', 'Ock', ${email}, 'active', ${id}) returning id`,
  );
  return { employeeId: e.id, userId: id };
}

describe("clockForDevice", () => {
  it("clocks in and out with the server time and the request address, and audits it as from the app", async () => {
    const p = await person();
    const before = Date.now();
    const inRes = await clockForDevice(p.employeeId, "clock_in", {});
    expect(inRes.ok && inRes.result.state).toBe("working");
    const [ev] = await rows<{ source: string; ip: string; t: number }>(sql`select source, ip, (extract(epoch from occurred_at) * 1000)::float8 as t from time.clock_events where employee_id = ${p.employeeId}`);
    expect(ev.source).toBe("web");
    expect(ev.ip).toBe(ctx.ip);
    expect(Math.abs(ev.t - before)).toBeLessThan(10_000);
    const [audit] = await rows<{ metadata: { via?: string } }>(sql`select metadata from ops.audit_log where action = 'clock.clock_in' and target_id = ${p.employeeId}`);
    expect(audit.metadata.via).toBe("tracker_app");
    const outRes = await clockForDevice(p.employeeId, "clock_out", {});
    expect(outRes.ok && outRes.result.state).toBe("out");
  });

  it("refuses with the plain reason when the move is not possible", async () => {
    const p = await person();
    const r = await clockForDevice(p.employeeId, "clock_out", {});
    expect(r).toEqual({ ok: false, error: "refused", message: "You are not clocked in." });
  });

  it("refuses a client the person is not assigned to", async () => {
    const p = await person();
    const r = await clockForDevice(p.employeeId, "clock_in", { clientId: randomUUID() });
    expect(r).toEqual({ ok: false, error: "refused", message: "You are not assigned to that client." });
  });

  it("answers no_person when the device's person has no account", async () => {
    const p = await person({ noUser: true });
    expect(await clockForDevice(p.employeeId, "clock_in", {})).toEqual({ ok: false, error: "no_person" });
  });

  it("refuses a person on the Jibble clock", async () => {
    const p = await person();
    await db.execute(sql`insert into time.clock_source (employee_id, source, set_by) values (${p.employeeId}, 'jibble', ${p.userId})`);
    const r = await clockForDevice(p.employeeId, "clock_in", {});
    expect(r.ok).toBe(false);
    expect((await clockStateFor(p.employeeId)).clockBlockedReason).toBe("jibble");
  });
});

describe("clock state for the app", () => {
  it("reports when the shift began, an open break and no block", async () => {
    const p = await person();
    expect((await clockStateFor(p.employeeId)).workingSince).toBeNull();
    await clockForDevice(p.employeeId, "clock_in", {});
    const working = await clockStateFor(p.employeeId);
    expect(working.state).toBe("working");
    expect(working.workingSince).not.toBeNull();
    expect(working.onBreak).toBeNull();
    expect(working.clockBlockedReason).toBeNull();
    await clockForDevice(p.employeeId, "break_start", { breakMinutes: 15 });
    const onBreak = await clockStateFor(p.employeeId);
    expect(onBreak.state).toBe("break");
    expect(onBreak.onBreak?.plannedMinutes).toBe(15);
    expect(onBreak.workingSince).toBe(working.workingSince);
  });

  it("lists the clients the person is assigned to today", async () => {
    const p = await person();
    const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${`Client ${randomUUID().slice(0, 8)}`}) returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${p.employeeId}, ${c.id}, current_date - 1)`);
    const state = await clockStateFor(p.employeeId);
    expect(state.clients.map((x) => x.id)).toEqual([c.id]);
  });
});
