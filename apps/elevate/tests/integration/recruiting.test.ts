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
const applicantFilters = await import("@/modules/recruiting/applicant-filters");
const { makeDocx, makePdf } = await import("../helpers/resume-files");
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

describe("the all-applicants list", () => {
  const { EMPTY_FILTERS } = applicantFilters;
  const list = async (user: TestUser, over: Partial<typeof EMPTY_FILTERS> = {}, paging = { page: 1, pageSize: 100 }) => {
    as(user);
    return queries.listApplicants({ ...EMPTY_FILTERS, ...over }, paging);
  };

  it("searches by name or email as plain text, filters by job, stage, close kind and date, and sorts", async () => {
    const opening = await openJob(uniq("Billing "));
    const other = await openJob(uniq("Scheduler "));
    const tag = uniq("zq").toLowerCase();
    const a = `${tag}-a@example.com`;
    const b = `${tag}-b@example.com`;
    await apply(opening, { email: a, fullName: "Zed Alvarez" });
    await apply(opening, { email: b, fullName: "Zoe 100%_Cruz" });
    await apply(other, { email: `${tag}-c@example.com`, fullName: "Zack Tan" });
    const appA = (await appFor(opening, a))!;
    const appB = (await appFor(opening, b))!;
    as(recruiter);
    expect((await actions.moveApplication({ applicationId: appA, to: "screening" })).ok).toBe(true);
    expect((await actions.rejectApplication({ applicationId: appB, kind: "not_qualified", reason: "Missing certification" })).ok).toBe(true);

    expect((await list(recruiter, { q: tag })).rows).toHaveLength(3);
    expect((await list(recruiter, { q: "alvarez" })).rows.map((r) => r.applicationId)).toEqual([appA]);
    // % and _ are matched as the characters they are, not as wildcards
    expect((await list(recruiter, { q: "100%_" })).rows.map((r) => r.applicationId)).toEqual([appB]);
    expect((await list(recruiter, { q: "z%" })).rows).toHaveLength(0);
    expect((await list(recruiter, { q: tag, openingId: other })).rows.map((r) => r.name)).toEqual(["Zack Tan"]);
    expect((await list(recruiter, { q: tag, stage: "screening" })).rows.map((r) => r.applicationId)).toEqual([appA]);
    expect((await list(recruiter, { q: tag, stage: "open" })).rows).toHaveLength(2);
    expect((await list(recruiter, { q: tag, closeKind: "not_qualified" })).rows.map((r) => r.applicationId)).toEqual([appB]);
    expect((await list(recruiter, { q: tag, from: "2999-01-01" })).rows).toHaveLength(0);
    expect((await list(recruiter, { q: tag, to: "2999-01-01" })).rows).toHaveLength(3);
    expect((await list(recruiter, { q: tag, sort: "name" })).rows.map((r) => r.name)).toEqual(["Zack Tan", "Zed Alvarez", "Zoe 100%_Cruz"]);
  });

  it("pages in the database and reports the total", async () => {
    const opening = await openJob(uniq("Paged "));
    for (let i = 0; i < 5; i++) await apply(opening, { fullName: `Page Person ${i}` });
    const first = await list(recruiter, { openingId: opening }, { page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.info).toMatchObject({ total: 5, pages: 3, page: 1 });
    const last = await list(recruiter, { openingId: opening }, { page: 9, pageSize: 2 }); // past the end snaps to the last page
    expect(last.rows).toHaveLength(1);
    expect(last.info.page).toBe(3);
  });

  it("shows a team lead only the jobs they are on the hiring team for, and refuses an executive and an employee", async () => {
    const mine = await openJob(uniq("Mine ")); // hiring team: lead
    as(recruiter);
    const notMine = idOf(await actions.saveOpening({ title: uniq("Not mine "), description: "Other team's job for another lead.", hiringTeamUserIds: [otherLead.id] }));
    await actions.setOpeningStatus({ id: notMine, status: "open" });
    const tag = uniq("tl").toLowerCase();
    await apply(mine, { email: `${tag}-1@example.com`, fullName: "Visible Person" });
    await apply(notMine, { email: `${tag}-2@example.com`, fullName: "Hidden Person" });

    const seen = await list(lead, { q: tag });
    expect(seen.scope).toBe("team");
    expect(seen.rows.map((r) => r.name)).toEqual(["Visible Person"]);
    expect(seen.openings.map((o) => o.id)).toContain(mine);
    expect(seen.openings.map((o) => o.id)).not.toContain(notMine);
    // asking for the other job directly still returns nothing for this lead
    expect((await list(lead, { q: tag, openingId: notMine })).rows).toHaveLength(0);
    await expect(list(exec)).rejects.toThrow();
    await expect(list(employee)).rejects.toThrow();
  });

  it("lists a removed applicant without a name or email, and a search never finds them", async () => {
    const opening = await openJob(uniq("Removed "));
    const email = `${uniq("gone")}@example.com`;
    await apply(opening, { email, fullName: "Gone Person" });
    const appId = (await appFor(opening, email))!;
    await db.execute(sql`update talent.candidates set anonymized_at = now() where id = (select candidate_id from talent.applications where id = ${appId})`);
    const all = await list(recruiter, { openingId: opening });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]).toMatchObject({ name: "Removed applicant", email: null });
    expect((await list(recruiter, { openingId: opening, q: "gone" })).rows).toHaveLength(0);
  });
});

describe("resume keyword match", () => {
  const keywords = { keywordsRequired: "medical billing, excel", keywordsNice: "hipaa, spanish" };
  async function keywordJob() {
    as(recruiter);
    const id = idOf(await actions.saveOpening({ title: uniq("Keyword "), description: "Support our clients with billing and inbox care.", hiringTeamUserIds: [lead.id], ...keywords }));
    await actions.setOpeningStatus({ id, status: "open" });
    return id;
  }
  const scoreOf = async (appId: string) => (await rows<{ keyword_score: number | null; keyword_matched: string[] | null; keyword_missed: string[] | null }>(sql`select keyword_score, keyword_matched, keyword_missed from talent.applications where id = ${appId}`))[0];

  it("scores a PDF and a Word resume when the person applies, and keeps only the percentage and the words, never the text", async () => {
    const opening = await keywordJob();
    const a = `${uniq("kw")}@example.com`;
    const b = `${uniq("kw")}@example.com`;
    expect(await apply(opening, { email: a }, { bytes: await makePdf(["Medical billing specialist", "Skills: Excel and HIPAA"]), name: "cv.pdf" })).toEqual({ ok: true });
    expect(await apply(opening, { email: b }, { bytes: makeDocx(["Virtual assistant", "Fluent in Spanish"]), name: "cv.docx" })).toEqual({ ok: true });
    const first = await scoreOf((await appFor(opening, a))!);
    expect(first.keyword_score).toBe(85); // both required (70) and one of two nice (15)
    expect(first.keyword_matched).toEqual(["medical billing", "excel", "hipaa"]);
    expect(first.keyword_missed).toEqual(["spanish"]);
    const second = await scoreOf((await appFor(opening, b))!);
    expect(second.keyword_score).toBe(15);
    // nothing in the application row holds the resume text
    const [raw] = await rows<{ doc: string }>(sql`select row_to_json(a)::text as doc from talent.applications a where a.id = ${(await appFor(opening, a))!}`);
    expect(raw.doc).not.toContain("Medical billing specialist");
  });

  it("gives no score for a job with no keywords or a resume with no readable text, and never blocks the application", async () => {
    const plain = await openJob();
    const email = `${uniq("kw")}@example.com`;
    expect(await apply(plain, { email })).toEqual({ ok: true });
    expect((await scoreOf((await appFor(plain, email))!)).keyword_score).toBeNull();
    const opening = await keywordJob();
    const scan = `${uniq("kw")}@example.com`;
    expect(await apply(opening, { email: scan }, { bytes: await makePdf([]), name: "scan.pdf" })).toEqual({ ok: true });
    expect((await scoreOf((await appFor(opening, scan))!)).keyword_score).toBeNull();
  });

  it("scores everyone again after the keywords change, shows it is out of date until then, and lists by score", async () => {
    const opening = await keywordJob();
    const email = `${uniq("kw")}@example.com`;
    await apply(opening, { email }, { bytes: await makePdf(["Excel and HIPAA experience"]), name: "cv.pdf" });
    const appId = (await appFor(opening, email))!;
    expect((await queries.getApplication(appId)).keyword.stale).toBe(false);

    as(recruiter);
    expect((await actions.saveOpening({ id: opening, title: uniq("Keyword "), description: "Support our clients with billing and inbox care.", hiringTeamUserIds: [lead.id], keywordsRequired: "excel", keywordsNice: "" })).ok).toBe(true);
    expect((await queries.getApplication(appId)).keyword.stale).toBe(true);
    expect(await actions.rescoreOpening({ openingId: opening })).toMatchObject({ ok: true, data: { looked: 1, scored: 1, unreadable: 0 } });
    expect((await scoreOf(appId)).keyword_score).toBe(100);
    expect((await queries.getApplication(appId)).keyword.stale).toBe(false);
    // nothing is left to score with these keywords, so a second press has no work
    expect(await actions.rescoreOpening({ openingId: opening })).toMatchObject({ ok: true, data: { looked: 0, scored: 0, remaining: 0 } });

    const high = await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, openingId: opening, minScore: 75, sort: "score" }, { page: 1, pageSize: 20 });
    expect(high.rows.map((r) => [r.applicationId, r.keywordScore])).toEqual([[appId, 100]]);
    expect((await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, openingId: opening, minScore: 75 }, { page: 1, pageSize: 20 })).rows).toHaveLength(1);
    // refuses a job with no keywords, and anyone who may not manage jobs
    const plain = await openJob();
    expect((await actions.rescoreOpening({ openingId: plain })).ok).toBe(false);
    as(lead);
    expect(await actions.rescoreOpening({ openingId: opening })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("sources, tags and bulk actions", () => {
  const tagId = async (name: string) => {
    as(recruiter);
    const made = await actions.createTag({ name });
    if (!made.ok) throw new Error(made.error);
    return made.data.id;
  };

  it("keeps where the applicant heard about the job, ignores an unknown value, and lets staff change it", async () => {
    const opening = await openJob();
    const a = `${uniq("src")}@example.com`;
    const b = `${uniq("src")}@example.com`;
    expect(await apply(opening, { email: a, source: "referral", sourceDetail: "Maria Santos" })).toEqual({ ok: true });
    expect(await apply(opening, { email: b, source: "not-a-source" })).toEqual({ ok: true });
    const [rowA] = await rows<{ source: string | null; source_detail: string | null }>(sql`select source, source_detail from talent.applications where id = ${(await appFor(opening, a))!}`);
    expect(rowA).toEqual({ source: "referral", source_detail: "Maria Santos" });
    const idB = (await appFor(opening, b))!;
    expect((await rows<{ source: string | null }>(sql`select source from talent.applications where id = ${idB}`))[0].source).toBeNull();

    as(recruiter);
    expect((await actions.setApplicationSource({ applicationId: idB, source: "linkedin" })).ok).toBe(true);
    expect((await actions.setApplicationSource({ applicationId: idB, source: "nonsense" })).ok).toBe(false);
    expect((await rows<{ source: string | null }>(sql`select source from talent.applications where id = ${idB}`))[0].source).toBe("linkedin");
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.source_set' and target_id = ${idB}`)).toHaveLength(1);
    // The list can filter on it
    const listed = await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, openingId: opening, source: "linkedin" }, { page: 1, pageSize: 50 });
    expect(listed.rows.map((r) => r.applicationId)).toEqual([idB]);
    expect((await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, openingId: opening, source: "none" }, { page: 1, pageSize: 50 })).rows).toHaveLength(0);
  });

  it("creates a tag once per name (ignoring case), sets tags on an application, filters by tag, and archiving removes it everywhere", async () => {
    const opening = await openJob();
    const email = `${uniq("tag")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    const name = uniq("Strong English ");
    const t1 = await tagId(name);
    expect(await tagId(name.toUpperCase())).toBe(t1); // same tag
    // two people creating the same new name at the same moment both get the one tag
    const race = uniq("Race ");
    const both = await Promise.all([actions.createTag({ name: race }), actions.createTag({ name: race.toLowerCase() })]);
    expect(both.every((r) => r.ok)).toBe(true);
    expect(new Set(both.map((r) => (r as { data: { id: string } }).data.id)).size).toBe(1);
    const t2 = await tagId(uniq("Call back "));
    as(recruiter);
    expect((await actions.createTag({ name: "<script>" })).ok).toBe(false);
    expect((await actions.setApplicationTags({ applicationId: appId, tagIds: [t1, t2] })).ok).toBe(true);
    expect((await queries.getApplication(appId)).tags.map((t) => t.id).sort()).toEqual([t1, t2].sort());
    expect((await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, tagId: t1 }, { page: 1, pageSize: 50 })).rows.map((r) => r.applicationId)).toEqual([appId]);
    expect((await actions.setApplicationTags({ applicationId: appId, tagIds: Array.from({ length: 11 }, () => t1) })).ok).toBe(false); // more than 10 is refused
    expect((await actions.setApplicationTags({ applicationId: appId, tagIds: ["11111111-1111-4111-8111-111111111111"] })).ok).toBe(false);

    expect((await actions.archiveTag({ tagId: t1 })).ok).toBe(true);
    expect((await queries.getApplication(appId)).tags.map((t) => t.id)).not.toContain(t1);
    expect(await rows(sql`select 1 from talent.application_tags where tag_id = ${t1}`)).toHaveLength(0);
    // the name is free to use again
    expect(await tagId(name)).not.toBe(t1);
  });

  it("moves, closes and tags many at once, reports the ones that could not change, and writes the same history", async () => {
    const opening = await openJob();
    const emails = [1, 2, 3].map((n) => `${uniq(`bulk${n}-`)}@example.com`);
    for (const e of emails) await apply(opening, { email: e });
    const ids = await Promise.all(emails.map(async (e) => (await appFor(opening, e))!));
    as(recruiter);

    const moved = await actions.bulkUpdateApplications({ action: "move", applicationIds: ids, to: "screening", note: "Batch review" });
    expect(moved).toMatchObject({ ok: true, data: { requested: 3, done: 3, failed: [] } });
    expect(await rows(sql`select 1 from talent.application_stage_history where application_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) and to_stage = 'screening'`)).toHaveLength(3);
    // moving to the stage they are already in fails for each one, and says why
    const again = await actions.bulkUpdateApplications({ action: "move", applicationIds: ids, to: "screening" });
    expect(again).toMatchObject({ ok: true, data: { done: 0 } });
    expect((again as { data: { failed: { reason: string }[] } }).data.failed.map((f) => f.reason)).toEqual(Array(3).fill("They are already in that stage."));
    // hiring is never done in bulk
    expect((await actions.bulkUpdateApplications({ action: "move", applicationIds: ids, to: "hired" })).ok).toBe(false);

    const tag = await tagId(uniq("Batch "));
    expect(await actions.bulkUpdateApplications({ action: "tag", applicationIds: ids, tagId: tag })).toMatchObject({ ok: true, data: { done: 3 } });
    expect(await rows(sql`select 1 from talent.application_tags where tag_id = ${tag}`)).toHaveLength(3);
    expect(await actions.bulkUpdateApplications({ action: "untag", applicationIds: [ids[0]], tagId: tag })).toMatchObject({ ok: true, data: { done: 1 } });
    expect(await rows(sql`select 1 from talent.application_tags where tag_id = ${tag}`)).toHaveLength(2);

    // close two (one is closed first, so it is reported), email only when asked
    expect((await actions.rejectApplication({ applicationId: ids[2], reason: "Already closed" })).ok).toBe(true);
    const closed = await actions.bulkUpdateApplications({ action: "close", applicationIds: ids.slice(1), kind: "not_qualified", reason: "Missing certification", notifyCandidate: true });
    expect(closed).toMatchObject({ ok: true, data: { requested: 2, done: 1 } });
    expect((closed as { data: { failed: { applicationId: string; reason: string }[] } }).data.failed).toEqual([{ applicationId: ids[2], reason: "They are already closed." }]);
    const [c] = await rows<{ close_kind: string }>(sql`select close_kind from talent.applications where id = ${ids[1]}`);
    expect(c.close_kind).toBe("not_qualified");
    expect(await rows(sql`select 1 from talent.candidate_emails where application_id = ${ids[1]} and kind = 'rejection'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.bulk' and metadata->>'action' = 'close'`)).not.toHaveLength(0);
    // the summary row names which applications it covered
    const [bulkAudit] = await rows<{ ids: string[] }>(sql`select metadata->'applicationIds' as ids from ops.audit_log where action = 'recruiting.bulk' and metadata->>'action' = 'tag' order by occurred_at desc limit 1`);
    expect(bulkAudit.ids.sort()).toEqual([...ids].sort());
    // unknown ids are reported, not fatal; too many are refused
    expect((await actions.bulkUpdateApplications({ action: "move", applicationIds: ["11111111-1111-4111-8111-111111111111"], to: "screening" })).ok).toBe(true);
    expect((await actions.bulkUpdateApplications({ action: "move", applicationIds: Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`), to: "screening" })).ok).toBe(false);
  });

  it("only HR, Super Admin and recruiters may tag or act in bulk; a team lead, executive and employee are refused", async () => {
    const opening = await openJob();
    const email = `${uniq("perm")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    for (const u of [lead, exec, employee]) {
      as(u);
      expect(await actions.createTag({ name: "Nope" })).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.setApplicationTags({ applicationId: appId, tagIds: [] })).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.bulkUpdateApplications({ action: "move", applicationIds: [appId], to: "screening" })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await actions.bulkUpdateApplications({ action: "move", applicationIds: [appId], to: "screening" })).ok).toBe(true);
  });

  it("erasing an application also removes its tags", async () => {
    const opening = await openJob();
    const email = `${uniq("erase")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;
    const tag = await tagId(uniq("Erase "));
    as(recruiter);
    await actions.setApplicationTags({ applicationId: appId, tagIds: [tag] });
    const superAdmin = await makeUser("sa", ["super_admin", "employee"]);
    as(superAdmin);
    expect((await actions.deleteApplication({ applicationId: appId, confirm: "DELETE" })).ok).toBe(true);
    expect(await rows(sql`select 1 from talent.application_tags where application_id = ${appId}`)).toHaveLength(0);
  });
});

describe("the pipeline", () => {
  it("closes an application as not qualified, keeps the kind and history note, can email, and can reopen", async () => {
    const opening = await openJob();
    const email = `${uniq("nq")}@example.com`;
    await apply(opening, { email });
    const appId = (await appFor(opening, email))!;

    as(recruiter);
    expect((await actions.rejectApplication({ applicationId: appId, kind: "not_qualified", reason: "Missing required certification", notifyCandidate: true })).ok).toBe(true);
    const [closed] = await rows<{ stage: string; close_kind: string; close_reason: string }>(sql`select stage, close_kind, close_reason from talent.applications where id = ${appId}`);
    expect(closed).toEqual({ stage: "rejected", close_kind: "not_qualified", close_reason: "Missing required certification" });
    const [note] = await rows<{ note: string }>(sql`select note from talent.application_stage_history where application_id = ${appId} and to_stage = 'rejected'`);
    expect(note.note).toBe("Not qualified");
    expect(await rows(sql`select 1 from talent.candidate_emails where application_id = ${appId} and kind = 'rejection'`)).toHaveLength(1);
    expect((await actions.rejectApplication({ applicationId: appId, kind: "not_qualified", reason: "again" })).ok).toBe(false); // already closed
    expect((await actions.moveApplication({ applicationId: appId, to: "screening" })).ok).toBe(true); // reopen
    const [reopened] = await rows<{ close_kind: string | null }>(sql`select close_kind from talent.applications where id = ${appId}`);
    expect(reopened.close_kind).toBeNull();
    // The database refuses an unknown kind.
    await expect(db.execute(sql`update talent.applications set stage = 'rejected', close_kind = 'nope' where id = ${appId}`)).rejects.toThrow();
  });

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

describe("talent pool and duplicate merge", () => {
  const candidateOf = async (appId: string) => (await rows<{ id: string }>(sql`select candidate_id as id from talent.applications where id = ${appId}`))[0].id;
  const phoneNo = () => `09${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`;

  it("starts the 12-month clock only when the applicant ticks the box, and only a consenting applicant can go in the pool", async () => {
    const opening = await openJob();
    const yes = `${uniq("pool")}@example.com`;
    const no = `${uniq("pool")}@example.com`;
    await apply(opening, { email: yes, poolConsent: true });
    await apply(opening, { email: no });
    const [row] = await rows<{ pool_consent_at: Date | null; months: number }>(sql`select pool_consent_at, round(extract(epoch from (pool_expires_at - pool_consent_at)) / 2629800)::int as months from talent.candidates where lower(email) = ${yes}`);
    expect(row.pool_consent_at).not.toBeNull();
    expect(row.months).toBe(12);
    expect((await rows<{ pool_consent_at: Date | null }>(sql`select pool_consent_at from talent.candidates where lower(email) = ${no}`))[0].pool_consent_at).toBeNull();

    const appYes = (await appFor(opening, yes))!;
    const appNo = (await appFor(opening, no))!;
    as(recruiter);
    expect(await actions.setTalentPool({ applicationId: appNo, inPool: true })).toMatchObject({ ok: false, error: expect.stringContaining("did not agree") });
    expect((await actions.setTalentPool({ applicationId: appYes, inPool: true })).ok).toBe(true);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.pool_add' and target_id = ${await candidateOf(appYes)}`)).toHaveLength(1);

    const pooled = await queries.listApplicants({ ...applicantFilters.EMPTY_FILTERS, openingId: opening, poolOnly: true }, { page: 1, pageSize: 20 });
    expect(pooled.rows.map((r) => [r.applicationId, r.inPool])).toEqual([[appYes, true]]);
    expect((await queries.getApplication(appYes)).pool).toMatchObject({ consented: true, inPool: true, canManage: true });
    expect((await queries.getApplication(appNo)).pool).toMatchObject({ consented: false, inPool: false });

    // in bulk, the one who did not agree is reported, not forced in
    const bulk = await actions.bulkUpdateApplications({ action: "pool_add", applicationIds: [appYes, appNo] });
    expect(bulk).toMatchObject({ ok: true, data: { requested: 2, done: 1 } });
    expect((await actions.setTalentPool({ applicationId: appYes, inPool: false })).ok).toBe(true);
    for (const u of [lead, exec, employee]) {
      as(u);
      expect(await actions.setTalentPool({ applicationId: appYes, inPool: true })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });

  it("puts a pool member forward for another open job, once, and never someone who is not in the pool", async () => {
    const first = await openJob();
    const second = await openJob();
    const email = `${uniq("fwd")}@example.com`;
    await apply(first, { email, poolConsent: true });
    const appId = (await appFor(first, email))!;
    as(recruiter);
    expect(await actions.addPoolMemberToOpening({ applicationId: appId, openingId: second })).toMatchObject({ ok: false, error: expect.stringContaining("did not agree") }); // not in the pool yet
    await actions.setTalentPool({ applicationId: appId, inPool: true });
    expect((await queries.getApplication(appId)).pool.openings.map((o) => o.id)).toEqual(expect.arrayContaining([second]));
    const added = await actions.addPoolMemberToOpening({ applicationId: appId, openingId: second });
    expect(added.ok).toBe(true);
    const newApp = (added as { data: { applicationId: string } }).data.applicationId;
    // the hiring team of that job (the lead) is told, like for any new application
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${lead.id} and kind = 'recruiting.new_application' and body like '%from the talent pool%' and link = ${`/recruiting/${second}`}`)).toHaveLength(1);
    const [hist] = await rows<{ to_stage: string; note: string | null }>(sql`select to_stage, note from talent.application_stage_history where application_id = ${newApp}`);
    expect(hist).toEqual({ to_stage: "applied", note: "Added from the talent pool" });
    expect(await actions.addPoolMemberToOpening({ applicationId: appId, openingId: second })).toMatchObject({ ok: false, error: "They already have an application for that job." });
    expect((await queries.getApplication(appId)).pool.openings.map((o) => o.id)).not.toContain(second);
    as(recruiter);
    const draft = idOf(await actions.saveOpening({ title: uniq("Draft "), description: "A job that is not open yet, for the pool test.", hiringTeamUserIds: [] }));
    expect(await actions.addPoolMemberToOpening({ applicationId: appId, openingId: draft })).toEqual({ ok: false, error: "That job is not open." });
  });

  it("keeps a pool member's data past the retention period while the consent runs, then the normal period applies again", async () => {
    as(hr);
    await actions.saveRetention({ enabled: true, rejectedMonths: 12, withdrawnMonths: 6 });
    try {
      const opening = await openJob();
      const email = `${uniq("keep")}@example.com`;
      await apply(opening, { email, fullName: "Pool Keeper", poolConsent: true });
      const appId = (await appFor(opening, email))!;
      const candidateId = await candidateOf(appId);
      as(recruiter);
      await actions.setTalentPool({ applicationId: appId, inPool: true });
      await actions.rejectApplication({ applicationId: appId, reason: "Not this role", notifyCandidate: false });
      await db.execute(sql`update talent.applications set closed_at = now() - interval '20 months' where id = ${appId}`);

      await jobs.runRecruitingRetention();
      expect((await rows<{ anonymized_at: Date | null }>(sql`select anonymized_at from talent.candidates where id = ${candidateId}`))[0].anonymized_at).toBeNull();

      // the consent runs out: they leave the pool and the normal period (already over) applies
      await db.execute(sql`update talent.candidates set pool_expires_at = now() - interval '1 day' where id = ${candidateId}`);
      await jobs.runRecruitingRetention();
      const [after] = await rows<{ anonymized_at: Date | null; in_pool: boolean }>(sql`select anonymized_at, in_pool from talent.candidates where id = ${candidateId}`);
      expect(after.in_pool).toBe(false);
      expect(after.anonymized_at).not.toBeNull();
    } finally {
      as(hr);
      await actions.saveRetention({ enabled: false, rejectedMonths: 12, withdrawnMonths: 6 });
    }
  });

  it("finds likely duplicates, merges them into one record, and refuses when both applied for the same job", async () => {
    const jobX = await openJob();
    const jobY = await openJob();
    const phone = phoneNo();
    const name = uniq("Mia Tester ").replace(/[0-9]/g, "x");
    const e1 = `${uniq("dup")}@example.com`;
    const e2 = `${uniq("dup")}@example.com`;
    const e3 = `${uniq("dup")}@example.com`;
    await apply(jobY, { email: e1, fullName: name, phone });
    await apply(jobX, { email: e2, fullName: `${name} Jr`, phone, poolConsent: true });
    await apply(jobY, { email: e3, fullName: `${name} Sr`, phone });
    const [app1, app2, app3] = [(await appFor(jobY, e1))!, (await appFor(jobX, e2))!, (await appFor(jobY, e3))!];
    const [c1, c2, c3] = await Promise.all([candidateOf(app1), candidateOf(app2), candidateOf(app3)]);

    as(hr);
    const groups = await queries.listDuplicateGroups();
    const mine = groups.find((g) => g.candidates.some((c) => c.id === c1));
    expect(mine?.reasons).toContain("phone");
    expect(mine?.candidates.map((c) => c.id).sort()).toEqual([c1, c2, c3].sort());

    // a recruiter may not merge; HR may
    as(recruiter);
    expect(await actions.mergeCandidates({ keepCandidateId: c1, mergeCandidateId: c2 })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect(await actions.mergeCandidates({ keepCandidateId: c1, mergeCandidateId: c1 })).toMatchObject({ ok: false });
    expect(await actions.mergeCandidates({ keepCandidateId: c1, mergeCandidateId: c2 })).toEqual({ ok: true, data: { moved: 1 } });
    const [left] = await rows<{ full_name: string; anonymized_at: Date | null; merged_into: string | null; email: string }>(sql`select full_name, anonymized_at, merged_into, email from talent.candidates where id = ${c2}`);
    expect(left).toMatchObject({ full_name: "Merged duplicate", merged_into: c1 });
    expect(left.anonymized_at).not.toBeNull();
    expect(left.email).not.toContain("example.com");
    expect(await candidateOf(app2)).toBe(c1); // the application moved
    // the pool agreement came along with the application
    expect((await rows<{ pool_consent_at: Date | null }>(sql`select pool_consent_at from talent.candidates where id = ${c1}`))[0].pool_consent_at).not.toBeNull();
    expect(await rows(sql`select 1 from ops.audit_log where action = 'recruiting.merge' and target_id = ${c1}`)).toHaveLength(1);

    // c3 and c1 both applied for job Y: refused, and nothing changed
    const refused = await actions.mergeCandidates({ keepCandidateId: c1, mergeCandidateId: c3 });
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining("Both records applied") });
    expect((await rows<{ anonymized_at: Date | null }>(sql`select anonymized_at from talent.candidates where id = ${c3}`))[0].anonymized_at).toBeNull();
    // an emptied record cannot be merged again, and no longer shows up as a duplicate
    expect(await actions.mergeCandidates({ keepCandidateId: c1, mergeCandidateId: c2 })).toMatchObject({ ok: false });
    expect((await queries.listDuplicateGroups()).some((g) => g.candidates.some((c) => c.id === c2))).toBe(false);
  });
});

describe("applicant email wording", () => {
  const bodyOf = async (appId: string, kind: string) => (await rows<{ body: string }>(sql`select body::text as body from talent.candidate_emails where application_id = ${appId} and kind = ${kind}`))[0]?.body ?? "";

  it("uses HR's own wording once saved (names filled in, nothing else), the built-in until then, and goes back on reset", async () => {
    const opening = await openJob(uniq("Wording "));
    const before = `${uniq("tpl")}@example.com`;
    await apply(opening, { email: before, fullName: "Ana Reyes" });
    expect(await bodyOf((await appFor(opening, before))!, "received")).toContain("a member of our team will review it");

    as(hr);
    try {
      expect(await actions.saveEmailTemplate({ kind: "received", subject: "Salamat, {{first_name}}!", body: "Hi {{first_name}}, we got your application for {{job_title}}.\n\nWe will reply soon." })).toEqual({ ok: true, data: undefined });
      const after = `${uniq("tpl")}@example.com`;
      await apply(opening, { email: after, fullName: "Ben <Tan>" });
      const afterApp = (await appFor(opening, after))!;
      const text = await bodyOf(afterApp, "received");
      expect(text).toContain("we got your application for");
      expect(text).toContain("Hi Ben");
      expect(text).not.toContain("a member of our team will review it");
      expect((await rows<{ subject: string }>(sql`select subject from talent.candidate_emails where application_id = ${afterApp}`))[0].subject).toBe("Salamat, Ben!");
      expect((await queries.listEmailTemplates()).find((t) => t.kind === "received")).toMatchObject({ custom: true, subject: "Salamat, {{first_name}}!" });
      // refused: unknown field, empty message; the audit trail names the email, never the words
      expect(await actions.saveEmailTemplate({ kind: "received", subject: "Hi", body: "Your score is {{score}}" })).toMatchObject({ ok: false });
      expect(await actions.saveEmailTemplate({ kind: "received", subject: "Hi", body: "  " })).toMatchObject({ ok: false });
      const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where action = 'recruiting.email_template_save' order by occurred_at desc limit 1`);
      expect(JSON.stringify(audit[0].metadata)).toBe(JSON.stringify({ kind: "received" }));

      expect(await actions.resetEmailTemplate({ kind: "received" })).toEqual({ ok: true, data: undefined });
      const again = `${uniq("tpl")}@example.com`;
      await apply(opening, { email: again });
      expect(await bodyOf((await appFor(opening, again))!, "received")).toContain("a member of our team will review it");
    } finally {
      await actions.resetEmailTemplate({ kind: "received" });
    }
    // only HR and Super Admin
    for (const u of [recruiter, lead, exec, employee]) {
      as(u);
      expect(await actions.saveEmailTemplate({ kind: "received", subject: "Hi", body: "Hello" })).toEqual({ ok: false, error: NO_ACCESS });
      await expect(queries.listEmailTemplates()).rejects.toThrow();
    }
  });

  it("sends the not-qualified wording when an application is closed as not qualified, and the rejection wording otherwise", async () => {
    const opening = await openJob(uniq("Close "));
    const a = `${uniq("nq")}@example.com`;
    const b = `${uniq("rj")}@example.com`;
    await apply(opening, { email: a });
    await apply(opening, { email: b });
    const [appA, appB] = [(await appFor(opening, a))!, (await appFor(opening, b))!];
    as(recruiter);
    await actions.rejectApplication({ applicationId: appA, kind: "not_qualified", reason: "Missing certification", notifyCandidate: true });
    await actions.rejectApplication({ applicationId: appB, kind: "rejected", reason: "Another candidate", notifyCandidate: true });
    expect(await bodyOf(appA, "rejection")).toContain("requirements for this role");
    expect(await bodyOf(appB, "rejection")).toContain("will not be moving forward");
    expect(await bodyOf(appA, "rejection")).not.toContain("Missing certification"); // the reason is internal only
  });
});

describe("recruiting report", () => {
  it("counts how far applications got, where they came from, how they ended and how long they waited, for one job", async () => {
    const opening = await openJob(uniq("Report "));
    const mails = [1, 2, 3].map((n) => `${uniq(`rep${n}-`)}@example.com`);
    await apply(opening, { email: mails[0], source: "linkedin" });
    await apply(opening, { email: mails[1], source: "linkedin" });
    await apply(opening, { email: mails[2] });
    const [a1, a2, a3] = await Promise.all(mails.map(async (m) => (await appFor(opening, m))!));
    as(recruiter);
    await actions.moveApplication({ applicationId: a2, to: "screening" });
    await actions.moveApplication({ applicationId: a2, to: "interview" });
    await actions.moveApplication({ applicationId: a3, to: "screening" });
    await actions.rejectApplication({ applicationId: a3, kind: "not_qualified", reason: "Missing certification" });
    // a1 has waited more than two weeks with no change
    await db.execute(sql`update talent.applications set stage_changed_at = now() - interval '20 days' where id = ${a1}`);

    const report = await queries.getRecruitingReport({ from: null, to: null, openingId: opening });
    expect(report.total).toBe(3);
    expect(report.funnel.map((f) => f.reached)).toEqual([3, 2, 1, 0, 0, 0]); // applied, screening (a2, a3), interview (a2)
    expect(report.funnel[1]).toMatchObject({ ofApplied: 67, ofPrevious: 67 });
    expect(report.closed).toEqual([{ kind: "not_qualified", n: 1 }]);
    expect(report.sources.find((s) => s.source === "linkedin")).toMatchObject({ total: 2, interviews: 1, hired: 0 });
    expect(report.sources.find((s) => s.source === null)).toMatchObject({ total: 1 });
    expect(report.timeInStage.find((t) => t.stage === "applied")).toMatchObject({ n: 3 });
    expect(report.stale).toEqual([expect.objectContaining({ openingId: opening, n: 1 })]);
    // a range with no applications is empty, and only HR, Super Admin and recruiters may read reports
    expect((await queries.getRecruitingReport({ from: "2000-01-01", to: "2000-01-31", openingId: opening })).total).toBe(0);
    for (const u of [lead, exec, employee]) {
      as(u);
      await expect(queries.getRecruitingReport({ from: null, to: null, openingId: null })).rejects.toThrow();
    }
  });
});
