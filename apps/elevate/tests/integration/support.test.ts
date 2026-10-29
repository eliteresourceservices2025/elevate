import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for contact support: saved first, HR told, emailed with the person as reply-to, who sees what.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.30" }) }));

const { db } = await import("@/lib/db");
const { setEmailSender } = await import("@/modules/notifications/email");
const actions = await import("@/modules/support/actions");
const queries = await import("@/modules/support/queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

describe("contact support", () => {
  it("saves the request, tells HR, emails the support address with the person as reply-to, and shows it only to them and HR", async () => {
    const sent: { to: string; subject: string; text: string; replyTo?: string }[] = [];
    setEmailSender({ send: async (m) => void sent.push({ to: m.to, subject: m.subject, text: m.text, replyTo: m.replyTo }) });
    try {
      const hr = await makeUser("suphr", ["hr_admin", "employee"]);
      const ana = await makeUser("supana", ["employee"]);
      const ben = await makeUser("supben", ["employee"]);

      as(ana);
      const result = await actions.submitSupportRequest({ topic: "time_clock", subject: "Clock-in did not save", message: "I clocked in at 9 but the page showed an error.", page: "/attendance" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.emailed).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "elitehelpdesk@ersva.com", replyTo: ana.email });
      expect(sent[0].subject).toContain("Clock-in did not save");
      expect(sent[0].text).toContain("I clocked in at 9");

      // HR was told in the app; the person who asked was not
      expect(await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'support.new'`)).not.toHaveLength(0);
      expect(await rows(sql`select 1 from ops.notifications where user_id = ${ana.id} and kind = 'support.new'`)).toHaveLength(0);
      expect(await rows(sql`select 1 from ops.audit_log where action = 'support.request' and actor_user_id = ${ana.id}`)).toHaveLength(1);

      // The person sees their own; another person sees none of it; the inbox is for HR
      expect((await queries.listMySupportRequests()).map((r) => r.id)).toContain(result.data.id);
      as(ben);
      expect((await queries.listMySupportRequests()).map((r) => r.id)).not.toContain(result.data.id);
      await expect(queries.listSupportInbox()).rejects.toThrow();
      expect(await actions.closeSupportRequest({ id: result.data.id })).toEqual({ ok: false, error: "You do not have access to do that." });

      as(hr);
      const inbox = await queries.listSupportInbox();
      expect(inbox.find((r) => r.id === result.data.id)).toMatchObject({ status: "open", from: expect.stringContaining(ana.email) });
      expect((await actions.closeSupportRequest({ id: result.data.id })).ok).toBe(true);
      expect(await actions.closeSupportRequest({ id: result.data.id })).toEqual({ ok: false, error: "That request is already closed." });
      expect((await actions.closeSupportRequest({ id: result.data.id, reopen: true })).ok).toBe(true);
    } finally {
      setEmailSender(undefined);
    }
  });

  it("keeps the request when no email service is configured, and when sending fails", async () => {
    const ana = await makeUser("supnone", ["employee"]);
    as(ana);
    setEmailSender(null);
    const noEmail = await actions.submitSupportRequest({ topic: "other", subject: "A question", message: "How do I change my photo? I cannot find it." });
    expect(noEmail).toMatchObject({ ok: true, data: { emailed: false } });

    setEmailSender({ send: async () => { throw new Error("refused"); } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await actions.submitSupportRequest({ topic: "other", subject: "Another question", message: "Where do I find my documents folder?" });
    spy.mockRestore();
    setEmailSender(undefined);
    expect(failed).toMatchObject({ ok: true, data: { emailed: false } });
    expect((await queries.listMySupportRequests()).length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a malformed request without saving anything", async () => {
    const ana = await makeUser("supbad", ["employee"]);
    as(ana);
    const before = (await rows<{ n: number }>(sql`select count(*)::int as n from ops.support_requests`))[0].n;
    expect((await actions.submitSupportRequest({ topic: "other", subject: "x", message: "too short" })).ok).toBe(false);
    expect((await actions.submitSupportRequest({ topic: "other", subject: "Fine title", message: "A fine long message about my problem.", page: "https://evil.example" })).ok).toBe(false);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from ops.support_requests`))[0].n).toBe(before);
  });
});
