import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, EXE_BYTES, PDF_BYTES } from "./fake-storage";

// Real-database tests for recruiting (Phase 3.1): the public application, the pipeline and its history, who may see which
// opening, interviews and scorecard visibility, applicant emails, and the retention job.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.20" }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const { setEmailSender } = await import("@/modules/notifications/email");
const actions = await import("@/modules/recruiting/actions");
const queries = await import("@/modules/recruiting/queries");
const service = await import("@/modules/recruiting/service");
const jobs = await import("@/modules/recruiting/jobs");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};
const forbidden = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.name);

const fake = new FakeStorage();
const DOCX_BYTES = (() => {
  const enc = new TextEncoder();
  const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const body = enc.encode("[Content_Types].xml word/document.xml");
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
})();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

let recruiter: TestUser;
let hr: TestUser;
let lead: TestUser;
let otherLead: TestUser;
let exec: TestUser;
let employee: TestUser;

async function openJob(title = uniq("VA ")) {
  as(recruiter);
  const id = idOf(await actions.saveOpening({ title, description: "Support our clients with scheduling and inbox care.", hiringTeamUserIds: [lead.id] }));
  const status = await actions.setOpeningStatus({ id, status: "open" });
  if (!status.ok) throw new Error(status.error);
  return id;
}

const apply = (openingId: string, over: Record<string, unknown> = {}, file: { bytes: Uint8Array; name: string } | null = { bytes: PDF_BYTES, name: "cv.pdf" }) =>
  service.submitApplication({ openingId, fullName: "Ana Reyes", email: `${uniq("ana")}@example.com`, consent: true, website: "", ...over }, file);

const appFor = async (openingId: string, email: string) => {
  const [r] = await rows<{ id: string }>(sql`select a.id from talent.applications a join talent.candidates c on c.id = a.candidate_id where a.opening_id = ${openingId} and lower(c.email) = ${email.toLowerCase()}`);
  return r?.id;
};

beforeAll(async () => {
  setDocumentStorage(fake);
  recruiter = await makeUser("rec", ["recruiter", "employee"]);
  hr = await makeUser("hr", ["hr_admin", "employee"]);
  lead = await makeUser("lead", ["team_lead", "employee"]);
  otherLead = await makeUser("lead2", ["team_lead", "employee"]);
  exec = await makeUser("exec", ["executive", "employee"]);
  employee = await makeUser("emp", ["employee"]);
});
afterAll(() => setEmailSender(undefined));

describe("the public application", () => {
  it("stores the candidate, the application, its first history row and the resume, queues the received email and tells the hiring team", async () => {
    const opening = await openJob();
    const email = `${uniq("first")}@example.com`;
    expect(await apply(opening, { email, phone: "0917 000 0000", note: "Excited!" })).toEqual({ ok: true });

    const [c] = await rows<{ resume_path: string; resume_kind: string; resume_sha256: string; consent_at: Date }>(sql`select resume_path, resume_kind, resume_sha256, consent_at from talent.candidates where lower(email) = ${email}`);
    expect(c.resume_kind).toBe("pdf");
    expect(c.resume_sha256).toHaveLength(64);
    expect(fake.objects.has(fake.key("recruiting-docs", c.resume_path))).toBe(true);
    const appId = await appFor(opening, email);
    expect(appId).toBeTruthy();
    const history = await rows<{ to_stage: string; by_user_id: string | null }>(sql`select to_stage, by_user_id from talent.application_stage_history where application_id = ${appId}`);
    expect(history).toEqual([{ to_stage: "applied", by_user_id: null }]);
    const mail = await rows<{ kind: string; to_email: string }>(sql`select kind, to_email from talent.candidate_emails where application_id = ${appId}`);
    expect(mail).toEqual([{ kind: "received", to_email: email }]);
    const notes = await rows(sql`select 1 from ops.notifications where user_id = ${lead.id} and kind = 'recruiting.new_application'`);
    expect(notes.length).toBeGreaterThan(0);
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'recruiting.apply' and target_id = ${appId}`);
    expect(audit).toHaveLength(1);
  });

  it("accepts a DOCX and refuses an executable, an oversized file, a missing file and a missing consent", async () => {
    const opening = await openJob();
    expect(await apply(opening, {}, { bytes: DOCX_BYTES, name: "cv.docx" })).toEqual({ ok: true });
    expect(await apply(opening, {}, { bytes: EXE_BYTES, name: "cv.pdf" })).toMatchObject({ ok: false, field: "resume" });
    expect(await apply(opening, {}, { bytes: new Uint8Array(4 * 1024 * 1024 + 1).fill(0x25), name: "cv.pdf" })).toMatchObject({ ok: false, field: "resume" });
    expect(await apply(opening, {}, null)).toMatchObject({ ok: false, field: "resume" });
    expect(await apply(opening, { consent: false })).toMatchObject({ ok: false, field: "consent" });
  });

  it("looks the same to the applicant when they apply twice, and adds nothing", async () => {
    const opening = await openJob();
    const email = `${uniq("twice")}@example.com`;
    expect(await apply(opening, { email })).toEqual({ ok: true });
    const before = fake.objects.size;
    expect(await apply(opening, { email: email.toUpperCase() })).toEqual({ ok: true });
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from talent.applications a join talent.candidates c on c.id = a.candidate_id where lower(c.email) = ${email}`);
    expect(n.n).toBe(1);
    expect(fake.objects.size).toBe(before); // the second file was thrown away
  });

  it("ignores a filled honeypot without telling the bot", async () => {
    const opening = await openJob();
    const email = `${uniq("bot")}@example.com`;
    expect(await apply(opening, { email, website: "http://spam.example" })).toEqual({ ok: true });
    expect(await appFor(opening, email)).toBeUndefined();
  });

  it("refuses draft and closed jobs, and reuses the candidate with the newest resume for a second job", async () => {
    as(recruiter);
    const draft = idOf(await actions.saveOpening({ title: uniq("Draft "), description: "A job that is not published yet, so no one can apply." }));
    expect(await apply(draft)).toMatchObject({ ok: false });

    const a = await openJob();
    const b = await openJob();
    const email = `${uniq("both")}@example.com`;
    await apply(a, { email });
    const [first] = await rows<{ id: string; resume_path: string }>(sql`select id, resume_path from talent.candidates where lower(email) = ${email}`);
    await apply(b, { email }, { bytes: DOCX_BYTES, name: "new.docx" });
    const people = await rows<{ id: string; resume_path: string; resume_kind: string }>(sql`select id, resume_path, resume_kind from talent.candidates where lower(email) = ${email}`);
    expect(people).toHaveLength(1);
    expect(people[0].id).toBe(first.id);
    expect(people[0].resume_kind).toBe("docx");
    expect(fake.objects.has(fake.key("recruiting-docs", first.resume_path))).toBe(false); // the old file is gone

    as(recruiter);
    await actions.setOpeningStatus({ id: b, status: "closed" });
    expect(await apply(b, { email: `${uniq("late")}@example.com` })).toMatchObject({ ok: false });
  });

  it("lists only open jobs publicly, with no hiring detail", async () => {
    const open = await openJob("Public listed job");
    as(recruiter);
    const hidden = idOf(await actions.saveOpening({ title: "Hidden draft job", description: "Nobody outside should ever see this draft." }));
    const list = await queries.listPublicOpenings();
    expect(list.some((o) => o.id === open)).toBe(true);
    expect(list.some((o) => o.id === hidden)).toBe(false);
    expect(await queries.getPublicOpening(hidden)).toBeNull();
    expect(await queries.getPublicOpening("not-an-id")).toBeNull();
    expect(Object.keys(list[0])).not.toContain("createdBy");
  });
});

describe("readable addresses and the careers page", () => {
  it("gives each job a readable address, numbers repeats, resolves the old id link, and only changes it while a draft", async () => {
    as(recruiter);
    const title = `Medical Billing Assistant ${uniq("")}`;
    const a = idOf(await actions.saveOpening({ title, description: "Support our clients with billing questions every day." }));
    const b = idOf(await actions.saveOpening({ title, description: "A second opening with exactly the same title as the first." }));
    const slugOf = async (id: string) => (await rows<{ slug: string }>(sql`select slug from talent.job_openings where id = ${id}`))[0].slug;
    const first = await slugOf(a);
    expect(first).toMatch(/^medical-billing-assistant-[a-z0-9]+$/);
    expect(await slugOf(b)).toBe(`${first}-2`);

    // Open it: the public page finds it by the address and by the old id.
    expect((await actions.setOpeningStatus({ id: a, status: "open" })).ok).toBe(true);
    const byAddress = await queries.getPublicOpening(first.toUpperCase());
    expect(byAddress?.id).toBe(a);
    const byId = await queries.getPublicOpening(a);
    expect(byId).toMatchObject({ id: a, slug: first });
    expect(await queries.getPublicOpening("../../etc")).toBeNull();
    expect(await queries.getPublicOpening("no-such-job")).toBeNull();
    expect((await queries.listPublicOpenings()).find((o) => o.id === a)?.slug).toBe(first);

    // The address can be set while a draft (and must be free and well formed), not once the job has been opened.
    const base = { title, description: "Support our clients with billing questions every day." };
    expect((await actions.saveOpening({ ...base, id: b, slug: first })).ok).toBe(false); // taken by the first job
    expect((await actions.saveOpening({ ...base, id: b, slug: "Not Valid!" })).ok).toBe(false);
    const wanted = `billing-help-${uniq("")}`;
    expect((await actions.saveOpening({ ...base, id: b, slug: wanted })).ok).toBe(true);
    expect(await slugOf(b)).toBe(wanted);
    expect(await actions.saveOpening({ ...base, id: a, slug: `other-${uniq("")}` })).toEqual({ ok: false, error: "The web address can only be changed while the job is a draft." });
    // Saving an open job without touching the address keeps it.
    expect((await actions.saveOpening({ ...base, id: a, slug: first })).ok).toBe(true);
    expect(await slugOf(a)).toBe(first);
  });

  it("saves the careers page wording and banner (cleaned, wide only), served publicly, and only for HR and recruiters", async () => {
    const banner = await import("@/modules/recruiting/careers-banner");
    setDocumentStorage(fake);
    const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
    const jpeg = (w: number, h: number) =>
      new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...Buffer.from("Exif\0\0GPS-secret-location")]), ...seg(0xdb, [0, ...new Array<number>(64).fill(8)]), ...seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);

    as(recruiter);
    expect(await actions.saveCareersPage({ title: "Join our team", intro: "We are **hiring**." })).toEqual({ ok: true, data: undefined });
    expect(await queries.getCareersPage()).toMatchObject({ title: "Join our team", intro: "We are **hiring**.", bannerVersion: null });
    // Blank goes back to the built-in wording
    expect((await actions.saveCareersPage({ title: "", intro: "" })).ok).toBe(true);
    expect(await queries.getCareersPage()).toMatchObject({ title: null, intro: null });

    // A wide picture is cleaned and stored; a square one is refused
    expect(await banner.saveBanner(recruiter as never, jpeg(1600, 400))).toEqual({ ok: true });
    const page = await queries.getCareersPage();
    expect(page.bannerVersion).not.toBeNull();
    const served = await banner.readBanner();
    expect(served).not.toBeNull();
    expect(Buffer.from(served!).includes(Buffer.from("GPS-secret-location"))).toBe(false);
    expect((await banner.saveBanner(recruiter as never, jpeg(400, 400))).ok).toBe(false);
    expect((await banner.saveBanner(recruiter as never, new TextEncoder().encode("%PDF-1.4 not a picture"))).ok).toBe(false);
    expect((await actions.removeCareersBanner()).ok).toBe(true);
    expect(await banner.readBanner()).toBeNull();

    // Others cannot change the page
    for (const u of [lead, exec, employee]) {
      as(u);
      expect(await actions.saveCareersPage({ title: "No", intro: "No" })).toEqual({ ok: false, error: NO_ACCESS });
      await expect(banner.saveBanner(u as never, jpeg(1600, 400))).rejects.toThrow();
    }
  });
});

describe("the pipeline", () => {
  it("moves, closes and reopens an application, keeping every step in an append-only history", async () => {
    const opening = await openJob();
    const email = `${uniq("flow")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;

    as(recruiter);
    expect((await actions.moveApplication({ applicationId: appId, to: "screening", note: "Phone first" })).ok).toBe(true);
    expect((await actions.moveApplication({ applicationId: appId, to: "screening" })).ok).toBe(false);
    expect((await actions.rejectApplication({ applicationId: appId, reason: "Not enough experience", notifyCandidate: true })).ok).toBe(true);
    const [closed] = await rows<{ stage: string; close_kind: string; closed_at: Date | null }>(sql`select stage, close_kind, closed_at from talent.applications where id = ${appId}`);
    expect(closed).toMatchObject({ stage: "rejected", close_kind: "rejected" });
    expect(closed.closed_at).not.toBeNull();
    expect(await rows(sql`select 1 from talent.candidate_emails where application_id = ${appId} and kind = 'rejection'`)).toHaveLength(1);

    expect((await actions.moveApplication({ applicationId: appId, to: "hired" })).ok).toBe(false); // reopen first
    expect((await actions.moveApplication({ applicationId: appId, to: "interview" })).ok).toBe(true);
    const [reopened] = await rows<{ stage: string; close_kind: string | null; closed_at: Date | null }>(sql`select stage, close_kind, closed_at from talent.applications where id = ${appId}`);
    expect(reopened).toEqual({ stage: "interview", close_kind: null, closed_at: null });
    expect((await actions.moveApplication({ applicationId: appId, to: "hired" })).ok).toBe(true);
    expect((await actions.moveApplication({ applicationId: appId, to: "offer" })).ok).toBe(false); // a hire is final

    const history = await rows<{ to_stage: string }>(sql`select to_stage from talent.application_stage_history where application_id = ${appId} order by at, id`);
    expect(history.map((h) => h.to_stage)).toEqual(["applied", "screening", "rejected", "interview", "hired"]);
    await expect(db.execute(sql`update talent.application_stage_history set note = 'x' where application_id = ${appId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from talent.application_stage_history where application_id = ${appId}`)).rejects.toThrow();
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.move' and target_id = ${appId}`)).toHaveLength(3); // the close is audited as recruiting.reject
  });

  it("does not email a rejection unless the recruiter chose to and the job allows it", async () => {
    const opening = await openJob();
    const email = `${uniq("quiet")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    as(recruiter);
    await actions.rejectApplication({ applicationId: appId, reason: "Position filled", notifyCandidate: false });
    expect(await rows(sql`select 1 from talent.candidate_emails where application_id = ${appId} and kind = 'rejection'`)).toHaveLength(0);
  });

  it("refuses everyone but recruiters, HR and Super Admin for moves; lets a lead only look", async () => {
    const opening = await openJob();
    const email = `${uniq("who")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    for (const u of [lead, exec, employee]) {
      as(u);
      expect(await actions.moveApplication({ applicationId: appId, to: "screening" })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await actions.moveApplication({ applicationId: appId, to: "screening" })).ok).toBe(true);
  });
});

describe("who can see which opening", () => {
  it("shows a team lead only the jobs they are on the hiring team for", async () => {
    const mine = await openJob();
    as(recruiter);
    const notMine = idOf(await actions.saveOpening({ title: uniq("Other "), description: "A job the lead is not on the hiring team for at all." }));
    const email = `${uniq("scope")}@example.com`;
    await apply(mine, { email });
    const appId = (await appFor(mine, email))!;

    as(lead);
    const list = await queries.listOpenings();
    expect(list.scope).toBe("team");
    expect(list.rows.some((r) => r.id === mine)).toBe(true);
    expect(list.rows.some((r) => r.id === notMine)).toBe(false);
    expect((await queries.getOpeningBoard(mine)).opening.id).toBe(mine);
    expect(await forbidden(queries.getOpeningBoard(notMine))).toBe("ForbiddenError");
    expect((await queries.getApplication(appId)).application.id).toBe(appId);
    expect((await actions.getResumeLink({ applicationId: appId })).ok).toBe(true);
    expect((await actions.addNote({ applicationId: appId, body: "Looks strong." })).ok).toBe(true);

    as(otherLead);
    expect(await forbidden(queries.getOpeningBoard(mine))).toBe("ForbiddenError");
    expect(await forbidden(queries.getApplication(appId))).toBe("ForbiddenError");
    expect(await actions.getResumeLink({ applicationId: appId })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.addNote({ applicationId: appId, body: "Nope" })).toEqual({ ok: false, error: NO_ACCESS });

    as(exec);
    expect(await forbidden(queries.listOpenings())).toBe("ForbiddenError");
    expect((await queries.getRecruitingSummary()).openJobs).toBeGreaterThan(0);
    as(employee);
    expect(await forbidden(queries.getRecruitingSummary())).toBe("ForbiddenError");
  });

  it("audits every resume view and signs the link for 60 seconds", async () => {
    const opening = await openJob();
    const email = `${uniq("cv")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    as(hr);
    const link = await actions.getResumeLink({ applicationId: appId });
    expect(link.ok && link.data.url).toContain("expires=60");
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.resume_view' and target_id = ${appId}`)).toHaveLength(1);
  });

  it("shows a PDF resume in the page for the hiring team and HR only, audited, and refuses a Word file and an outsider", async () => {
    const { openResume } = await import("@/modules/recruiting/resume");
    const opening = await openJob();
    const email = `${uniq("inline")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    const asActor = (u: TestUser) => ({ id: u.id, email: u.email, roles: u.roles });
    const pdf = await openResume(asActor(hr), appId);
    expect(pdf.kind).toBe("pdf");
    expect(pdf.bytes.length).toBeGreaterThan(8);
    expect((await openResume(asActor(lead), appId)).kind).toBe("pdf"); // on the hiring team
    await expect(openResume(asActor(otherLead), appId)).rejects.toThrow("Forbidden");
    await expect(openResume(asActor(employee), appId)).rejects.toThrow("Forbidden");
    expect((await rows(sql`select 1 from ops.audit_log where action = 'recruiting.resume_view' and target_id = ${appId} and metadata->>'inline' = 'true'`)).length).toBe(2);

    const docx = `${uniq("word")}@example.com`;
    await apply(opening, { email: docx }, { bytes: DOCX_BYTES, name: "cv.docx" });
    expect((await openResume(asActor(hr), (await appFor(opening, docx))!)).kind).toBe("docx"); // the route shows only PDFs; this one is a download
  });

  it("only lets HR and recruiters set up jobs, and only leads and recruiters on a hiring team", async () => {
    as(lead);
    expect(await actions.saveOpening({ title: "Nope nope", description: "A lead cannot create jobs, only help hire for them." })).toEqual({ ok: false, error: NO_ACCESS });
    as(recruiter);
    const result = await actions.saveOpening({ title: uniq("Bad team "), description: "A hiring team may not include an ordinary employee.", hiringTeamUserIds: [employee.id] });
    expect(result.ok).toBe(false);
  });
});

describe("interviews and scorecards", () => {
  async function interviewSetup() {
    const opening = await openJob();
    const email = `${uniq("iv")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    as(recruiter);
    const when = new Date(Date.now() + 3_600_000);
    const ivId = idOf(await actions.scheduleInterview({ applicationId: appId, startsAt: when.toISOString(), minutes: 45, location: "https://meet.example.com/abc", interviewerUserIds: [lead.id, recruiter.id], emailCandidate: true }));
    // Move the start into the past so scorecards can be filled in.
    await db.execute(sql`update talent.interviews set starts_at = now() - interval '2 hours' where id = ${ivId}`);
    return { opening, email, appId, ivId };
  }

  it("queues invites for the interviewers and the applicant and notifies the panel", async () => {
    const opening = await openJob();
    const email = `${uniq("inv")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    as(recruiter);
    const ivId = idOf(await actions.scheduleInterview({ applicationId: appId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), minutes: 30, location: "Room 1", interviewerUserIds: [lead.id], emailCandidate: true }));
    const mails = await rows<{ user_id: string; kind: string; attachment: { content: string } }>(sql`select user_id, kind, attachment from ops.email_queue where dedupe_key = ${`interview:${ivId}`}`);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ user_id: lead.id, kind: "invite" });
    expect(mails[0].attachment.content).toContain("BEGIN:VEVENT");
    expect(await rows(sql`select 1 from talent.candidate_emails where dedupe_key = ${`interview:${ivId}`}`)).toHaveLength(1);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${lead.id} and kind = 'recruiting.interview'`)).length).toBeGreaterThan(0);

    // The invite body never names the applicant
    const [q] = await rows<{ body: string }>(sql`select body from ops.email_queue where dedupe_key = ${`interview:${ivId}`}`);
    expect(q.body).not.toContain("Ana");

    expect((await actions.cancelInterview({ interviewId: ivId })).ok).toBe(true);
    expect((await actions.cancelInterview({ interviewId: ivId })).ok).toBe(false);
    const cancel = await rows<{ attachment: { content: string } }>(sql`select attachment from ops.email_queue where dedupe_key = ${`interview-cancel:${ivId}`}`);
    expect(cancel[0].attachment.content).toContain("METHOD:CANCEL");
  });

  it("sends the interview emails the moment the interview is scheduled, not at the next 30-minute run", async () => {
    const sent: { to: string; subject: string }[] = [];
    setEmailSender({ send: async (m) => void sent.push({ to: m.to, subject: m.subject }) });
    // The daily caps are shared by everything else in this database: give this test room so it only checks the timing.
    const before = { staff: process.env.EMAIL_DAILY_BUDGET, applicants: process.env.CANDIDATE_EMAIL_DAILY_BUDGET };
    process.env.EMAIL_DAILY_BUDGET = "1000";
    process.env.CANDIDATE_EMAIL_DAILY_BUDGET = "500";
    try {
      const opening = await openJob();
      const email = `${uniq("now")}@example.com`;
      await apply(opening, { email });
      const appId = (await appFor(opening, email))!;
      as(recruiter);
      const ivId = idOf(await actions.scheduleInterview({ applicationId: appId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), minutes: 30, location: "Room 1", interviewerUserIds: [lead.id], emailCandidate: true }));
      // Both the applicant's invitation and the interviewer's calendar email are already sent, with no job run in between.
      expect(await rows<{ status: string }>(sql`select status from talent.candidate_emails where dedupe_key = ${`interview:${ivId}`}`)).toEqual([{ status: "sent" }]);
      expect(await rows<{ status: string }>(sql`select status from ops.email_queue where dedupe_key = ${`interview:${ivId}`}`)).toEqual([{ status: "sent" }]);
      expect(sent.some((m) => m.to === email && /interview/i.test(m.subject))).toBe(true);
    } finally {
      setEmailSender(null);
      for (const [key, value] of [["EMAIL_DAILY_BUDGET", before.staff], ["CANDIDATE_EMAIL_DAILY_BUDGET", before.applicants]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("refuses a past time, an ineligible interviewer and a closed application", async () => {
    const opening = await openJob();
    const email = `${uniq("bad")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    as(recruiter);
    const base = { applicationId: appId, minutes: 30, location: "Room", interviewerUserIds: [lead.id] };
    expect((await actions.scheduleInterview({ ...base, startsAt: new Date(Date.now() - 86_400_000).toISOString() })).ok).toBe(false);
    expect((await actions.scheduleInterview({ ...base, interviewerUserIds: [employee.id], startsAt: new Date(Date.now() + 3_600_000).toISOString() })).ok).toBe(false);
    await actions.rejectApplication({ applicationId: appId, reason: "Withdrew early", kind: "withdrawn" });
    expect((await actions.scheduleInterview({ ...base, startsAt: new Date(Date.now() + 3_600_000).toISOString() })).ok).toBe(false);
  });

  const card = (interviewId: string, recommendation = "yes") => ({ interviewId, ratings: { communication: 4, skills: 4, reliability: 5, culture: 3 }, recommendation, comments: "Clear answers and a calm manner." });

  it("hides other scorecards from an interviewer until they have submitted their own, and never allows a change", async () => {
    const { appId, ivId } = await interviewSetup();

    as(lead);
    expect((await actions.submitScorecard(card(ivId, "strong_yes"))).ok).toBe(true);
    expect((await actions.submitScorecard(card(ivId))).ok).toBe(false); // once
    await expect(db.execute(sql`update talent.scorecards set comments = 'changed' where interview_id = ${ivId}`)).rejects.toThrow();

    // The recruiter is the other interviewer: sees only that others have submitted
    as(recruiter);
    let view = (await queries.getApplication(appId)).interviews[0];
    expect(view.scorecards).toHaveLength(0);
    expect(view.scorecardsHidden).toBe(true);
    expect(view.waitingOn).toBe(1);
    expect((await actions.submitScorecard(card(ivId, "no"))).ok).toBe(true);
    view = (await queries.getApplication(appId)).interviews[0];
    expect(view.scorecards.map((s) => s.recommendation).sort()).toEqual(["no", "strong_yes"]);
    expect(view.scorecardsHidden).toBe(false);

    // HR manages the process but is not an interviewer here: sees everything
    as(hr);
    expect((await queries.getApplication(appId)).interviews[0].scorecards).toHaveLength(2);
  });

  it("refuses a scorecard from someone who was not an interviewer, before the start, or for a cancelled interview", async () => {
    const { ivId } = await interviewSetup();
    as(otherLead);
    expect((await actions.submitScorecard(card(ivId))).ok).toBe(false);
    as(employee);
    expect(await actions.submitScorecard(card(ivId))).toEqual({ ok: false, error: NO_ACCESS });

    await db.execute(sql`update talent.interviews set starts_at = now() + interval '3 hours' where id = ${ivId}`);
    as(lead);
    expect((await actions.submitScorecard(card(ivId))).ok).toBe(false); // not started yet
    await db.execute(sql`update talent.interviews set starts_at = now() - interval '1 hour', status = 'cancelled' where id = ${ivId}`);
    expect((await actions.submitScorecard(card(ivId))).ok).toBe(false);
  });
});

describe("applicant emails", () => {
  it("sends queued mail under its own daily cap and skips applicants whose data was removed", async () => {
    const sent: { to: string; subject: string; bcc?: string }[] = [];
    process.env.EMAIL_APPLICANT_BCC = "talent@example.com";
    await db.execute(sql`delete from talent.candidate_emails`);

    const opening = await openJob();
    const a = `${uniq("mail-a")}@example.com`;
    const b = `${uniq("mail-b")}@example.com`;
    await apply(opening, { email: a });
    await apply(opening, { email: b });
    const bApp = (await appFor(opening, b))!;
    await db.execute(sql`update talent.candidates set anonymized_at = now() where id = (select candidate_id from talent.applications where id = ${bApp})`);

    // No sender yet, so the two "we received your application" notes wait in the queue (with a sender they would go out at once).
    setEmailSender({ send: async (m) => void sent.push({ to: m.to, subject: m.subject, bcc: m.bcc }) });
    const result = await jobs.sendCandidateEmails();
    expect(result).toMatchObject({ configured: true, sent: 1, skipped: 1 });
    expect(sent).toEqual([{ to: a, subject: "We received your application", bcc: "talent@example.com" }]);
    delete process.env.EMAIL_APPLICANT_BCC;

    // The cap: nothing more goes out once the day's allowance is used
    process.env.CANDIDATE_EMAIL_DAILY_BUDGET = "1";
    const c = `${uniq("mail-c")}@example.com`;
    await apply(opening, { email: c });
    expect(await jobs.sendCandidateEmails()).toMatchObject({ sent: 0 });
    delete process.env.CANDIDATE_EMAIL_DAILY_BUDGET;

    setEmailSender(null);
    expect(await jobs.sendCandidateEmails()).toMatchObject({ configured: false });
  });
});

describe("retention", () => {
  const monthsAgo = (n: number) => new Date(Date.now() - n * 31 * 86_400_000).toISOString();

  async function closedApplicant(opening: string, kind: "rejected" | "withdrawn", closedMonthsAgo: number) {
    const email = `${uniq("ret")}@example.com`;
    await apply(opening, { email, fullName: "Rina Cruz", phone: "0999" });
    const appId = (await appFor(opening, email))!;
    as(recruiter);
    await actions.addNote({ applicationId: appId, body: "Strong on phone." });
    await actions.rejectApplication({ applicationId: appId, kind, reason: "Salary expectations", notifyCandidate: false });
    await db.execute(sql`update talent.applications set closed_at = ${monthsAgo(closedMonthsAgo)}::timestamptz where id = ${appId}`);
    const [c] = await rows<{ id: string; resume_path: string }>(sql`select c.id, c.resume_path from talent.candidates c join talent.applications a on a.candidate_id = c.id where a.id = ${appId}`);
    return { email, appId, candidateId: c.id, resumePath: c.resume_path };
  }

  it("does nothing until HR switches it on", async () => {
    const opening = await openJob();
    const old = await closedApplicant(opening, "rejected", 30);
    expect(await jobs.runRecruitingRetention()).toEqual({ enabled: false, candidates: 0 });
    const [c] = await rows<{ anonymized_at: Date | null }>(sql`select anonymized_at from talent.candidates where id = ${old.candidateId}`);
    expect(c.anonymized_at).toBeNull();
  });

  it("only HR can change the settings", async () => {
    as(recruiter);
    expect(await actions.saveRetention({ enabled: true, rejectedMonths: 12, withdrawnMonths: 6 })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect((await actions.saveRetention({ enabled: true, rejectedMonths: 12, withdrawnMonths: 6 })).ok).toBe(true);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.retention_settings'`)).not.toHaveLength(0);
  });

  it("erases the personal data of expired rejected and withdrawn applicants, but keeps the rest", async () => {
    as(hr);
    await actions.saveRetention({ enabled: true, rejectedMonths: 12, withdrawnMonths: 6 });
    const opening = await openJob();
    const expiredRejected = await closedApplicant(opening, "rejected", 13);
    const recentRejected = await closedApplicant(opening, "rejected", 11);
    const expiredWithdrawn = await closedApplicant(opening, "withdrawn", 7);
    const recentWithdrawn = await closedApplicant(opening, "withdrawn", 5);

    // A hired person is never touched, however old
    const hiredEmail = `${uniq("hired")}@example.com`;
    await apply(opening, { email: hiredEmail });
    const hiredApp = (await appFor(opening, hiredEmail))!;
    as(recruiter);
    await actions.moveApplication({ applicationId: hiredApp, to: "hired" });
    await db.execute(sql`update talent.applications set closed_at = ${monthsAgo(40)}::timestamptz where id = ${hiredApp}`);

    // Someone with an old rejection here but a live application elsewhere keeps everything
    const other = await openJob();
    const mixed = await closedApplicant(opening, "rejected", 20);
    await apply(other, { email: mixed.email });
    const [fresh] = await rows<{ resume_path: string }>(sql`select resume_path from talent.candidates where id = ${mixed.candidateId}`);
    mixed.resumePath = fresh.resume_path; // applying again replaced the resume with the newest file

    // A scorecard comment on an expired applicant: the free text goes, the rating and recommendation stay (counts still add up)
    const [iv] = await rows<{ id: string }>(sql`insert into talent.interviews (application_id, starts_at, minutes, location, created_by) values (${expiredRejected.appId}, now() - interval '400 days', 30, 'Room', ${recruiter.id}) returning id`);
    await db.execute(sql`insert into talent.scorecards (interview_id, application_id, interviewer_id, ratings, recommendation, comments) values (${iv.id}, ${expiredRejected.appId}, ${recruiter.id}, '{"skills":4}'::jsonb, 'no', 'Private remarks about the applicant')`);

    const result = await jobs.runRecruitingRetention();
    expect(result.enabled).toBe(true);
    expect(result.candidates).toBeGreaterThanOrEqual(2);

    const state = async (id: string) => (await rows<{ anonymized_at: Date | null; full_name: string; email: string; resume_path: string | null; phone: string | null }>(sql`select anonymized_at, full_name, email, resume_path, phone from talent.candidates where id = ${id}`))[0];
    for (const gone of [expiredRejected, expiredWithdrawn]) {
      const c = await state(gone.candidateId);
      expect(c.anonymized_at).not.toBeNull();
      expect(c).toMatchObject({ full_name: "Removed applicant", resume_path: null, phone: null });
      expect(c.email).toContain("@removed.invalid");
      expect(fake.objects.has(fake.key("recruiting-docs", gone.resumePath))).toBe(false);
      expect(await rows(sql`select 1 from talent.candidate_notes where application_id = ${gone.appId}`)).toHaveLength(0);
      const [a] = await rows<{ stage: string; close_reason: string | null }>(sql`select stage, close_reason from talent.applications where id = ${gone.appId}`);
      expect(a).toEqual({ stage: "rejected", close_reason: null }); // the row and its counts stay
      expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.purge' and target_id = ${gone.candidateId}`)).toHaveLength(1);
    }
    for (const kept of [recentRejected, recentWithdrawn, mixed]) {
      expect((await state(kept.candidateId)).anonymized_at).toBeNull();
      expect(fake.objects.has(fake.key("recruiting-docs", kept.resumePath))).toBe(true);
    }
    const [hired] = await rows<{ anonymized_at: Date | null }>(sql`select c.anonymized_at from talent.candidates c join talent.applications a on a.candidate_id = c.id where a.id = ${hiredApp}`);
    expect(hired.anonymized_at).toBeNull();

    const [card] = await rows<{ comments: string; recommendation: string }>(sql`select comments, recommendation from talent.scorecards where application_id = ${expiredRejected.appId}`);
    expect(card).toEqual({ comments: "[removed]", recommendation: "no" });

    // The board shows a removed applicant as such, and a second run finds nothing more to do
    as(recruiter);
    const board = await queries.getOpeningBoard(opening);
    expect(board.columns.rejected.some((c) => c.name === "Removed applicant")).toBe(true);
    expect((await queries.getApplication(expiredRejected.appId)).candidate).toEqual({ removed: true });
    expect((await jobs.runRecruitingRetention()).candidates).toBe(0);

    // Evidence rules still hold outside the job
    await expect(db.execute(sql`delete from talent.application_stage_history where application_id = ${recentRejected.appId}`)).rejects.toThrow();
  });
});

describe("the one-row settings and table protections", () => {
  it("keeps a single settings row and refuses stray retention flags from changing evidence", async () => {
    await expect(db.execute(sql`insert into talent.recruiting_settings (id) values (2)`)).rejects.toThrow();
    // Setting the flag in one statement does not leak into the next (it is transaction-local)
    await db.execute(sql`select set_config('talent.retention', 'on', true)`);
    const opening = await openJob();
    const email = `${uniq("flag")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    await expect(db.execute(sql`update talent.application_stage_history set note = 'x' where application_id = ${appId}`)).rejects.toThrow();
    expect(await service.getRetentionSettings()).toMatchObject({ id: 1 });
  });
});

describe("deleting a job ad and erasing an application", () => {
  it("deletes a job nobody applied to, hides one that has applications, and only HR and Super Admin can", async () => {
    const admin = await makeUser("sa", ["super_admin", "employee"]);
    const empty = await openJob();
    as(recruiter);
    expect(await actions.deleteOpening({ id: empty })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect(await actions.deleteOpening({ id: empty })).toEqual({ ok: true, data: { erased: true } });
    expect(await rows(sql`select 1 from talent.job_openings where id = ${empty}`)).toHaveLength(0);
    expect(await actions.deleteOpening({ id: empty })).toEqual({ ok: false, error: "That job was not found." });

    const busy = await openJob();
    const email = `${uniq("del")}@example.com`;
    await apply(busy, { email });
    as(admin);
    expect(await actions.deleteOpening({ id: busy })).toEqual({ ok: true, data: { erased: false } });
    const [row] = await rows<{ status: string; archived_at: string | null }>(sql`select status, archived_at from talent.job_openings where id = ${busy}`);
    expect(row.status).toBe("closed");
    expect(row.archived_at).not.toBeNull();
    expect(await appFor(busy, email)).toBeTruthy(); // the application is kept
    expect(await queries.listPublicOpenings()).not.toContainEqual(expect.objectContaining({ id: busy }));
  });

  it("erases an application for good with its applicant, notes, interview, scorecards and resume; only the Super Admin can, and it needs the word DELETE", async () => {
    const admin = await makeUser("sa2", ["super_admin", "employee"]);
    const opening = await openJob();
    const email = `${uniq("erase")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    const [cand] = await rows<{ id: string; resume_path: string | null }>(sql`select c.id, c.resume_path from talent.candidates c join talent.applications a on a.candidate_id = c.id where a.id = ${appId}`);
    expect(cand.resume_path).toBeTruthy();

    as(recruiter);
    await actions.addNote({ applicationId: appId, body: "Strong phone manner." });
    const ivId = idOf(await actions.scheduleInterview({ applicationId: appId, startsAt: new Date(Date.now() + 3_600_000).toISOString(), minutes: 45, location: "https://meet.example.com/x", interviewerUserIds: [lead.id], emailCandidate: false }));
    await db.execute(sql`update talent.interviews set starts_at = now() - interval '2 hours' where id = ${ivId}`);
    as(lead);
    expect((await actions.submitScorecard({ interviewId: ivId, ratings: { communication: 4, skills: 4, reliability: 5, culture: 3 }, recommendation: "yes", comments: "Fine." })).ok).toBe(true);

    for (const who of [hr, recruiter, lead]) {
      as(who);
      expect(await actions.deleteApplication({ applicationId: appId, confirm: "DELETE" })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(admin);
    expect((await actions.deleteApplication({ applicationId: appId, confirm: "delete" })).ok).toBe(false);
    expect(await actions.deleteApplication({ applicationId: appId, confirm: "DELETE" })).toEqual({ ok: true, data: { openingId: opening } });

    for (const table of ["applications", "application_stage_history", "candidate_notes", "interviews", "scorecards", "candidate_emails"]) {
      expect(await rows(sql.raw(`select 1 from talent.${table} where ${table === "applications" ? "id" : "application_id"} = '${appId}'`)), table).toHaveLength(0);
    }
    expect(await rows(sql`select 1 from talent.candidates where id = ${cand.id}`)).toHaveLength(0);
    expect(fake.removed.some((k) => k.includes(cand.resume_path!))).toBe(true);
    expect(fake.objects.size === 0 || ![...fake.objects.keys()].some((k) => k.includes(cand.resume_path!))).toBe(true);
    const [audit] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'recruiting.application_erase' and target_id = ${appId}`);
    expect(audit.metadata).toMatchObject({ interviews: 1, applicantErased: true });
    expect(JSON.stringify(audit.metadata)).not.toContain(email);
  });

  it("keeps the applicant when they have another application, and refuses an application with an offer", async () => {
    const admin = await makeUser("sa3", ["super_admin", "employee"]);
    const one = await openJob();
    const two = await openJob();
    const email = `${uniq("twice")}@example.com`;
    await apply(one, { email });
    await apply(two, { email });
    const appOne = (await appFor(one, email))!;
    as(admin);
    expect((await actions.deleteApplication({ applicationId: appOne, confirm: "DELETE" })).ok).toBe(true);
    expect(await appFor(two, email)).toBeTruthy();
    expect(await rows(sql`select 1 from talent.candidates where lower(email) = ${email.toLowerCase()}`)).toHaveLength(1);

    const hired = `${uniq("hired")}@example.com`;
    await apply(two, { email: hired });
    const hiredApp = (await appFor(two, hired))!;
    await db.execute(sql`update talent.applications set stage = 'hired', closed_at = now() where id = ${hiredApp}`);
    expect(await actions.deleteApplication({ applicationId: hiredApp, confirm: "DELETE" })).toEqual({ ok: false, error: "This applicant has an offer or was hired, so it cannot be erased." });
  });
});
