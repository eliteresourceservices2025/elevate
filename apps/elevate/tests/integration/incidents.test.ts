import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for privacy incident reports: filing, who is told (and with what), who may read, the handling rules (nobody
// handles their own report, closing needs a note, a closed report takes no messages), the Privacy Officer flag, and the triggers
// that keep a report from being rewritten or deleted.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.71" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/incidents/actions");
const queries = await import("@/modules/incidents/queries");
const { setEmailSender } = await import("@/modules/notifications/email");

type TestUser = { id: string; email: string; roles: RoleSlug[]; isPrivacyOfficer?: boolean };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const TODAY = new Date().toISOString().slice(0, 10);
const SECRET_TEXT = "ZEBRA-QUARTZ-9981 a sentence that must never reach a log, notice or email";

let hr: TestUser;
let hr2: TestUser;
let worker: TestUser;
let other: TestUser;
let officer: TestUser;
let clientId: string;
const sent: { to: string; text: string; subject: string }[] = [];

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

const report = async (u: TestUser, over: Record<string, unknown> = {}) => {
  as(u);
  const r = await actions.reportIncident({ kind: "wrong_recipient", happenedOn: TODAY, howFound: "A colleague told me", whatHappened: SECRET_TEXT, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  hr2 = await makeUser("hr2", ["hr_admin"]);
  worker = await makeUser("worker", ["employee"]);
  other = await makeUser("other", ["employee"]);
  officer = await makeUser("officer", ["employee"]);
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client")}) returning id`);
  clientId = c.id;
  setEmailSender({ send: async (m) => void sent.push({ to: m.to, text: m.text, subject: m.subject }) });
});

describe("filing a report", () => {
  it("saves it, tells HR and the Privacy Officer without the text, and audits without the text", async () => {
    as(hr);
    expect((await actions.setPrivacyOfficer({ email: officer.email, enabled: true })).ok).toBe(true);
    officer.isPrivacyOfficer = true;
    sent.length = 0;

    const { id, reference } = await report(worker, { clientId, ongoing: true });
    expect(reference).toMatch(/^PI-[0-9A-F]{8}$/);

    const [saved] = await rows<{ status: string; ongoing: boolean; client_id: string }>(sql`select status, ongoing, client_id from ops.privacy_incidents where id = ${id}`);
    expect(saved).toMatchObject({ status: "new", ongoing: true, client_id: clientId });

    // HR (both) and the officer are told in the app, the reporter is not.
    for (const person of [hr, hr2, officer]) {
      const n = await rows<{ title: string; body: string; link: string }>(sql`select title, body, link from ops.notifications where user_id = ${person.id} and kind = 'incident.new'`);
      expect(n.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(n)).not.toContain("ZEBRA-QUARTZ");
    }
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${worker.id} and kind = 'incident.new'`)).length).toBe(0);

    // Emails carry no details.
    expect(sent.length).toBeGreaterThanOrEqual(3);
    expect(sent.some((m) => m.to === officer.email)).toBe(true);
    expect(sent.every((m) => !m.text.includes("ZEBRA-QUARTZ") && !m.subject.includes("ZEBRA-QUARTZ"))).toBe(true);

    // The audit log names the kind, never the text.
    const audit = await rows<{ metadata: unknown; after: unknown }>(sql`select * from ops.audit_log where action = 'incident.report' and target_id = ${id}::text`);
    expect(audit.length).toBe(1);
    expect(JSON.stringify(audit)).not.toContain("ZEBRA-QUARTZ");
  });

  it("refuses a future date, an unknown client and a stranger's report id", async () => {
    as(worker);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const a = await actions.reportIncident({ kind: "other", happenedOn: future, howFound: "x y z", whatHappened: "A long enough sentence." });
    expect(a).toMatchObject({ ok: false });
    const b = await actions.reportIncident({ kind: "other", happenedOn: TODAY, howFound: "x y z", whatHappened: "A long enough sentence.", clientId: randomUUID() });
    expect(b).toMatchObject({ ok: false, error: "Choose a client from the list." });
  });
});

describe("who can read", () => {
  it("the reporter and the privacy team read it; anyone else gets nothing", async () => {
    const { id } = await report(worker);
    as(worker);
    expect((await queries.getIncident(id))?.isOwner).toBe(true);
    expect((await queries.getIncident(id))?.from).toBeNull();
    as(other);
    expect(await queries.getIncident(id)).toBeNull();
    as(hr);
    const seen = await queries.getIncident(id);
    expect(seen?.isHandler).toBe(true);
    expect(seen?.from).toContain(worker.email);
    as(officer);
    expect((await queries.getIncident(id))?.isHandler).toBe(true);
    // The handler's reading is audited; the reporter's own is not.
    expect((await rows(sql`select 1 from ops.audit_log where action = 'incident.view' and target_id = ${id}`)).length).toBeGreaterThanOrEqual(2);
  });

  it("a team lead or executive does not see other people's reports, and the inbox is for the team only", async () => {
    const lead = await makeUser("lead", ["team_lead"]);
    const { id } = await report(worker);
    as(lead);
    expect(await queries.getIncident(id)).toBeNull();
    await expect(queries.listIncidentInbox({ page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
    as(worker);
    const mine = await queries.listMyIncidents();
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.from === null)).toBe(true);
  });
});

describe("handling", () => {
  it("nobody handles their own report; another person closes it with a note; a closed report takes no messages until reopened", async () => {
    const { id } = await report(hr);
    as(hr);
    expect(await actions.setIncidentStatus({ id, status: "in_review" })).toMatchObject({ ok: false, error: expect.stringContaining("Another person") });

    as(hr2);
    expect((await actions.setIncidentStatus({ id, status: "in_review" })).ok).toBe(true);
    expect(await actions.setIncidentStatus({ id, status: "closed" })).toMatchObject({ ok: false });
    expect((await actions.replyIncident({ id, body: "Can you tell me which client?" })).ok).toBe(true);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'incident.reply'`)).length).toBeGreaterThanOrEqual(1);

    expect((await actions.setIncidentStatus({ id, status: "closed", resolution: "Recalled the message and told the client." })).ok).toBe(true);
    expect((await actions.replyIncident({ id, body: "One more thing" })).ok).toBe(false);
    expect((await actions.setIncidentStatus({ id, status: "in_review" })).ok).toBe(true);
    expect((await actions.replyIncident({ id, body: "Now it works" })).ok).toBe(true);

    // The reporter sees the status but not the resolution note.
    as(hr);
    const asReporter = await queries.getIncident(id);
    expect(asReporter?.messages.length).toBe(2);
  });

  it("a reporter replies on their own report only, and the privacy team is told", async () => {
    const { id } = await report(worker);
    as(other);
    expect(await actions.replyIncident({ id, body: "I should not be able to write here" })).toMatchObject({ ok: false, error: "That report was not found." });
    as(worker);
    expect((await actions.replyIncident({ id, body: "More detail: it was on Monday." })).ok).toBe(true);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${hr2.id} and kind = 'incident.reply' and link = ${`/incidents/${id}`}`)).length).toBe(1);
    // The reporter does not see the resolution note.
    as(hr2);
    await actions.setIncidentStatus({ id, status: "closed", resolution: "Handled quietly with the client." });
    as(worker);
    expect((await queries.getIncident(id))?.resolution).toBeNull();
  });
});

describe("the Privacy Officer flag", () => {
  it("only HR and Super Admin name an officer; naming needs an active account", async () => {
    as(worker);
    expect(await actions.setPrivacyOfficer({ email: other.email, enabled: true })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect(await actions.setPrivacyOfficer({ email: `nobody-${uniq("x")}@example.com`, enabled: true })).toMatchObject({ ok: false, error: "No active account has that email." });
    expect((await queries.listPrivacyOfficers()).some((o) => o.email === officer.email)).toBe(true);
    expect((await actions.setPrivacyOfficer({ email: officer.email, enabled: false })).ok).toBe(true);
    officer.isPrivacyOfficer = false;
    as(officer);
    await expect(queries.listIncidentInbox({ page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
    // put it back for any later test
    as(hr);
    await actions.setPrivacyOfficer({ email: officer.email, enabled: true });
    officer.isPrivacyOfficer = true;
  });
});

describe("database guards", () => {
  it("refuses rewriting a report, deleting it, and changing or deleting a message", async () => {
    const { id } = await report(worker);
    await expect(db.execute(sql`update ops.privacy_incidents set what_happened = 'rewritten' where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update ops.privacy_incidents set reporter_user_id = ${other.id} where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from ops.privacy_incidents where id = ${id}`)).rejects.toThrow();
    // handling fields may move
    await db.execute(sql`update ops.privacy_incidents set status = 'in_review', updated_at = now() where id = ${id}`);

    as(worker);
    await actions.replyIncident({ id, body: "A follow-up note" });
    await expect(db.execute(sql`update ops.privacy_incident_messages set body = 'x' where incident_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from ops.privacy_incident_messages where incident_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`truncate ops.privacy_incident_messages`)).rejects.toThrow();
  });
});
