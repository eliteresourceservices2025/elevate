import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import type { TalentHrApi, TalentHrDocument, TalentHrJobApplicant, TalentHrJobPosition } from "@/modules/imports/talenthr-client";
import { fakeCompany, toCsv } from "../fixtures/talenthr-export";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// The TalentHR API pull, with a fake TalentHR (never the real API): documents become documents of the matched person, leave history and
// applicants are archived encrypted, a second run skips what is done, and the reconciliation counts the documents.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const actionsModule = await import("@/modules/imports/actions");
const service = await import("@/modules/imports/service");
const queries = await import("@/modules/imports/queries");
const { runPull, readArchive } = await import("@/modules/imports/pull");
const { parseCsv } = await import("@/modules/imports/csv");
const { defaultMapping } = await import("@/modules/imports/mapping");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const act = actionsModule as unknown as Record<string, (input: unknown) => Promise<{ ok: boolean; error?: string }>>;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]);

let hr: TestUser;
const fake = new FakeStorage();

async function makeHr(): Promise<TestUser> {
  const id = randomUUID();
  const email = `pullhr${Date.now().toString(36)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'hr_admin')`);
  return { id, email, roles: ["hr_admin"] };
}

/** A fake TalentHR holding these people (by tag) with these documents. Tracks calls so tests can check nothing was written to it. */
function fakeApi(tag: string, docsFor: Record<number, { doc: Partial<TalentHrDocument>; bytes?: Uint8Array; error?: "too_large" | "download_failed" }[]>, hiring: { positions: TalentHrJobPosition[]; applicants: Record<number, TalentHrJobApplicant[]>; cv: Record<string, Uint8Array> } = { positions: [], applicants: {}, cv: {} }) {
  const calls: string[] = [];
  const seed = Math.floor(Math.random() * 1_000_000) * 1_000_000; // source ids differ per test
  const directory = [1, 2, 3, 4, 5, 99].map((n) => ({ id: 5000 + n, first_name: `Test${n}`, last_name: `Person${n}`, email: n === 99 ? `${tag}.nobody@example.com` : `${tag}.person${n}@example.com`, termination_date: null }));
  const bytesOf = new Map<number, { bytes?: Uint8Array; error?: "too_large" | "download_failed" }>();
  const api: TalentHrApi = {
    async directory() {
      calls.push("directory");
      return directory;
    },
    async documents(id) {
      calls.push(`documents:${id}`);
      return (docsFor[id] ?? []).map((d, i) => {
        const doc = { id: seed + id * 100 + i, client_filename: `file-${i}.pdf`, filename: "x", filetype: "pdf", is_employee_file: true, url: `https://files.example/${id}/${i}`, deleted_at: null, ...d.doc } as TalentHrDocument;
        bytesOf.set(doc.id, { bytes: d.bytes, error: d.error });
        return doc;
      });
    },
    async downloadDocument(doc) {
      if (doc.url && hiring.cv[doc.url]) return { bytes: hiring.cv[doc.url] };
      const b = bytesOf.get(doc.id as number);
      if (b?.error) return { error: b.error };
      return b?.bytes ? { bytes: b.bytes } : { error: "download_failed" };
    },
    async timeOffBudgets(id) {
      calls.push(`budgets:${id}`);
      return id === 5002 ? [{ id: 1, employee_id: id, budget: "10", year: "2026", timeoff_type_name: "Vacation", timeoff_type_slug: "vacation", used_budget: "2", original_budget: "10", paid: true }] : [];
    },
    async timeOffRequests(id) {
      calls.push(`requests:${id}`);
      return id === 5002 ? [{ id: 9, approved: true, budget: "1", is_canceled: false, start_date: "2026-01-02", end_date: "2026-01-02", timeoff_type_name: "Vacation", timeoff_type_slug: "vacation" }] : [];
    },
    async jobPositions() {
      return hiring.positions;
    },
    async positionApplicants(id) {
      calls.push(`applicants:${id}`);
      return hiring.applicants[id] ?? [];
    },
    async application(_job, appId) {
      calls.push(`application:${appId}`);
      return { applicant_cv: hiring.cv[`https://files.example/cv/${appId}`] ? { cv_url: `https://files.example/cv/${appId}`, client_filename: "cv.pdf" } : null };
    },
    async applicants() {
      return [{ id: 1, first_name: "Closed", last_name: "Candidate", email: "closed@example.com" }];
    },
  };
  return { api, calls };
}

async function importPeople(tag: string) {
  const parsed = parseCsv(toCsv(fakeCompany(tag)));
  if ("error" in parsed) throw new Error(parsed.error);
  const staged = await service.stageBatch(hr, { fileName: "people.csv", headers: parsed.headers, rows: parsed.rows, mapping: defaultMapping(parsed.headers), dateFormat: "mdy" });
  current.user = hr;
  const res = await act.commitImport({ batchId: staged.batchId });
  if (!res.ok) throw new Error(res.error);
  return staged.batchId;
}

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeHr();
});

describe("the TalentHR pull", () => {
  it("imports documents for matched people, skips what it should, archives leave and applicants, and is safe to repeat", async () => {
    const tag = `pull${Date.now().toString(36)}`;
    const batchId = await importPeople(tag);
    const { api, calls } = fakeApi(tag, {
      5001: [{ doc: {}, bytes: PDF_BYTES }, { doc: {}, bytes: JPEG }],
      5002: [{ doc: {}, bytes: PDF_BYTES }, { doc: {}, bytes: EXE }, { doc: {}, error: "too_large" }, { doc: {}, error: "download_failed" }],
      5099: [{ doc: {}, bytes: PDF_BYTES }],
    });
    const first = await runPull(hr, api, { dryRun: false });
    expect(first.summary).toMatchObject({ people: 6, matched: 5, unmatched: 1, documentsFound: 6, documentsImported: 3, documentsSkipped: 2, documentsFailed: 1, leaveArchived: 1, applicantsArchived: 1 });

    const p1 = (await rows<{ id: string }>(sql`select id from core.employees where lower(work_email) = ${`${tag}.person1@example.com`}`))[0];
    const saved = await rows<{ mime_type: string; status: string; storage_bucket: string }>(sql`select d.mime_type, d.status, d.storage_bucket from docs.documents d where d.employee_id = ${p1.id}`);
    expect(saved).toHaveLength(2);
    expect(saved.every((d) => d.status === "active" && d.storage_bucket === "employee-docs")).toBe(true);
    expect(fake.objects.size).toBeGreaterThanOrEqual(3);
    // The person with an unmatched email got nothing, and nothing but GET-style reads reached TalentHR
    expect(calls.every((c) => /^(directory|documents|budgets|requests|applicants|application):?/.test(c))).toBe(true);

    // The archives are encrypted, and readable only through the decrypting helper
    const archived = await rows<{ source_id: string; payload_enc: string }>(sql`select source_id, payload_enc from ops.import_pull_items where kind = 'leave_history'`);
    const mine = archived.find((a) => a.source_id === "5002")!;
    expect(mine.payload_enc).not.toContain("Vacation");
    expect(JSON.stringify(readArchive("leave_history", "5002", mine.payload_enc))).toContain("Vacation");
    // Leave is NOT loaded into the ledger
    expect(await rows(sql`select 1 from time.leave_ledger where entry_type = 'opening_balance' and employee_id in (select id from core.employees where work_email like ${`${tag}.%`})`)).toHaveLength(0);

    // Running it again changes nothing
    const second = await runPull(hr, api, { dryRun: false });
    expect(second.summary).toMatchObject({ documentsImported: 0, leaveArchived: 0, applicantsArchived: 0 });
    expect((await rows(sql`select 1 from docs.documents d where d.employee_id = ${p1.id}`)).length).toBe(2);

    // The reconciliation now counts documents (skipped and failed ones are mismatches)
    const rec = await queries.getReconciliation(batchId);
    expect(rec.checks.find((c) => c.label.startsWith("Documents in TalentHR"))).toMatchObject({ expected: 6, actual: 3 });
    expect(rec.clean).toBe(false);
    expect(rec.notes.join(" ")).toMatch(/Leave histories archived.*1/);
  });

  it("does nothing in a dry run, and --only limits who is pulled", async () => {
    const tag = `dry${Date.now().toString(36)}`;
    await importPeople(tag);
    const { api } = fakeApi(tag, { 5001: [{ doc: {}, bytes: PDF_BYTES }], 5003: [{ doc: {}, bytes: PDF_BYTES }] });
    const before = (await rows<{ n: number }>(sql`select count(*)::int as n from ops.import_pull_items`))[0].n;
    const dry = await runPull(hr, api, { dryRun: true });
    expect(dry.summary.documentsImported).toBe(2);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from ops.import_pull_items`))[0].n).toBe(before);
    const one = await runPull(hr, api, { dryRun: false, onlyEmails: [`${tag}.person3@example.com`] });
    expect(one.summary).toMatchObject({ matched: 1, documentsImported: 1 });
  });
});

describe("loading active applicants into recruiting", () => {
  const steps = [
    { id: 1, name: "Applied", slug: "applied" },
    { id: 2, name: "Phone screen", slug: "phone-screen" },
    { id: 3, name: "Interview", slug: "interview" },
    { id: 4, name: "Hired", slug: "hired" },
    { id: 5, name: "Rejected", slug: "rejected" },
  ];
  const seed = Math.floor(Math.random() * 1_000_000) * 100; // source ids differ per run
  const person = (n: number, tag: string, step: number | null, extra: Partial<TalentHrJobApplicant["application"] & object> & { email?: string | null } = {}) => ({
    id: 900 + n,
    first_name: `Cand${n}`,
    last_name: "Applicant",
    email: extra.email === undefined ? `${tag}.cand${n}@example.com` : extra.email,
    phone: "+63 917 222 3333",
    application: { id: seed + 7000 + n, application_step_id: step, is_disqualified: extra.is_disqualified ?? false, deleted_at: null, description: "I would like to join.", created_at: "2026-09-01T10:00:00Z" },
  });

  it("creates a closed job, candidates, applications at the right stage and resumes, skips the finished ones, sends no email, and is safe to repeat", async () => {
    const tag = `cand${Date.now().toString(36)}`;
    const posId = 4000 + Math.floor(Math.random() * 1000);
    const hiring = {
      positions: [{ id: posId, job_position_title: `Scribe ${tag}`, job_description: "Chart notes for a clinic.", job_position_status_slug: "published", available_steps: steps }],
      applicants: { [posId]: [person(1, tag, 1), person(2, tag, 2), person(3, tag, 3), person(4, tag, 4), person(5, tag, 5), person(6, tag, 1, { is_disqualified: true }), person(7, tag, 1, { email: null })] },
      cv: { [`https://files.example/cv/${seed + 7002}`]: PDF_BYTES },
    };
    const { api } = fakeApi(tag, {}, hiring);
    const first = await runPull(hr, api, { dryRun: false });
    expect(first.summary).toMatchObject({ openingsCreated: 1, applicantsImported: 3, resumesImported: 1 });

    const [opening] = await rows<{ id: string; status: string; send_ack: boolean }>(sql`select id, status, send_ack from talent.job_openings where title = ${`Scribe ${tag}`}`);
    expect(opening).toMatchObject({ status: "closed", send_ack: false });
    const apps = await rows<{ stage: string; email: string; resume_path: string | null; consent: string }>(sql`
      select a.stage, c.email, c.resume_path, c.consent_notice_version as consent from talent.applications a join talent.candidates c on c.id = a.candidate_id where a.opening_id = ${opening.id} order by c.email`);
    expect(apps.map((a) => [a.email.replace(`${tag}.`, ""), a.stage])).toEqual([["cand1@example.com", "applied"], ["cand2@example.com", "screening"], ["cand3@example.com", "interview"]]);
    expect(apps.find((a) => a.email.includes("cand2"))?.resume_path).toMatch(/^resumes\/.+\.pdf$/);
    expect(apps.every((a) => a.consent === "talenthr-import")).toBe(true);
    // History records the import and the stage, and nothing was queued for the applicants
    expect(await rows(sql`select 1 from talent.application_stage_history h join talent.applications a on a.id = h.application_id where a.opening_id = ${opening.id}`)).toHaveLength(5);
    expect(await rows(sql`select 1 from talent.candidate_emails e join talent.applications a on a.id = e.application_id where a.opening_id = ${opening.id}`)).toHaveLength(0);

    const again = await runPull(hr, api, { dryRun: false });
    expect(again.summary).toMatchObject({ openingsCreated: 0, applicantsImported: 0 });
    expect(await rows(sql`select 1 from talent.applications where opening_id = ${opening.id}`)).toHaveLength(3);
  });

  it("keeps an existing candidate's own details, and does nothing in a dry run", async () => {
    const tag = `cdry${Date.now().toString(36)}`;
    const posId = 5000 + Math.floor(Math.random() * 1000);
    await db.execute(sql`insert into talent.candidates (email, full_name, phone, consent_notice_version) values (${`${tag}.cand11@example.com`}, 'Existing Name', '111', 'v1')`);
    const hiring = { positions: [{ id: posId, job_position_title: `Dry ${tag}`, available_steps: steps }], applicants: { [posId]: [person(11, tag, 2)] }, cv: {} };
    const { api } = fakeApi(tag, {}, hiring);
    const dry = await runPull(hr, api, { dryRun: true });
    expect(dry.summary).toMatchObject({ openingsCreated: 1, applicantsImported: 1 });
    expect(await rows(sql`select 1 from talent.job_openings where title = ${`Dry ${tag}`}`)).toHaveLength(0);
    await runPull(hr, api, { dryRun: false });
    const [c] = await rows<{ full_name: string; phone: string }>(sql`select full_name, phone from talent.candidates where lower(email) = ${`${tag}.cand11@example.com`}`);
    expect(c).toMatchObject({ full_name: "Existing Name", phone: "111" });
    expect(await rows(sql`select 1 from talent.applications a join talent.job_openings o on o.id = a.opening_id where o.title = ${`Dry ${tag}`}`)).toHaveLength(1);
  });
});

// The custom fields an import creates are removed again so other test files see only their own (the database is shared by the whole run)
afterAll(async () => {
  await db.execute(sql`delete from core.custom_field_values where field_def_id in (select id from core.custom_field_defs where key like 'imp\_%')`);
  await db.execute(sql`delete from core.custom_field_defs where key like 'imp\_%'`);
});
