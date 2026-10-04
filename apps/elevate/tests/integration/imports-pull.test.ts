import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import type { TalentHrApi, TalentHrDocument } from "@/modules/imports/talenthr-client";
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
function fakeApi(tag: string, docsFor: Record<number, { doc: Partial<TalentHrDocument>; bytes?: Uint8Array; error?: "too_large" | "download_failed" }[]>) {
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
      const b = bytesOf.get(doc.id);
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
      return [{ id: 1, job_position_title: "Scribe" }];
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
    expect(calls.every((c) => /^(directory|documents|budgets|requests):?/.test(c))).toBe(true);

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
