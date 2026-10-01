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
