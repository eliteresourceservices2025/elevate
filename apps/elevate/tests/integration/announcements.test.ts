import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { EXE_BYTES, FakeStorage, PDF_BYTES } from "./fake-storage";

// Real-database tests for announcements, policies, acknowledgments, reminders and the email queue (Phase 1.4).
// Email goes to an in-memory fake, storage to FakeStorage.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const queries = await import("@/modules/announcements/queries");
const jobs = await import("@/modules/announcements/jobs");
const docActions = await import("@/modules/documents/actions");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const digest = await import("@/modules/notifications/digest");
const emailQueue = await import("@/modules/notifications/email-queue");
const { setEmailSender } = await import("@/modules/notifications/email");
const notifActions = await import("@/modules/notifications/actions");
const { todayInZone } = await import("@/modules/org/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const today = todayInZone();
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

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

async function makeEmployee(label: string, opts: { userId?: string; teamId?: string; managerId?: string; status?: string } = {}) {
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, team_id, manager_id)
    values (${label}, ${n}, ${n + "@example.com"}, ${opts.status ?? "active"}, ${opts.userId ?? null}, ${opts.teamId ?? null}, ${opts.managerId ?? null}) returning id`);
  return e.id;
}

async function makeTeam(name: string) {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq(name)}) returning id`);
  return t.id;
}

/** A sign-in account with an active employee record. */
async function person(label: string, roles: RoleSlug[] = ["employee"], opts: { teamId?: string; managerId?: string } = {}) {
  const user = await makeUser(label, roles);
  const employeeId = await makeEmployee(label, { userId: user.id, ...opts });
  return { user, employeeId };
}

const post = async (actor: TestUser, extra: Record<string, unknown> = {}) => {
  as(actor);
  return actions.createAnnouncement({ title: uniq("Notice "), body: "Please read **carefully**.", audience: "all", teamIds: [], requiresAck: true, ...extra });
};
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};

let hr: TestUser;
let hrEmployeeId: string;
const fake = new FakeStorage();

beforeAll(async () => {
  setDocumentStorage(fake);
  ({ user: hr, employeeId: hrEmployeeId } = await person("hr", ["hr_admin", "employee"]));
  await db.execute(sql`delete from ops.email_queue`);
});
afterAll(() => setEmailSender(undefined));

describe("posting an announcement", () => {
  it("addresses everyone active except the poster, notifies them, and queues one acknowledgment email each", async () => {
    const a = await person("ann-a");
    const b = await person("ann-b");
    const gone = await person("ann-gone");
    await db.execute(sql`update core.employees set status = 'separated' where id = ${gone.employeeId}`);

    const id = idOf(await post(hr));
    const recipients = await rows<{ employee_id: string }>(sql`select employee_id from docs.announcement_recipients where announcement_id = ${id}`);
    const ids = new Set(recipients.map((r) => r.employee_id));
    expect(ids.has(a.employeeId)).toBe(true);
    expect(ids.has(b.employeeId)).toBe(true);
    expect(ids.has(gone.employeeId)).toBe(false); // separated people are not asked
    expect(ids.has(hrEmployeeId)).toBe(false); // the poster is not asked to acknowledge their own post

    const notes = await rows<{ kind: string; link: string }>(sql`select kind, link from ops.notifications where user_id = ${a.user.id} and link = ${`/announcements/${id}`}`);
    expect(notes).toEqual([{ kind: "announcement.ack_required", link: `/announcements/${id}` }]);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and link = ${`/announcements/${id}`}`)).toHaveLength(0);

    const mail = await rows<{ kind: string; priority: number; body: string }>(sql`select kind, priority, body from ops.email_queue where user_id = ${a.user.id}`);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ kind: "ack_due", priority: 1 });
    expect(mail[0].body).not.toContain("Notice"); // counts only: the title never goes into email

    const audit = await rows(sql`select 1 from ops.audit_log where action = 'announcement.create' and target_id = ${id}`);
    expect(audit).toHaveLength(1);
  });

  it("addresses only the selected teams, and keeps it from people outside them", async () => {
    const team = await makeTeam("Support ");
    const other = await makeTeam("Billing ");
    const inTeam = await person("in-team", ["employee"], { teamId: team });
    const outside = await person("out-team", ["employee"], { teamId: other });

    const id = idOf(await post(hr, { audience: "teams", teamIds: [team] }));
    const recipients = (await rows<{ employee_id: string }>(sql`select employee_id from docs.announcement_recipients where announcement_id = ${id}`)).map((r) => r.employee_id);
    expect(recipients).toContain(inTeam.employeeId);
    expect(recipients).not.toContain(outside.employeeId);

    as(inTeam.user);
    expect((await queries.getAnnouncement(id))?.needsMyAck).toBe(true);
    expect((await queries.listAnnouncements()).some((x) => x.id === id)).toBe(true);

    as(outside.user);
    expect(await queries.getAnnouncement(id)).toBeNull(); // not shown at all
    expect((await queries.listAnnouncements()).some((x) => x.id === id)).toBe(false);

    as(hr);
    expect((await queries.getAnnouncement(id))?.teamNames).toHaveLength(1);
  });

  it("refuses bad input", async () => {
    as(hr);
    expect((await actions.createAnnouncement({ title: "Hi", body: "x", audience: "all" })).ok).toBe(false); // title too short
    expect((await actions.createAnnouncement({ title: "Valid title", body: "x", audience: "teams", teamIds: [] })).ok).toBe(false); // no teams
    const past = await actions.createAnnouncement({ title: "Valid title", body: "x", audience: "all", requiresAck: true, dueOn: addDays(today, -1) });
    expect(past).toEqual({ ok: false, error: "The due date has already passed." });
    const dueWithoutAck = await actions.createAnnouncement({ title: "Valid title", body: "x", audience: "all", requiresAck: false, dueOn: addDays(today, 5) });
    expect(dueWithoutAck.ok).toBe(false);
    const missingTeam = await actions.createAnnouncement({ title: "Valid title", body: "x", audience: "teams", teamIds: [randomUUID()] });
    expect(missingTeam).toEqual({ ok: false, error: "One of the teams was not found." });
  });

  it("only lets HR post", async () => {
    const employee = await makeUser("plain", ["employee"]);
    const lead = await makeUser("lead", ["team_lead"]);
    for (const u of [employee, lead]) expect(await post(u)).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("accepts only an everyone-readable company document as an attachment", async () => {
    const employee = await person("attach-owner");
    const typeRows = await rows<{ id: string; slug: string }>(sql`select id, slug from docs.document_types where slug in ('company_policy', 'contract')`);
    const typeId = (slug: string) => typeRows.find((t) => t.slug === slug)!.id;

    const upload = async (audience: "all_staff" | "hr_only") => {
      as(hr);
      const ticket = await docActions.requestUpload({ target: "company", typeId: typeId("company_policy"), title: uniq("Handbook "), audience, fileName: "h.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.length, acknowledged: true });
      if (!ticket.ok) throw new Error(ticket.error);
      fake.put(ticket.data.bucket, ticket.data.path, PDF_BYTES);
      const done = await docActions.finalizeUpload({ documentId: ticket.data.documentId });
      if (!done.ok) throw new Error(done.error);
      return ticket.data.documentId;
    };
    const everyone = await upload("all_staff");
    const hrOnly = await upload("hr_only");

    as(employee.user);
    const personal = await docActions.requestUpload({ target: "employee", employeeId: employee.employeeId, typeId: typeId("contract"), title: uniq("Mine "), fileName: "c.pdf", mimeType: "application/pdf", sizeBytes: PDF_BYTES.length, acknowledged: true });
    if (!personal.ok) throw new Error(personal.error);
    fake.put(personal.data.bucket, personal.data.path, PDF_BYTES);
    await docActions.finalizeUpload({ documentId: personal.data.documentId });

    expect(await post(hr, { attachmentDocumentId: hrOnly })).toEqual({ ok: false, error: "Choose a company document that everyone can read." });
    expect(await post(hr, { attachmentDocumentId: personal.data.documentId })).toEqual({ ok: false, error: "Choose a company document that everyone can read." });
    const ok = idOf(await post(hr, { attachmentDocumentId: everyone }));
    as(employee.user);
    expect((await queries.getAnnouncement(ok))?.attachment?.id).toBe(everyone);
    void EXE_BYTES;
  });
});

describe("acknowledging an announcement", () => {
  it("records once, refuses people it was not addressed to, and is permanent", async () => {
    const team = await makeTeam("Ack ");
    const addressed = await person("ack-one", ["employee"], { teamId: team });
    const notAddressed = await person("ack-two");
    const noProfile = await makeUser("no-profile", ["employee"]);
    const id = idOf(await post(hr, { audience: "teams", teamIds: [team] }));

    as(addressed.user);
    expect((await queries.listMyPending()).map((p) => p.id)).toContain(id);
    expect((await actions.acknowledge({ kind: "announcement", id })).ok).toBe(true);
    expect((await actions.acknowledge({ kind: "announcement", id })).ok).toBe(true); // again: no duplicate
    expect(await rows(sql`select 1 from docs.acknowledgments where user_id = ${addressed.user.id} and announcement_id = ${id}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'acknowledgment.create' and target_id = ${id}`)).toHaveLength(1);
    expect((await queries.listMyPending()).map((p) => p.id)).not.toContain(id);
    expect((await queries.getAnnouncement(id))?.acknowledgedAt).toBeInstanceOf(Date);

    as(notAddressed.user);
    expect(await actions.acknowledge({ kind: "announcement", id })).toEqual({ ok: false, error: "This announcement was not addressed to you." });
    as(noProfile);
    expect(await actions.acknowledge({ kind: "announcement", id })).toEqual({ ok: false, error: "Only people with an active ELEVATE profile can acknowledge." });

    // Evidence cannot be edited or removed, even directly in the database
    await expect(db.execute(sql`update docs.acknowledgments set acknowledged_at = now() where announcement_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.acknowledgments where announcement_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`truncate docs.acknowledgments`)).rejects.toThrow();
  });

  it("does not let you acknowledge something that does not require it, or is archived", async () => {
    const p = await person("ack-none");
    const plain = idOf(await post(hr, { requiresAck: false }));
    as(p.user);
    expect(await actions.acknowledge({ kind: "announcement", id: plain })).toEqual({ ok: false, error: "Nothing to acknowledge here." });

    const toArchive = idOf(await post(hr));
    as(hr);
    expect((await actions.archiveAnnouncement({ announcementId: toArchive })).ok).toBe(true);
    as(p.user);
    expect(await actions.acknowledge({ kind: "announcement", id: toArchive })).toEqual({ ok: false, error: "Nothing to acknowledge here." });
    expect(await queries.getAnnouncement(toArchive)).toBeNull();
    expect((await queries.listMyPending()).map((x) => x.id)).not.toContain(toArchive);
  });

  it("locks the text once someone acknowledged, but still allows the due date and pinning", async () => {
    const p = await person("lock");
    const id = idOf(await post(hr, { title: "Original title", dueOn: addDays(today, 10) }));
    as(p.user);
    await actions.acknowledge({ kind: "announcement", id });

    as(hr);
    const changed = await actions.updateAnnouncement({ announcementId: id, title: "New title", body: "Please read **carefully**.", pinned: false, dueOn: addDays(today, 10) });
    expect(changed.ok).toBe(false);
    const due = await actions.updateAnnouncement({ announcementId: id, title: "Original title", body: "Please read **carefully**.", pinned: true, dueOn: addDays(today, 20) });
    expect(due.ok).toBe(true);
    const [row] = await rows<{ pinned: boolean; due_on: string }>(sql`select pinned, due_on::text from docs.announcements where id = ${id}`);
    expect(row).toEqual({ pinned: true, due_on: addDays(today, 20) });
  });
});

describe("who has acknowledged", () => {
  it("shows HR everyone, a Team Lead only their downline, and nobody else", async () => {
    const lead = await person("lead", ["team_lead", "employee"]);
    const report = await person("report", ["employee"], { managerId: lead.employeeId });
    const grandReport = await person("grand", ["employee"], { managerId: report.employeeId });
    const stranger = await person("stranger");
    const noAccount = await makeEmployee("noacct", { managerId: lead.employeeId });

    const id = idOf(await post(hr));
    as(report.user);
    await actions.acknowledge({ kind: "announcement", id });

    as(hr);
    const all = await queries.getAckStatus({ kind: "announcement", id });
    expect(all.scope).toBe("all");
    const names = all.rows.map((r) => r.employeeId);
    for (const e of [report.employeeId, grandReport.employeeId, stranger.employeeId, noAccount]) expect(names).toContain(e);
    // Not acknowledged come first
    const firstDone = all.rows.findIndex((r) => r.acknowledgedAt);
    expect(all.rows.slice(0, firstDone).every((r) => !r.acknowledgedAt)).toBe(true);

    as(lead.user);
    const team = await queries.getAckStatus({ kind: "announcement", id });
    expect(team.scope).toBe("team");
    expect(team.rows.map((r) => r.employeeId).sort()).toEqual([report.employeeId, grandReport.employeeId, noAccount].sort());
    expect(team.rows.find((r) => r.employeeId === noAccount)?.hasAccount).toBe(false);
    expect(team.rows.find((r) => r.employeeId === report.employeeId)?.acknowledgedAt).toBeInstanceOf(Date);

    as(stranger.user);
    await expect(queries.getAckStatus({ kind: "announcement", id })).rejects.toThrow("Forbidden");
  });

  it("exports a CSV for HR only, audited, with spreadsheet formulas neutralised", async () => {
    const evil = await makeEmployee("=HYPERLINK(1)");
    const id = idOf(await post(hr));
    const lead = await makeUser("csv-lead", ["team_lead"]);
    as(lead);
    expect(await actions.exportAcknowledgments({ kind: "announcement", id })).toEqual({ ok: false, error: NO_ACCESS });

    as(hr);
    const result = await actions.exportAcknowledgments({ kind: "announcement", id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.csv.split("\r\n")[0]).toBe("Employee number,Name,Team,Has account,Status,Acknowledged at");
    expect(result.data.csv).toContain("'=HYPERLINK(1)");
    expect(result.data.fileName).toMatch(/^acknowledgments-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'acknowledgment.export' and target_id = ${id}`)).toHaveLength(1);
    void evil;
  });
});

describe("policies", () => {
  it("ships the privacy notice and monitoring policy as hidden drafts that cannot be published as-is", async () => {
    const seeded = await rows<{ slug: string; kind: string; status: string }>(sql`
      select p.slug, p.kind, v.status from docs.policies p join docs.policy_versions v on v.policy_id = p.id where p.kind in ('privacy_notice','monitoring') and v.version = 1 order by p.kind`);
    expect(seeded).toEqual([
      { slug: "monitoring_policy", kind: "monitoring", status: "draft" },
      { slug: "privacy_notice", kind: "privacy_notice", status: "draft" },
    ]);
    const [privacy] = await rows<{ id: string }>(sql`select id from docs.policies where slug = 'privacy_notice'`);

    const employee = await person("policy-reader");
    as(employee.user);
    expect(await queries.getPolicy(privacy.id)).toBeNull(); // hidden while a draft
    expect((await queries.listPolicies()).some((p) => p.id === privacy.id)).toBe(false);
    expect((await queries.listMyPending()).some((p) => p.id === privacy.id)).toBe(false);

    as(hr);
    expect((await queries.listPolicies()).find((p) => p.id === privacy.id)?.version).toBeNull();
    expect(await actions.publishDraft({ policyId: privacy.id })).toEqual({ ok: false, error: "Replace the placeholder text before publishing." });
  });

  it("drafts, publishes, freezes, and asks for re-acknowledgment on each new version", async () => {
    const early = await person("pol-early");
    as(hr);
    const created = await actions.createPolicy({ title: uniq("Code of conduct "), body: "Version one text.", requiresAck: true });
    const policyId = idOf(created);

    as(early.user);
    expect(await queries.getPolicy(policyId)).toBeNull(); // a draft is invisible

    as(hr);
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    const [v1] = await rows<{ id: string }>(sql`select id from docs.policy_versions where policy_id = ${policyId} and version = 1`);

    // Published text is frozen, even directly in the database
    await expect(db.execute(sql`update docs.policy_versions set body = 'changed' where id = ${v1.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.policy_versions where id = ${v1.id}`)).rejects.toThrow();

    // Everyone with an account was notified
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${early.user.id} and kind = 'policy.ack_required' and link = ${`/announcements/policies/${policyId}`}`)).toHaveLength(1);

    // Someone hired AFTER publishing is expected too
    const late = await person("pol-late");
    as(late.user);
    expect((await queries.listMyPending()).some((p) => p.versionId === v1.id)).toBe(true);
    expect((await actions.acknowledge({ kind: "policy_version", id: v1.id })).ok).toBe(true);

    as(early.user);
    expect((await actions.acknowledge({ kind: "policy_version", id: v1.id })).ok).toBe(true);

    // HR writes version 2: a draft starts from nothing published changing
    as(hr);
    expect((await actions.saveDraft({ policyId, body: "Version two text.", changeNote: "Added a section.", requiresAck: true })).ok).toBe(true);
    as(early.user);
    expect((await queries.getPolicy(policyId))?.current?.version).toBe(1); // still version one for readers
    as(hr);
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);

    // Version 1 acknowledgments do not count for version 2: pending again, for both
    for (const p of [early, late]) {
      as(p.user);
      const pending = await queries.listMyPending();
      const item = pending.find((x) => x.id === policyId);
      expect(item?.version).toBe(2);
      expect(item?.versionId).not.toBe(v1.id);
    }
    // Acknowledging the old version is refused
    as(early.user);
    expect(await actions.acknowledge({ kind: "policy_version", id: v1.id })).toEqual({ ok: false, error: "A newer version was published. Open the policy and acknowledge the current one." });
    const detail = await queries.getPolicy(policyId);
    expect(detail?.needsMyAck).toBe(true);
    expect((await actions.acknowledge({ kind: "policy_version", id: detail!.current!.id })).ok).toBe(true);

    // HR sees who acknowledged which version
    as(hr);
    const hrView = await queries.getPolicy(policyId);
    expect(hrView?.history.map((h) => [h.version, h.acknowledgedCount])).toEqual([[2, 1], [1, 2]]);
    const status = await queries.getAckStatus({ kind: "policy_version", id: hrView!.current!.id });
    expect(status.rows.find((r) => r.employeeId === early.employeeId)?.acknowledgedAt).toBeInstanceOf(Date);
    expect(status.rows.find((r) => r.employeeId === late.employeeId)?.acknowledgedAt).toBeNull();
  });

  it("keeps only one draft at a time, and will not discard a first version", async () => {
    as(hr);
    const policyId = idOf(await actions.createPolicy({ title: uniq("Dress code "), body: "First.", requiresAck: false }));
    expect(await actions.discardDraft({ policyId })).toEqual({ ok: false, error: "A policy needs a first version. Edit the draft instead." });
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    expect((await actions.saveDraft({ policyId, body: "Second.", requiresAck: false })).ok).toBe(true);
    expect((await actions.saveDraft({ policyId, body: "Second, edited.", requiresAck: false })).ok).toBe(true);
    const drafts = await rows(sql`select 1 from docs.policy_versions where policy_id = ${policyId} and status = 'draft'`);
    expect(drafts).toHaveLength(1);
    expect((await actions.discardDraft({ policyId })).ok).toBe(true);
    expect(await actions.publishDraft({ policyId })).toEqual({ ok: false, error: "There is no draft to publish." });
  });

  it("does not ask for acknowledgment when the version does not require it", async () => {
    const p = await person("pol-info");
    as(hr);
    const policyId = idOf(await actions.createPolicy({ title: uniq("FYI policy "), body: "Information only.", requiresAck: false }));
    await actions.publishDraft({ policyId });
    as(p.user);
    expect((await queries.listMyPending()).some((x) => x.id === policyId)).toBe(false);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${p.user.id} and kind = 'policy.published'`)).toHaveLength(1);
    const [v] = await rows<{ id: string }>(sql`select id from docs.policy_versions where policy_id = ${policyId}`);
    expect(await actions.acknowledge({ kind: "policy_version", id: v.id })).toEqual({ ok: false, error: "Nothing to acknowledge here." });
  });
});

describe("reminders", () => {
  it("reminds 3 days before the due date, once per day, and HR's button works once a day", async () => {
    const p = await person("remind-me");
    const done = await person("remind-done");
    const id = idOf(await post(hr, { dueOn: addDays(today, 3) }));
    as(done.user);
    await actions.acknowledge({ kind: "announcement", id });

    const remindersFor = (userId: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = 'announcement.ack_reminder'`);

    // Not a reminder day: nothing
    await jobs.runAckReminders(addDays(today, 1));
    expect(await remindersFor(p.user.id)).toHaveLength(0);

    const first = await jobs.runAckReminders(today); // due in 3 days
    expect(first.items).toBeGreaterThanOrEqual(1);
    expect(await remindersFor(p.user.id)).toHaveLength(1);
    expect(await remindersFor(done.user.id)).toHaveLength(0); // already acknowledged: not bothered

    await jobs.runAckReminders(today); // same day again
    expect(await remindersFor(p.user.id)).toHaveLength(1);

    // The due day itself, and a week overdue, are reminder days too
    await jobs.runAckReminders(addDays(today, 3));
    expect(await remindersFor(p.user.id)).toHaveLength(2);
    await jobs.runAckReminders(addDays(today, 10));
    expect(await remindersFor(p.user.id)).toHaveLength(3);

    // HR's manual reminder: once a day per item
    as(hr);
    const manual = await actions.sendReminder({ kind: "announcement", id });
    expect(manual.ok).toBe(true);
    expect(await actions.sendReminder({ kind: "announcement", id })).toEqual({ ok: false, error: "A reminder was already sent today for this item." });
    expect(await remindersFor(p.user.id)).toHaveLength(4);

    // Nothing to remind about: refused
    const allDone = idOf(await post(hr, { audience: "teams", teamIds: [await makeTeam("Empty ")] }));
    expect(await actions.sendReminder({ kind: "announcement", id: allDone })).toEqual({ ok: false, error: "Everyone with an account has already acknowledged this." });

    // Policy reminders work the same way
    const policyId = idOf(await actions.createPolicy({ title: uniq("Reminder policy "), body: "Read me.", requiresAck: true, dueOn: addDays(today, 3) }));
    await actions.publishDraft({ policyId });
    await jobs.runAckReminders(today);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${p.user.id} and kind = 'policy.ack_reminder' and link = ${`/announcements/policies/${policyId}`}`)).toHaveLength(1);
  });

  it("does not let reminders be sent for items that are closed", async () => {
    as(hr);
    const informational = idOf(await post(hr, { requiresAck: false }));
    expect(await actions.sendReminder({ kind: "announcement", id: informational })).toEqual({ ok: false, error: "That item is not open for acknowledgment." });
    const archived = idOf(await post(hr));
    await actions.archiveAnnouncement({ announcementId: archived });
    expect(await actions.sendReminder({ kind: "announcement", id: archived })).toEqual({ ok: false, error: "That item is not open for acknowledgment." });
  });
});

describe("email queue", () => {
  class FakeSender {
    sent: { to: string; subject: string; text: string; html: string }[] = [];
    failFor = new Set<string>();
    async send(mail: { to: string; subject: string; text: string; html: string }) {
      if (this.failFor.has(mail.to)) throw new Error("Email provider refused the message (HTTP 500)");
      this.sent.push(mail);
    }
  }

  it("waits when email is not configured, then sends acknowledgments before the digest within the budget", async () => {
    await db.execute(sql`delete from ops.email_queue`);
    const a = await person("mail-a");
    const b = await person("mail-b");
    const c = await person("mail-c");
    for (const p of [a, b, c]) await db.execute(sql`insert into ops.notifications (user_id, kind, title) values (${p.user.id}, 'announcement.posted', 'Secret title')`);

    await digest.runDailyDigest("2099-01-05");
    // c gets an acknowledgment to do, queued AFTER the digests, so the order must come from priority
    as(hr);
    const ann = idOf(await post(hr, { audience: "teams", teamIds: [await teamWith(c.employeeId)] }));
    expect(ann).toBeTruthy();

    setEmailSender(null);
    expect(await emailQueue.flushEmailQueue()).toMatchObject({ configured: false, sent: 0 });
    expect((await rows(sql`select 1 from ops.email_queue where status = 'queued'`)).length).toBeGreaterThan(0);

    const sender = new FakeSender();
    setEmailSender(sender);
    // Other test files may queue mail in the same table, so this checks what is ours, not the whole queue.
    process.env.EMAIL_DAILY_BUDGET = "0";
    try {
      expect((await emailQueue.flushEmailQueue()).sent).toBe(0); // no budget: nothing goes, whoever else queued
    } finally {
      delete process.env.EMAIL_DAILY_BUDGET;
    }
    process.env.EMAIL_DAILY_BUDGET = "1000";
    try {
      await emailQueue.flushEmailQueue();
    } finally {
      delete process.env.EMAIL_DAILY_BUDGET;
    }
    const mine = sender.sent.filter((m) => [a, b, c].some((p) => p.user.email === m.to));
    const ackAt = mine.findIndex((m) => m.to === c.user.email && / your acknowledgment in ELEVATE$/.test(m.subject));
    const digestAt = mine.flatMap((m, i) => (m.subject.includes("unread notification") ? [i] : []));
    expect(ackAt).toBeGreaterThanOrEqual(0);
    expect(digestAt.length).toBeGreaterThanOrEqual(2);
    expect(digestAt.every((i) => i > ackAt)).toBe(true); // acknowledgments go before digests
    const digestMail = mine.find((m) => m.to === a.user.email)!;
    expect(digestMail.subject).toBe("You have 1 unread notification in ELEVATE");
    expect(digestMail.text).not.toContain("Secret title"); // counts only
    expect(digestMail.text).toContain("/dashboard");
  });

  it("queues the digest once per person per day and respects opt-out and archived accounts", async () => {
    await db.execute(sql`delete from ops.email_queue`);
    const reader = await person("dig-reader");
    const optOut = await person("dig-optout");
    const quiet = await person("dig-quiet");
    const left = await person("dig-left");
    await db.execute(sql`update core.users set archived_at = now() where id = ${left.user.id}`);
    for (const p of [reader, optOut, left]) await db.execute(sql`insert into ops.notifications (user_id, kind, title) values (${p.user.id}, 'document.expiring', 'x')`);
    as(optOut.user);
    expect((await notifActions.setDigestOptOut({ optOut: true })).ok).toBe(true);

    await digest.runDailyDigest("2099-02-02");
    await digest.runDailyDigest("2099-02-02"); // same day again
    const queued = async (userId: string) => (await rows(sql`select 1 from ops.email_queue where user_id = ${userId} and kind = 'digest'`)).length;
    expect(await queued(reader.user.id)).toBe(1);
    expect(await queued(optOut.user.id)).toBe(0);
    expect(await queued(quiet.user.id)).toBe(0);
    expect(await queued(left.user.id)).toBe(0);

    // Turn it back on: tomorrow they get one
    as(optOut.user);
    await notifActions.setDigestOptOut({ optOut: false });
    await digest.runDailyDigest("2099-02-03");
    expect(await queued(optOut.user.id)).toBe(1);
  });

  it("retries a failed send up to three times, then gives up, and skips stale digests and archived accounts", async () => {
    await db.execute(sql`delete from ops.email_queue`);
    const flaky = await person("mail-flaky");
    const left = await person("mail-left");
    const stale = await person("mail-stale");
    const queueRow = (userId: string, kind: string, key: string, createdAt = "now()") =>
      db.execute(sql`insert into ops.email_queue (user_id, kind, priority, subject, body, link, dedupe_key, created_at)
        values (${userId}, ${kind}, ${kind === "ack_due" ? 1 : 2}, 'Subject', '{"heading":"H","lines":["L"]}', '/dashboard', ${key}, ${sql.raw(createdAt)})`);
    await queueRow(flaky.user.id, "ack_due", "k1");
    await queueRow(left.user.id, "ack_due", "k2");
    await queueRow(stale.user.id, "digest", "k3", "now() - interval '30 hours'");
    await db.execute(sql`update core.users set archived_at = now() where id = ${left.user.id}`);

    const sender = new FakeSender();
    sender.failFor.add(flaky.user.email);
    setEmailSender(sender);
    await emailQueue.flushEmailQueue();
    await emailQueue.flushEmailQueue();
    const third = await emailQueue.flushEmailQueue();
    expect(third.failed).toBe(1);
    const status = async (userId: string) => (await rows<{ status: string; attempts: number; last_error: string | null }>(sql`select status, attempts, last_error from ops.email_queue where user_id = ${userId}`))[0];
    expect(await status(flaky.user.id)).toEqual({ status: "failed", attempts: 3, last_error: "Email provider refused the message (HTTP 500)" });
    expect((await status(left.user.id)).status).toBe("skipped");
    expect((await status(stale.user.id)).status).toBe("skipped");
    expect(sender.sent).toHaveLength(0);

    // Queuing the same key twice does nothing
    expect(await emailQueue.queueEmails(db, [{ userId: flaky.user.id, kind: "digest", subject: "s", heading: "h", lines: [], link: "/dashboard", dedupeKey: "k9" }])).toBe(1);
    expect(await emailQueue.queueEmails(db, [{ userId: flaky.user.id, kind: "digest", subject: "s", heading: "h", lines: [], link: "/dashboard", dedupeKey: "k9" }])).toBe(0);
  });
});

/** A team containing just this employee, so an announcement to it is addressed to one person. */
async function teamWith(employeeId: string) {
  const team = await makeTeam("Solo ");
  await db.execute(sql`update core.employees set team_id = ${team} where id = ${employeeId}`);
  return team;
}

// Last on purpose: publishing the privacy notice is permanent in this database, and the earlier test
// about the seeded placeholder drafts must run first.
describe("privacy notice gate (first login)", () => {
  it("blocks nobody until real text is published, then until accepted, and again after a new version", async () => {
    const privacy = await import("@/modules/privacy/queries");
    const employee = await person("gate-emp");
    const admin = await makeUser("gate-admin", ["super_admin"]); // an account with no people record
    const [policy] = await rows<{ id: string }>(sql`select id from docs.policies where kind = 'privacy_notice'`);

    as(employee.user);
    expect(await privacy.getPrivacyGate()).toBeNull(); // only the placeholder draft exists

    as(hr);
    expect((await actions.saveDraft({ policyId: policy.id, body: "We keep your data safe.", requiresAck: false })).ok).toBe(true);
    expect((await actions.publishDraft({ policyId: policy.id })).ok).toBe(true);
    // The privacy notice always requires acceptance, even if HR left the box unticked
    const [published] = await rows<{ requires_ack: boolean; version: number }>(sql`select requires_ack, version from docs.policy_versions where policy_id = ${policy.id} and status = 'published'`);
    expect(published).toEqual({ requires_ack: true, version: 1 });

    as(employee.user);
    const gate = await privacy.getPrivacyGate();
    expect(gate).toMatchObject({ version: 1, updated: false, body: "We keep your data safe." });

    // Accepting records the acknowledgment and lifts the gate
    expect((await actions.acknowledge({ kind: "policy_version", id: gate!.versionId })).ok).toBe(true);
    expect(await privacy.getPrivacyGate()).toBeNull();

    // An account without a people record is gated too, and can accept
    as(admin);
    expect(await privacy.getPrivacyGate()).not.toBeNull();
    expect((await actions.acknowledge({ kind: "policy_version", id: gate!.versionId })).ok).toBe(true);
    expect(await privacy.getPrivacyGate()).toBeNull();
    // ...but that exception is only for the privacy notice
    expect(await actions.acknowledge({ kind: "policy_version", id: (await rows<{ id: string }>(sql`select id from docs.policy_versions where policy_id = ${policy.id}`))[0].id })).toMatchObject({ ok: true }); // again: no duplicate

    // A new version asks everyone again and says what changed
    as(hr);
    expect((await actions.saveDraft({ policyId: policy.id, body: "We keep your data safe. We also keep it in Singapore.", changeNote: "Added where data is stored.", requiresAck: true })).ok).toBe(true);
    expect((await actions.publishDraft({ policyId: policy.id })).ok).toBe(true);
    as(employee.user);
    const again = await privacy.getPrivacyGate();
    expect(again).toMatchObject({ version: 2, updated: true, changeNote: "Added where data is stored." });
    expect((await actions.acknowledge({ kind: "policy_version", id: again!.versionId })).ok).toBe(true);
    expect(await privacy.getPrivacyGate()).toBeNull();

    // The acceptance shows on the person's own data page
    const { data } = await privacy.getMyData();
    expect(data.acknowledgments.filter((a) => a.kind === "Policy").map((a) => a.version).sort()).toEqual([1, 2]);

    // The gate is UI-level only for the notice itself: other people's accounts are unaffected until they visit
    const other = await person("gate-other");
    as(other.user);
    expect(await privacy.getPrivacyGate()).not.toBeNull();

    // Archiving the policy removes the gate
    await db.execute(sql`update docs.policies set archived_at = now() where id = ${policy.id}`);
    expect(await privacy.getPrivacyGate()).toBeNull();
  });
});
