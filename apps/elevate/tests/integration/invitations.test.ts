import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

// Real-database test: creating an invitation saves it and, when email is configured, emails the sign-up link. A missing or failing
// email service never loses the invitation.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { setEmailSender } = await import("@/modules/notifications/email");
const { createInvitation } = await import("@/modules/settings/actions");
const { listInvitations } = await import("@/modules/settings/queries");
const awaitedCore = await import("@/modules/core/users");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function admin(role: "super_admin" | "hr_admin") {
  const id = randomUUID();
  const email = `${uniq("adm")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role] };
}

afterAll(() => setEmailSender(undefined));

describe("invitation email", () => {
  it("saves the invitation and emails the sign-up link", async () => {
    current.user = await admin("hr_admin");
    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    setEmailSender({ send: async (m) => void sent.push(m) });
    const email = `${uniq("new")}@example.com`;
    const result = await createInvitation({ email });
    expect(result).toEqual({ ok: true, data: { emailed: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    expect(sent[0].subject).toBe("Your ELEVATE invitation");
    expect(sent[0].text).toContain("/signup");
    expect(sent[0].text).toContain("exact email address");
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${email}`)).toHaveLength(1);
  });

  it("keeps the invitation when email is not set up or the service refuses, and says so", async () => {
    current.user = await admin("super_admin");
    setEmailSender(null);
    const a = `${uniq("noemail")}@example.com`;
    expect(await createInvitation({ email: a })).toEqual({ ok: true, data: { emailed: false } });
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${a}`)).toHaveLength(1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    setEmailSender({ send: async () => { throw new Error("provider down"); } });
    const b = `${uniq("failing")}@example.com`;
    expect(await createInvitation({ email: b })).toEqual({ ok: true, data: { emailed: false } });
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${b}`)).toHaveLength(1);
  });

  it("refuses people without the invite permission, and sends nothing", async () => {
    const sent: unknown[] = [];
    setEmailSender({ send: async (m) => void sent.push(m) });
    const id = randomUUID();
    await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq("emp")}@example.com`})`);
    current.user = { id, email: "x@example.com", roles: ["employee"] };
    expect(await createInvitation({ email: `${uniq("blocked")}@example.com` })).toEqual({ ok: false, error: "You do not have access to do that." });
    expect(sent).toHaveLength(0);
  });
});

describe("roles and Safe Voice handler chosen in the invitation", () => {
  const { ensureCoreUser } = awaitedCore;
  const rolesOf = async (userId: string) => (await rows<{ role_slug: string }>(sql`select role_slug from core.user_roles where user_id = ${userId} order by role_slug`)).map((r) => r.role_slug);
  const handlerOf = async (userId: string) => (await rows<{ h: boolean }>(sql`select is_safevoice_handler as h from core.users where id = ${userId}`))[0].h;
  const signUp = (email: string) => ensureCoreUser({ id: randomUUID(), email });

  it("a Super Admin's choices are saved, shown only to a Super Admin, and applied once at first sign-in", async () => {
    setEmailSender(null);
    const sa = await admin("super_admin");
    const hr = await admin("hr_admin");
    const email = `${uniq("granted")}@example.com`;

    current.user = sa;
    expect(await createInvitation({ email, roles: ["hr_admin", "team_lead"], safevoiceHandler: true })).toEqual({ ok: true, data: { emailed: false } });
    const stored = (await rows<{ roles: string[]; is_safevoice_handler: boolean }>(sql`select roles, is_safevoice_handler from core.invitations where lower(email) = ${email}`))[0];
    expect(stored).toEqual({ roles: ["hr_admin", "team_lead"], is_safevoice_handler: true });

    // Only the Super Admin can read what was chosen; HR sees the invitation but not the roles or the handler flag
    expect((await listInvitations()).find((i) => i.email === email)).toMatchObject({ roles: ["hr_admin", "team_lead"], isSafevoiceHandler: true });
    current.user = hr;
    expect((await listInvitations()).find((i) => i.email === email)).toMatchObject({ roles: [], isSafevoiceHandler: false });

    // Nothing is granted before the person signs in
    expect(await rows(sql`select 1 from core.users where lower(email) = ${email}`)).toHaveLength(0);

    const account = await signUp(email);
    expect(account.roles.sort()).toEqual(["employee", "hr_admin", "team_lead"]);
    expect(account.isSafevoiceHandler).toBe(true);
    expect(await rolesOf(account.id)).toEqual(["employee", "hr_admin", "team_lead"]);
    expect(await handlerOf(account.id)).toBe(true);
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${email} and accepted_at is not null`)).toHaveLength(1);

    // The audit log says who chose it and what was applied, and a second request applies nothing again
    const audit = await rows<{ after: { roles: string[]; isSafevoiceHandler: boolean }; metadata: { invitedBy: string } }>(sql`select after, metadata from ops.audit_log where action = 'invitation.grants_applied' and target_id = ${account.id}`);
    expect(audit).toHaveLength(1);
    expect(audit[0].after.roles).toEqual(["employee", "hr_admin", "team_lead"]);
    expect(audit[0].metadata.invitedBy).toBe(sa.id);
    await ensureCoreUser({ id: account.id, email });
    expect(await rows(sql`select 1 from ops.audit_log where action = 'invitation.grants_applied' and target_id = ${account.id}`)).toHaveLength(1);
    expect(await rolesOf(account.id)).toEqual(["employee", "hr_admin", "team_lead"]);
  });

  it("HR can invite but only as Employee: asking for a role or the handler flag is refused and saves nothing", async () => {
    current.user = await admin("hr_admin");
    const a = `${uniq("hrrole")}@example.com`;
    const b = `${uniq("hrhandler")}@example.com`;
    expect(await createInvitation({ email: a, roles: ["super_admin"] })).toEqual({ ok: false, error: "You do not have access to do that." });
    expect(await createInvitation({ email: b, safevoiceHandler: true })).toEqual({ ok: false, error: "You do not have access to do that." });
    expect(await rows(sql`select 1 from core.invitations where lower(email) in (${a}, ${b})`)).toHaveLength(0);

    const plain = `${uniq("hrplain")}@example.com`;
    expect(await createInvitation({ email: plain })).toMatchObject({ ok: true });
    const account = await signUp(plain);
    expect(account.roles).toEqual(["employee"]);
    expect(account.isSafevoiceHandler).toBe(false);
  });

  it("a re-invite by HR keeps the Super Admin's choices; a Super Admin's new choice replaces them", async () => {
    setEmailSender(null);
    const email = `${uniq("reinvite")}@example.com`;
    current.user = await admin("super_admin");
    await createInvitation({ email, roles: ["recruiter"], safevoiceHandler: true });

    current.user = await admin("hr_admin");
    expect(await createInvitation({ email })).toMatchObject({ ok: true });
    expect((await rows<{ roles: string[]; h: boolean }>(sql`select roles, is_safevoice_handler as h from core.invitations where lower(email) = ${email}`))[0]).toEqual({ roles: ["recruiter"], h: true });

    current.user = await admin("super_admin");
    await createInvitation({ email, roles: [], safevoiceHandler: false });
    expect((await rows<{ roles: string[]; h: boolean }>(sql`select roles, is_safevoice_handler as h from core.invitations where lower(email) = ${email}`))[0]).toEqual({ roles: [], h: false });
  });

  it("an invitation that has run out grants nothing, and the database refuses an unknown role", async () => {
    setEmailSender(null);
    current.user = await admin("super_admin");
    const email = `${uniq("expired")}@example.com`;
    await createInvitation({ email, roles: ["executive"], safevoiceHandler: true });
    await db.execute(sql`update core.invitations set expires_at = now() - interval '1 day' where lower(email) = ${email}`);
    const account = await signUp(email);
    expect(account.roles).toEqual(["employee"]);
    expect(account.isSafevoiceHandler).toBe(false);

    await expect(db.execute(sql`insert into core.invitations (email, expires_at, roles) values (${`${uniq("bad")}@example.com`}, now() + interval '1 day', array['employee'])`)).rejects.toThrow();
    await expect(db.execute(sql`insert into core.invitations (email, expires_at, roles) values (${`${uniq("bad2")}@example.com`}, now() + interval '1 day', array['root'])`)).rejects.toThrow();
  });
});
