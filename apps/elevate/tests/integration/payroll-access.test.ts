import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database test: a Super Admin chooses who has payroll access. Invented names only.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { authorize, ForbiddenError } = await import("@/lib/authz");
const { ensureCoreUser } = await import("@/modules/core/users");
const { setPayrollAccess } = await import("@/modules/settings/actions");
const { getPayrollAccessList } = await import("@/modules/settings/queries");
const { readChangeDetail } = await import("@/modules/payroll/changes");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(role: "super_admin" | "employee", level: string | null = null) {
  const id = randomUUID();
  const email = `${uniq("pay")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role], payrollAccess: level };
}
const levelOf = async (id: string) => (await rows<{ payroll_access: string | null }>(sql`select payroll_access from core.users where id = ${id}`))[0].payroll_access;
const notesFor = (id: string) =>
  rows<{ title: string; body: string | null; link: string | null }>(sql`select title, body, link from ops.notifications where user_id = ${id} and kind = 'payroll.access'`);

describe("choosing payroll access", () => {
  it("lets a Super Admin set their own level, and writes the audit and change log rows", async () => {
    const admin = await account("super_admin");
    current.user = admin;
    expect(await setPayrollAccess({ userId: admin.id, level: "preparer" })).toEqual({ ok: true, data: undefined });
    expect(await levelOf(admin.id)).toBe("preparer");

    const [audit] = await rows<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
      sql`select before, after from ops.audit_log where action = 'user.payroll_access.update' and target_id = ${admin.id}`,
    );
    expect(audit.before).toEqual({ payrollAccess: null });
    expect(audit.after).toEqual({ payrollAccess: "preparer" });

    const logged = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where actor_id = ${admin.id} and action = 'access_changed'`,
    );
    expect(logged).toHaveLength(1);
    expect(readChangeDetail(logged[0])).toMatchObject({ userId: admin.id, from: null, to: "preparer" });
  });

  it("answers 'No change.' for the same level, and refuses an archived or unknown target", async () => {
    const admin = await account("super_admin");
    const person = await account("employee", "viewer");
    current.user = admin;
    expect(await setPayrollAccess({ userId: person.id, level: "viewer" })).toEqual({ ok: false, error: "No change." });
    expect(await setPayrollAccess({ userId: randomUUID(), level: "viewer" })).toEqual({ ok: false, error: "That person was not found." });

    await db.execute(sql`update core.users set archived_at = now() where id = ${person.id}`);
    expect(await setPayrollAccess({ userId: person.id, level: "approver" })).toEqual({ ok: false, error: "That person was not found." });
    expect(await levelOf(person.id)).toBe("viewer");
  });

  it("notifies the other Super Admins and the chosen person, not the actor, with no amounts", async () => {
    const admin = await account("super_admin");
    const otherAdmin = await account("super_admin");
    const person = await account("employee");
    current.user = admin;
    expect(await setPayrollAccess({ userId: person.id, level: "approver" })).toEqual({ ok: true, data: undefined });

    expect(await notesFor(admin.id)).toHaveLength(0);
    const [forAdmin] = await notesFor(otherAdmin.id);
    expect(forAdmin.link).toBe("/settings/payroll-access");
    const [forPerson] = await notesFor(person.id);
    expect(forPerson.link).toBe("/payroll");
    for (const n of [forAdmin, forPerson]) expect(`${n.title} ${n.body ?? ""}`).not.toMatch(/\d/);

    // Taking it away tells the person too.
    expect(await setPayrollAccess({ userId: person.id, level: null })).toEqual({ ok: true, data: undefined });
    expect(await notesFor(person.id)).toHaveLength(2);
  });

  it("clearing the level means the next sign-in has no payroll access", async () => {
    const admin = await account("super_admin");
    const person = await account("employee", "preparer");
    current.user = admin;
    expect((await ensureCoreUser({ id: person.id, email: person.email })).payrollAccess).toBe("preparer");
    expect(await setPayrollAccess({ userId: person.id, level: null })).toEqual({ ok: true, data: undefined });

    const next = await ensureCoreUser({ id: person.id, email: person.email });
    expect(next.payrollAccess).toBeNull();
    await expect(authorize({ ...next }, "payroll.view")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists active people with their level and nothing else", async () => {
    const admin = await account("super_admin");
    const person = await account("employee", "viewer");
    current.user = admin;
    const list = await getPayrollAccessList();
    expect(list.find((r) => r.userId === person.id)).toEqual({ userId: person.id, name: person.email, email: person.email, level: "viewer" });
  });
});
