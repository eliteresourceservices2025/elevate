import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Device enrollment and token checks against a real database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const auth = await import("@/modules/activity/device-auth");
const actions = await import("@/modules/activity/actions");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;

async function makePerson(roles: string[] = ["employee"]) {
  const id = randomUUID();
  const email = `dev${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Dev', 'Ice', ${email}, 'active', ${id}) returning id`);
  return { user: { id, email, roles }, employeeId: e.id };
}

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

const redeem = (code: string, now?: Date) => auth.redeemEnrollmentCode({ code, name: "Work laptop", os: "windows", appVersion: "1.0.0", now });

beforeAll(() => undefined);

describe("enrollment codes", () => {
  it("redeems once, then says used", async () => {
    const { user } = await makePerson();
    current.user = user;
    await withPolicy(async () => {
      const made = await actions.createEnrollmentCode();
      if (!made.ok) throw new Error(made.error);
      const first = await redeem(made.data.code.toLowerCase());
      expect(first.ok).toBe(true);
      expect(await redeem(made.data.code)).toEqual({ ok: false, reason: "used" });
    });
  });

  it("says expired after 15 minutes", async () => {
    const { user } = await makePerson();
    current.user = user;
    await withPolicy(async () => {
      const made = await actions.createEnrollmentCode();
      if (!made.ok) throw new Error(made.error);
      expect(await redeem(made.data.code, new Date(Date.now() + 16 * 60_000))).toEqual({ ok: false, reason: "expired" });
    });
  });

  it("says invalid for a code that does not exist", async () => {
    expect(await redeem("ZZZZ9999")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses when no monitoring policy is published", async () => {
    const { user } = await makePerson();
    current.user = user;
    // The code can only be created under a policy, so make it, then withdraw the policy before redeeming.
    const code = await withPolicy(async () => {
      const made = await actions.createEnrollmentCode();
      if (!made.ok) throw new Error(made.error);
      return made.data.code;
    });
    expect(await redeem(code)).toEqual({ ok: false, reason: "policy" });
  });

  it("a newer code replaces the person's earlier unused one", async () => {
    const { user } = await makePerson();
    current.user = user;
    await withPolicy(async () => {
      const a = await actions.createEnrollmentCode();
      const b = await actions.createEnrollmentCode();
      if (!a.ok || !b.ok) throw new Error("code not created");
      expect(await redeem(a.data.code)).toEqual({ ok: false, reason: "invalid" });
      expect((await redeem(b.data.code)).ok).toBe(true);
    });
  });
});

describe("people on the Jibble clock", () => {
  it("cannot enroll: their hours come from Jibble, so there is no ELEVATE working time to record against", async () => {
    const { user, employeeId } = await makePerson();
    await db.execute(sql`insert into time.clock_source (employee_id, source, set_by) values (${employeeId}, 'jibble', ${user.id})`);
    current.user = user;
    await withPolicy(async () => {
      const made = await actions.createEnrollmentCode();
      expect(made.ok).toBe(false);
      if (!made.ok) expect(made.error).toMatch(/Jibble/);
    });
  });
});

describe("device tokens", () => {
  it("authenticate an active device and stop working once it is revoked", async () => {
    const { user, employeeId } = await makePerson();
    current.user = user;
    await withPolicy(async () => {
      const made = await actions.createEnrollmentCode();
      if (!made.ok) throw new Error(made.error);
      const done = await redeem(made.data.code);
      if (!done.ok) throw new Error(done.reason);
      expect(await auth.authenticateDevice(`Bearer ${done.token}`)).toEqual({ deviceId: done.deviceId, employeeId });
      const revoked = await actions.revokeDevice({ deviceId: done.deviceId });
      expect(revoked.ok).toBe(true);
      expect(await auth.authenticateDevice(`Bearer ${done.token}`)).toBeNull();
    });
  });

  it("do not authenticate with a missing, malformed or unknown header", async () => {
    expect(await auth.authenticateDevice(null)).toBeNull();
    expect(await auth.authenticateDevice("Basic abc")).toBeNull();
    expect(await auth.authenticateDevice("Bearer not-a-real-token")).toBeNull();
  });

  it("let a person revoke only their own device, but HR any device", async () => {
    const owner = await makePerson();
    const other = await makePerson();
    const hr = await makePerson(["hr_admin", "employee"]);
    await withPolicy(async () => {
      current.user = owner.user;
      const made = await actions.createEnrollmentCode();
      if (!made.ok) throw new Error(made.error);
      const done = await redeem(made.data.code);
      if (!done.ok) throw new Error(done.reason);
      current.user = other.user;
      expect((await actions.revokeDevice({ deviceId: done.deviceId })).ok).toBe(false);
      current.user = hr.user;
      expect((await actions.revokeDevice({ deviceId: done.deviceId })).ok).toBe(true);
    });
  });
});
