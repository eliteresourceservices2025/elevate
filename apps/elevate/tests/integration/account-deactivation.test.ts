import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real-database test: a Super Admin can switch an account off and on again. The auth service is replaced by fakes.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { setLoginDisabler, setLoginEnabler } = await import("@/modules/onboarding/accounts");
const { deactivateAccount, reactivateAccount } = await import("@/modules/settings/actions");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(role: "super_admin" | "employee") {
  const id = randomUUID();
  const email = `${uniq("acct")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role] };
}

const banned: string[] = [];
const unbanned: string[] = [];
setLoginDisabler(async (id) => void banned.push(id));
setLoginEnabler(async (id) => void unbanned.push(id));
// The throwaway database has no Supabase auth schema; the action ends open sessions in it.
beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null)`);
});
afterAll(() => {
  setLoginDisabler(null);
  setLoginEnabler(null);
});

describe("deactivating an account", () => {
  it("switches off a test account, writes the audit entry, and can switch it back on", async () => {
    const admin = await account("super_admin");
    const test = await account("employee");
    current.user = admin;

    expect(await deactivateAccount({ userId: test.id })).toEqual({ ok: true, data: undefined });
    expect(banned).toContain(test.id);
    const [row] = await rows<{ archived_at: Date | null }>(sql`select archived_at from core.users where id = ${test.id}`);
    expect(row.archived_at).not.toBeNull();
    expect(await rows(sql`select 1 from ops.audit_log where action = 'user.deactivate' and target_id = ${test.id}`)).toHaveLength(1);
    expect(await deactivateAccount({ userId: test.id })).toEqual({ ok: false, error: "That account is already deactivated." });

    expect(await reactivateAccount({ userId: test.id })).toEqual({ ok: true, data: undefined });
    expect(unbanned).toContain(test.id);
    const [back] = await rows<{ archived_at: Date | null }>(sql`select archived_at from core.users where id = ${test.id}`);
    expect(back.archived_at).toBeNull();
    expect(await reactivateAccount({ userId: test.id })).toEqual({ ok: false, error: "That account is not deactivated." });
  });

  it("refuses your own account and a person who works on the team", async () => {
    const admin = await account("super_admin");
    current.user = admin;
    expect(await deactivateAccount({ userId: admin.id })).toEqual({ ok: false, error: "You cannot deactivate your own account." });

    const member = await account("employee");
    await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Ana', 'Cruz', ${`${uniq("emp")}@example.com`}, 'active', ${member.id})`);
    const result = await deactivateAccount({ userId: member.id });
    expect(result).toEqual({ ok: false, error: "This account belongs to a person on the team. End their engagement with Offboarding instead." });
    const [row] = await rows<{ archived_at: Date | null }>(sql`select archived_at from core.users where id = ${member.id}`);
    expect(row.archived_at).toBeNull();
  });

  it("refuses everyone but a Super Admin", async () => {
    const hr = await account("employee");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${hr.id}, 'hr_admin')`);
    current.user = { ...hr, roles: ["employee", "hr_admin"] };
    const target = await account("employee");
    expect(await deactivateAccount({ userId: target.id })).toEqual({ ok: false, error: "You do not have access to do that." });
  });
});
