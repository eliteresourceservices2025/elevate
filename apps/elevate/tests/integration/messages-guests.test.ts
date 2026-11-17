import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for client guests (Phase 3): provisioning from a guest invitation, the no-roles guard, client groups, what a
// guest cannot do, and ending a guest's access.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.86" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { provisionCoreUser } = await import("@/modules/core/users");
const { ensureInvitation } = await import("@/modules/settings/invite");
const service = await import("@/modules/messages/service");
const guestService = await import("@/modules/messages/guests");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[]; isGuest?: boolean };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
// The throwaway test database has no Supabase auth schema; archiving a guest ends their sessions there.
await db.execute(sql`create schema if not exists auth`);
await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
const as = (u: Actor) => {
  current.user = u;
};
async function makeStaff(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email, roles: ["hr_admin"] };
}
async function makeClient(label: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into core.clients (id, name) values (${id}, ${uniq(label)})`);
  return id;
}
/** Invites by email as HR would, then runs the first sign-in set-up the way the app does. */
async function makeGuest(hr: Actor, clientId: string, label = "guest"): Promise<Actor> {
  const email = `${uniq(label)}@client.example`;
  await guestService.inviteGuest(hr, { email, clientId });
  const id = randomUUID();
  const user = await provisionCoreUser({ id, email });
  expect(user.isGuest).toBe(true);
  return { id, email, roles: [], isGuest: true };
}

describe("provisioning a guest from a guest invitation", () => {
  it("makes a guest with no roles (not even Employee), a guest row for the client, and marks the invitation accepted", async () => {
    const hr = await makeStaff("hr");
    const client = await makeClient("clinic");
    const email = `${uniq("g")}@client.example`;
    await guestService.inviteGuest(hr, { email, clientId: client });
    const id = randomUUID();
    const user = await provisionCoreUser({ id, email });
    expect(user).toMatchObject({ isGuest: true, roles: [], isSafevoiceHandler: false, payrollAccess: null });
    expect(await rows(sql`select 1 from core.user_roles where user_id = ${id}`)).toHaveLength(0);
    const guest = await rows<{ client_id: string; invited_by: string; notice_accepted_at: Date | null }>(sql`select client_id, invited_by, notice_accepted_at from chat.guests where user_id = ${id}`);
    expect(guest).toEqual([{ client_id: client, invited_by: hr.id, notice_accepted_at: null }]);
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${email} and accepted_at is not null`)).toHaveLength(1);
    // Running set-up again changes nothing.
    expect(await provisionCoreUser({ id, email })).toMatchObject({ isGuest: true, roles: [] });
    expect(await rows(sql`select 1 from core.user_roles where user_id = ${id}`)).toHaveLength(0);
  });

  it("a staff invitation still makes an Employee, never a guest", async () => {
    const hr = await makeStaff("hr");
    const email = `${uniq("s")}@example.com`;
    await db.transaction(async (tx) => void (await ensureInvitation(tx, hr, email)));
    const id = randomUUID();
    const user = await provisionCoreUser({ id, email });
    expect(user.isGuest).toBe(false);
    expect(user.roles).toContain("employee");
  });

  it("an expired guest invitation still never produces staff", async () => {
    const hr = await makeStaff("hr");
    const client = await makeClient("clinic");
    const email = `${uniq("g")}@client.example`;
    await guestService.inviteGuest(hr, { email, clientId: client });
    await db.execute(sql`update core.invitations set expires_at = now() - interval '1 day' where lower(email) = ${email}`);
    const user = await provisionCoreUser({ id: randomUUID(), email });
    expect(user.isGuest).toBe(true);
    expect(user.roles).toEqual([]);
  });
});

describe("database guards", () => {
  it("refuses to give a guest a role and to flip is_guest", async () => {
    const hr = await makeStaff("hr");
    const guest = await makeGuest(hr, await makeClient("clinic"));
    await expect(db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${guest.id}, 'employee')`)).rejects.toThrow();
    await expect(db.execute(sql`update core.users set is_guest = false where id = ${guest.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update core.users set is_guest = true where id = ${hr.id}`)).rejects.toThrow();
  });

  it("a guest invitation cannot carry roles or the Safe Voice flag", async () => {
    const client = await makeClient("clinic");
    await expect(db.execute(sql`insert into core.invitations (email, expires_at, roles, guest_client_id) values (${uniq("x") + "@c.example"}, now() + interval '1 day', array['hr_admin'], ${client})`)).rejects.toThrow();
  });
});

describe("inviting", () => {
  it("refuses an existing account, a staff invitation, and an inactive client; staff invites refuse a guest email", async () => {
    const hr = await makeStaff("hr");
    const client = await makeClient("clinic");
    await expect(guestService.inviteGuest(hr, { email: hr.email, clientId: client })).rejects.toThrow("already has an ELEVATE account");
    const staffEmail = `${uniq("s")}@example.com`;
    await db.transaction(async (tx) => void (await ensureInvitation(tx, hr, staffEmail)));
    await expect(guestService.inviteGuest(hr, { email: staffEmail, clientId: client })).rejects.toThrow("invited as ELEVATE staff");
    const inactive = await makeClient("old");
    await db.execute(sql`update core.clients set is_active = false where id = ${inactive}`);
    await expect(guestService.inviteGuest(hr, { email: `${uniq("n")}@c.example`, clientId: inactive })).rejects.toThrow("active client");
    const guestEmail = `${uniq("g")}@client.example`;
    await guestService.inviteGuest(hr, { email: guestEmail, clientId: client });
    await expect(db.transaction(async (tx) => void (await ensureInvitation(tx, hr, guestEmail)))).rejects.toThrow("client guest");
  });

  it("lists guests and waiting invitations", async () => {
    const hr = await makeStaff("hr");
    const client = await makeClient("clinic");
    const guest = await makeGuest(hr, client);
    const waiting = `${uniq("w")}@client.example`;
    await guestService.inviteGuest(hr, { email: waiting, clientId: client });
    const { guests, pending } = await guestService.listGuests();
    expect(guests.some((g) => g.userId === guest.id)).toBe(true);
    expect(pending.some((p) => p.email === waiting)).toBe(true);
  });
});

describe("client groups and what a guest can reach", () => {
  it("a client group takes that client's guests and staff, never another client's guest; plain groups and DMs refuse guests", async () => {
    const hr = await makeStaff("hr");
    const staff = await makeStaff("staff");
    const clientA = await makeClient("a");
    const clientB = await makeClient("b");
    const guestA = await makeGuest(hr, clientA);
    const guestB = await makeGuest(hr, clientB);

    await expect(guestService.createClientGroup(hr, { clientId: clientA, title: "Clinic A", guestUserIds: [guestB.id], staffUserIds: [staff.id] })).rejects.toThrow("can't be added");
    const { conversationId } = await guestService.createClientGroup(hr, { clientId: clientA, title: "Clinic A", guestUserIds: [guestA.id], staffUserIds: [staff.id] });
    const kind = await rows<{ kind: string; client_id: string }>(sql`select kind, client_id from chat.conversations where id = ${conversationId}`);
    expect(kind).toEqual([{ kind: "client", client_id: clientA }]);

    // The guest and staff talk.
    await guestService.acceptGuestNotice(guestA);
    await service.sendMessage(guestA, { conversationId, body: "Who is on at 9?" });
    await service.sendMessage(staff, { conversationId, body: "Ana is." });
    as(guestA);
    const seen = await queries.loadMessages({ conversationId });
    expect(seen.messages.map((m) => m.body)).toEqual(expect.arrayContaining(["Who is on at 9?", "Ana is."]));

    // Another client's guest cannot be added later; a staff member can.
    await expect(service.addMembers(hr, conversationId, [guestB.id])).rejects.toThrow("can't be added");
    const more = await makeStaff("more");
    await service.addMembers(hr, conversationId, [more.id]);

    // Guests do not belong in plain groups, and nobody can open a direct chat with a guest.
    const plain = await makeStaff("plain");
    await expect(service.createGroup(hr, { title: "Crew", memberUserIds: [staff.id, guestA.id] })).rejects.toThrow("can't be added");
    const { conversationId: crew } = await service.createGroup(hr, { title: "Crew", memberUserIds: [staff.id, plain.id] });
    await expect(service.addMembers(hr, crew, [guestA.id])).rejects.toThrow("can't be added");
    await expect(service.openDirect(staff, guestA.id)).rejects.toThrow();
    await expect(service.openDirect(guestA, staff.id)).rejects.toThrow("can't start a chat");
  });

  it("a guest sees only their own client chat, cannot search people, and nobody else's chat opens for them", async () => {
    const hr = await makeStaff("hr");
    const staff = await makeStaff("staff");
    const other = await makeStaff("other");
    const client = await makeClient("a");
    const guest = await makeGuest(hr, client);
    await guestService.acceptGuestNotice(guest);
    const { conversationId } = await guestService.createClientGroup(hr, { clientId: client, title: "Clinic", guestUserIds: [guest.id], staffUserIds: [staff.id] });
    const { conversationId: internal } = await service.createGroup(hr, { title: "Internal", memberUserIds: [staff.id, other.id] });
    await service.sendMessage(staff, { conversationId: internal, body: "internal only" });
    as(guest);
    const mine = await queries.listMyConversations();
    expect(mine.map((c) => c.id)).toEqual([conversationId]);
    await expect(queries.loadMessages({ conversationId: internal })).rejects.toThrow("not found");
    await expect(queries.searchChatPeople({ q: "a" })).rejects.toThrow("can't search");
    expect(await queries.searchMessages({ q: "internal" })).toEqual([]);
  });

  it("a guest can do nothing in Messages until they accept the notice", async () => {
    const hr = await makeStaff("hr");
    const guest = await makeGuest(hr, await makeClient("a"));
    await expect(guestService.assertGuestReady(guest)).rejects.toThrow("Accept the guest notice");
    as(guest);
    await expect(queries.listMyConversations()).rejects.toThrow("Accept the guest notice");
    await guestService.acceptGuestNotice(guest);
    await expect(guestService.assertGuestReady(guest)).resolves.toBeUndefined();
    expect(await queries.listMyConversations()).toEqual([]);
    // Accepting twice is harmless and audited once.
    await guestService.acceptGuestNotice(guest);
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'guest.notice_accepted' and target_id = ${guest.id}`);
    expect(audit).toHaveLength(1);
  });
});

describe("review fixes", () => {
  it("a guest can never be linked to a people record, in the app or the database, and is left out of channels", async () => {
    const hr = await makeStaff("hr");
    const guest = await makeGuest(hr, await makeClient("a"));
    await expect(db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('G', 'Guest', ${guest.email}, 'active', ${guest.id})`)).rejects.toThrow();
    const { accountsWithoutRecord } = await import("@/modules/people/duplicates-service");
    expect((await accountsWithoutRecord(db)).some((a) => a.userId === guest.id)).toBe(false);
    await expect(db.execute(sql`update core.users set payroll_access = 'viewer' where id = ${guest.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update core.users set is_privacy_officer = true where id = ${guest.id}`)).rejects.toThrow();
  });

  it("a guest's access ends when their client becomes inactive, and a listed Super Admin email cannot be invited", async () => {
    const hr = await makeStaff("hr");
    const client = await makeClient("a");
    const guest = await makeGuest(hr, client);
    await guestService.acceptGuestNotice(guest);
    await expect(guestService.assertGuestReady(guest)).resolves.toBeUndefined();
    await db.execute(sql`update core.clients set is_active = false where id = ${client}`);
    await expect(guestService.assertGuestReady(guest)).rejects.toThrow("Accept the guest notice");
    await expect(guestService.createClientGroup(hr, { clientId: client, title: "Old", guestUserIds: [guest.id], staffUserIds: [hr.id] })).rejects.toThrow();
    process.env.SUPER_ADMIN_EMAILS = "boss@example.com";
    try {
      await expect(guestService.inviteGuest(hr, { email: "Boss@Example.com", clientId: await makeClient("b") })).rejects.toThrow("can't be invited");
    } finally {
      delete process.env.SUPER_ADMIN_EMAILS;
    }
  });
});

describe("ending a guest's access", () => {
  it("archives the account, removes them from every chat, and they can read nothing afterwards", async () => {
    const hr = await makeStaff("hr");
    const staff = await makeStaff("staff");
    const client = await makeClient("a");
    const guest = await makeGuest(hr, client);
    await guestService.acceptGuestNotice(guest);
    const { conversationId } = await guestService.createClientGroup(hr, { clientId: client, title: "Clinic", guestUserIds: [guest.id], staffUserIds: [staff.id] });
    await service.sendMessage(staff, { conversationId, body: "hello" });
    await guestService.archiveGuest(hr, guest.id);
    expect(await rows(sql`select 1 from core.users where id = ${guest.id} and archived_at is not null`)).toHaveLength(1);
    expect(await rows(sql`select 1 from chat.conversation_members where user_id = ${guest.id} and left_at is null`)).toHaveLength(0);
    await expect(guestService.assertGuestReady(guest)).rejects.toThrow("Accept the guest notice");
    await expect(service.sendMessage(guest, { conversationId, body: "still here?" })).rejects.toThrow("not found");
    // The staff member still has the chat, and the guest cannot be archived twice.
    as(staff);
    expect((await queries.loadMessages({ conversationId })).messages.length).toBeGreaterThan(0);
    await expect(guestService.archiveGuest(hr, guest.id)).rejects.toThrow("not found");
    const audit = await rows(sql`select metadata from ops.audit_log where action = 'guest.archive' and target_id = ${guest.id}`);
    expect(audit).toHaveLength(1);
  });
});
