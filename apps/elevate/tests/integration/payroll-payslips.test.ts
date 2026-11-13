import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: payslips, the /my-pay list, the PDF route and the "paid" notification. Invented names and figures only.
// Every period is a half month of 2029; each test uses its own period and its pay lines start and end inside it.

const current = vi.hoisted(() => ({ user: null as unknown, allow: true }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => current.allow) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, savePaySettings, createPayRun, cancelPayRun, savePayItem, dismissPayItem, submitRun, approveRun, markPaid } = await import("@/modules/payroll/actions");
const { releaseStatements } = await import("@/modules/payroll/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { listMyPayslips, countMyPayslips } = await import("@/modules/payroll/payslip-queries");
const { decryptRunLine } = await import("@/modules/payroll/service");
const { formatPesos } = await import("@/modules/payroll/money");
const { GET } = await import("@/app/api/payroll/payslips/[runId]/route");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let seq = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}x${seq++}`;

async function account(level: Level = null, roles: string[] = ["employee"]) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("slip")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: "x@example.com", roles, payrollAccess: level };
}
async function person(userId: string | null = null, last = uniq("Testreyes")) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Liza', ${last}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
/** Half month `n` of 2029. */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2029, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2029-${mm}-01`, periodEnd: `2029-${mm}-15` } : { periodStart: `2029-${mm}-16`, periodEnd: `2029-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};
async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}) {
  as(preparer);
  const r = await createPayLine({
    employeeId,
    hoursPerDay: 8,
    paymentMethod: "remitly",
    effectiveFrom: p.periodStart,
    endsOn: p.periodEnd,
    monthly: "22,000",
    ...over,
  });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }) {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
async function approvedRun(p: { periodStart: string; periodEnd: string }) {
  const runId = await newRun(p);
  as(preparer);
  const s = await submitRun({ runId });
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);
  as(approver);
  const a = await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! });
  if (!a.ok) throw new Error(`approve failed: ${a.error}`);
  return runId;
}
const today = () => "2029-12-30";
async function payAll(runId: string, employeeIds: string[]) {
  as(preparer);
  for (const employeeId of employeeIds) {
    const r = await markPaid({ runId, employeeId, reference: `RMT-SLIP-${uniq("r")}`, paidOn: today() });
    if (!r.ok) throw new Error(`pay failed: ${r.error}`);
  }
}
/** An Approver releases a run's statements to the people on it (the step that makes them visible). */
async function release(runId: string) {
  as(approver);
  const r = await releaseStatements({ runId });
  if (!r.ok) throw new Error(`release failed: ${r.error}`);
}
/** A paid and RELEASED run for the given people (each with one line), in period `p`. */
async function paidRun(p: { periodStart: string; periodEnd: string }, employeeIds: string[], over: Record<string, unknown> = {}) {
  for (const e of employeeIds) await giveLine(e, p, over);
  const runId = await approvedRun(p);
  await payAll(runId, employeeIds);
  await release(runId);
  return runId;
}
const call = (runId: string) => GET(new Request("http://localhost/api/payroll/payslips/x"), { params: Promise.resolve({ runId }) });
const netOf = async (runId: string, employeeId: string) =>
  (await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId}`)).reduce(
    (s, n) => s + decryptRunLine(n.id, n.payload_enc).result.net,
    0n,
  );
const slipNotices = (userId: string) => rows<{ title: string; body: string; link: string; kind: string }>(sql`select title, body, link, kind from ops.notifications where user_id = ${userId} and link = '/my-pay'`);

let preparer: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
afterAll(() => {
  vi.useRealTimers();
});

// The test periods are in 2029 and a payment can't be dated after today: only the clock (Date) is moved to the end of 2029, and it
// is restored after the file.
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2029-12-30T12:00:00Z") });
  preparer = await account("preparer");
  approver = await account("approver");
  as(preparer);
  const saved = await savePaySettings({
    cutoffDivisor: 11,
    changeWarnPercent: 10,
    extraRegular: "125",
    extraRestDay: "130",
    extraRestDayOver8: "169",
    reason: "Test rates",
    effectiveFrom: "2028-11-01",
  });
  expect(saved).toMatchObject({ ok: true });
});

describe("only a released run has a payslip", () => {
  it("lists nothing and answers 404 for a draft, in-review, approved-but-unpaid and cancelled run, and even a paid one, then lists it once released", async () => {
    const owner = await account();
    const emp = await person(owner.id);

    const draftP = slot(0);
    await giveLine(emp, draftP);
    const draft = await newRun(draftP);
    const reviewP = slot(1);
    await giveLine(emp, reviewP);
    const review = await newRun(reviewP);
    as(preparer);
    expect(await submitRun({ runId: review })).toMatchObject({ ok: true });
    const approvedP = slot(2);
    await giveLine(emp, approvedP);
    const approved = await approvedRun(approvedP);
    const cancelP = slot(3);
    await giveLine(emp, cancelP);
    const cancelled = await newRun(cancelP);
    as(preparer);
    expect(await cancelPayRun({ runId: cancelled, reason: "Pay lines changed" })).toMatchObject({ ok: true });

    as(owner);
    expect(await listMyPayslips()).toEqual([]);
    expect(await countMyPayslips()).toBe(0);
    const missing = await call(randomUUID());
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    for (const id of [draft, review, approved, cancelled]) {
      const r = await call(id);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(missingBody);
    }

    // Paid is not released: the person still sees nothing until an Approver releases the statements.
    await payAll(approved, [emp]);
    as(owner);
    expect(await listMyPayslips()).toEqual([]);
    expect(await countMyPayslips()).toBe(0);
    expect((await call(approved)).status).toBe(404);
    await release(approved);
    as(owner);
    const list = await listMyPayslips();
    expect(list).toHaveLength(1);
    expect(list[0].runId).toBe(approved);
    expect(list[0].periodLabel).toBe("2029-02-01 to 2029-02-15");
    expect(list[0].net).toBe(formatPesos(await netOf(approved, emp)));
    expect(await countMyPayslips()).toBe(1);
    expect((await call(approved)).status).toBe(200);
    expect((await call(draft)).status).toBe(404);
  });
});

describe("the payslip is the person's own", () => {
  it("answers 404 to another person's run for every role, including a Super Admin with a payroll level", async () => {
    const mine = await account();
    const myEmp = await person(mine.id);
    const theirs = await account();
    const theirEmp = await person(theirs.id);
    const runId = await paidRun(slot(4), [theirEmp]);
    await giveLine(myEmp, slot(5));

    const intruders = [
      { ...(await account("approver")), roles: ["super_admin"] },
      { ...(await account("preparer")), roles: ["hr_admin"] },
      { ...(await account()), roles: ["team_lead"] },
      { ...(await account()), roles: ["recruiter"] },
      { ...(await account()), roles: ["executive"] },
      mine,
    ];
    for (const who of intruders) {
      as(who);
      expect((await call(runId)).status).toBe(404);
      expect((await listMyPayslips()).filter((x) => x.runId === runId)).toEqual([]);
    }
    as(theirs);
    expect((await call(runId)).status).toBe(200);
  });

  it("gives a two-line person one payslip with both lines, and the total", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const p = slot(6);
    await giveLine(emp, p, { alias: "Front desk" });
    await giveLine(emp, p, { alias: "*Billing*", monthly: "10,000" });
    // A second person on the same run, with a recognizable name, alias and amount.
    const second = await account();
    const secondEmp = await person(second.id, "Zzsecretlast");
    await giveLine(secondEmp, p, { alias: "Zzsecretalias", monthly: "31,415.92" });
    const runId = await approvedRun(p);
    await payAll(runId, [emp, secondEmp]);
    await release(runId);
    as(owner);
    const list = await listMyPayslips();
    expect(list).toHaveLength(1);
    expect(list[0].net).toBe(formatPesos(await netOf(runId, emp)));
    expect((await rows(sql`select 1 from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`)).length).toBe(2);
    const { getMyPayslip } = await import("@/modules/payroll/payslip-queries");
    const { payslipView } = await import("@/modules/payroll/payslip");
    const slip = await getMyPayslip(owner as never, runId);
    expect(slip?.lines).toHaveLength(2);
    const md = JSON.stringify(payslipView(slip!));
    expect(md).not.toMatch(/Zzsecret/);
    expect(md).not.toContain(formatPesos(await netOf(runId, secondEmp)));
    expect(md).toContain(formatPesos(await netOf(runId, emp)));
    // The second person sees only their own line.
    as(second);
    expect((await getMyPayslip(second as never, runId))!.lines).toHaveLength(1);
  });

  it("gives a signed-in user with no people record an empty list and a 404", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(15), [emp]);
    const nobody = await account();
    as(nobody);
    expect(await listMyPayslips()).toEqual([]);
    expect(await countMyPayslips()).toBe(0);
    const r = await call(runId);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${nobody.id}`)).toHaveLength(0);
  });

  it("audits a list view against the viewer's own people record, with no amount", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(16), [emp]);
    as(owner);
    await listMyPayslips();
    const audit = await rows<{ target_id: string; metadata: unknown }>(sql`select target_id, metadata from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].target_id).toBe(emp);
    expect(JSON.stringify(audit)).not.toContain(formatPesos(await netOf(runId, emp)));
  });

  it("pages the list, newest period first", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const ids: string[] = [];
    for (const n of [7, 8, 9]) ids.push(await paidRun(slot(n), [emp]));
    as(owner);
    const first = await listMyPayslips({ page: 1, pageSize: 2 });
    const second = await listMyPayslips({ page: 2, pageSize: 2 });
    expect(first.map((x) => x.runId)).toEqual([ids[2], ids[1]]);
    expect(second.map((x) => x.runId)).toEqual([ids[0]]);
    expect(await countMyPayslips()).toBe(3);
  });
});

describe("the PDF", () => {
  it("is a private, uncached PDF, audited with the run id only and logged as a download", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(10), [emp]);
    as(owner);
    const r = await call(runId);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    const audit = await rows<{ metadata: unknown; target_id: string }>(sql`select metadata, target_id from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].target_id).toBe(runId);
    const net = formatPesos(await netOf(runId, emp));
    expect(JSON.stringify(audit)).not.toContain(net);
    expect(JSON.stringify(audit)).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
    const log = await rows<{ employee_id: string }>(sql`select employee_id from payroll.pay_change_log where run_id = ${runId} and action = 'payslip_downloaded' and actor_id = ${owner.id}`);
    expect(log).toHaveLength(1);
    expect(log[0].employee_id).toBe(emp);
  });

  it("is rate limited, and leaves nothing behind when refused", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(11), [emp]);
    as(owner);
    current.allow = false;
    try {
      const r = await call(runId);
      expect(r.status).toBe(429);
    } finally {
      current.allow = true;
    }
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'payslip_downloaded'`)).toHaveLength(0);
  });

  it("gives a clean error, with no audit row, when a line can't be read", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(12), [emp]);
    // Break one line's ciphertext the only way possible: as the database owner, with the freeze trigger switched off for the statement.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update payroll.pay_run_lines set payload_enc = 'garbage' where run_id = ${runId}`);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      as(owner);
      const r = await call(runId);
      expect(r.status).toBe(500);
      const text = await r.text();
      expect(text).toMatch(/can't be read/i);
      expect(text).not.toMatch(/Error|stack|at /);
      expect(r.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("private, no-store");
      expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`)).toHaveLength(0);
      const list = await listMyPayslips();
      expect(list.find((x) => x.runId === runId)!.net).toBe("Can't be read");
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).not.toContain("garbage");
    } finally {
      errors.mockRestore();
    }
  });
});

describe("the notification when a run is released", () => {
  it("goes to each linked person with a link and no amount, only when the statements are released, and marking paid works for a person with no account", async () => {
    const a = await account();
    const b = await account();
    const empA = await person(a.id);
    const empB = await person(b.id);
    const noAccount = await person(null);
    const p = slot(13);
    for (const e of [empA, empB, noAccount]) await giveLine(e, p);
    const runId = await approvedRun(p);

    as(preparer);
    expect(await markPaid({ runId, employeeId: empA, reference: "RMT-N-1", paidOn: today() })).toMatchObject({ ok: true });
    expect(await markPaid({ runId, employeeId: empB, reference: "RMT-N-2", paidOn: today() })).toMatchObject({ ok: true });
    expect(await slipNotices(a.id)).toHaveLength(0); // not paid until everyone is
    const last = await markPaid({ runId, employeeId: noAccount, reference: "RMT-N-3", paidOn: today() });
    expect(last).toEqual({ ok: true, data: { runPaid: true } });
    expect(await slipNotices(a.id)).toHaveLength(0); // paid is not released: nobody is told yet
    await release(runId);

    for (const [u, e] of [[a, empA], [b, empB]] as const) {
      const n = await slipNotices(u.id);
      expect(n).toHaveLength(1);
      expect(n[0].link).toBe("/my-pay");
      const text = `${n[0].title} ${n[0].body}`;
      expect(text).not.toMatch(/\d/);
      expect(text).not.toContain(formatPesos(await netOf(runId, e)));
      expect(text).not.toMatch(/overtime|pto/i);
    }
    // A correction after the run is paid sends nothing more, and a second release is refused.
    as(preparer);
    expect(await markPaid({ runId, employeeId: empA, reference: "RMT-N-9", paidOn: today() })).toMatchObject({ ok: true });
    as(approver);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: false, error: expect.stringMatching(/already been released|released/i) });
    expect(await slipNotices(a.id)).toHaveLength(1);
  });

  it("skips an archived account", async () => {
    const live = await account();
    const gone = await account();
    const empLive = await person(live.id);
    const empGone = await person(gone.id);
    await db.execute(sql`update core.users set archived_at = now() where id = ${gone.id}`);
    const runId = await paidRun(slot(17), [empLive, empGone]);
    expect(await slipNotices(live.id)).toHaveLength(1);
    expect(await slipNotices(gone.id)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.pay_runs where id = ${runId} and status = 'paid'`)).toHaveLength(1);
  });

  it("goes once to a person with two lines", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const p = slot(14);
    await giveLine(emp, p, { alias: "One" });
    await giveLine(emp, p, { alias: "Two" });
    const runId = await approvedRun(p);
    await payAll(runId, [emp]);
    await release(runId);
    expect(await slipNotices(owner.id)).toHaveLength(1);
  });
});

// ---- who signs the payslips ----
// Nobody is set when this file starts (the database is new for every run and only these tests set a signatory), so the first test sees a run
// paid before anyone was set. Slots 18 to 21 of 2029 are used here.

const { savePayrollSignatory } = await import("@/modules/settings/actions");
const { getMyPayslip } = await import("@/modules/payroll/payslip-queries");
const { payslipView } = await import("@/modules/payroll/payslip");
const { currentSignatory } = await import("@/modules/payroll/signatory");
const { readChangeDetail } = await import("@/modules/payroll/changes");

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
/** A tiny structurally valid JPEG with fake camera and location data in it (the server reads structure and removes metadata). */
function jpegBase64(width = 300, height = 100): string {
  const bytes = [
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
    ...seg(0xe1, [...Buffer.from("Exif\0\0GPS-secret-location")]),
    ...seg(0xdb, [0, ...new Array<number>(64).fill(8)]),
    ...seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xc4, [0, 1, ...new Array<number>(15).fill(0), 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,
    0xff, 0xd9,
  ];
  return Buffer.from(bytes).toString("base64");
}
const refused = { ok: false, error: "You do not have access to do that." };

describe("the signatory on payslips", () => {
  let superAdmin: Awaited<ReturnType<typeof account>>;
  beforeAll(async () => {
    superAdmin = await account(null, ["super_admin"]);
  });
  const input = { name: "Carmen Dela Rosa", title: "Human Resources Director", signature: jpegBase64(), removeSignature: false };

  it("says Not signed on the payslip of a run paid before anybody was set up", async () => {
    expect(await rows(sql`select 1 from payroll.pay_signatory`)).toHaveLength(0);
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(18), [emp]);
    expect(await rows(sql`select 1 from payroll.pay_run_signatures where run_id = ${runId}`)).toHaveLength(0);
    as(owner);
    const slip = await getMyPayslip(owner as never, runId);
    expect(slip?.signatory).toBeNull();
    expect(payslipView(slip!).signature).toBeNull();
    expect((await call(runId)).status).toBe(200);
  });

  it("lets only a Super Admin set it, and refuses a picture that is not a small JPEG", async () => {
    const hr = await account(null, ["hr_admin"]);
    for (const who of [hr, preparer, approver, await account()]) {
      as(who);
      expect(await savePayrollSignatory(input)).toEqual(refused);
    }
    as(superAdmin);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(40).fill(0)]).toString("base64");
    const huge = Buffer.concat([Buffer.from(jpegBase64(), "base64"), Buffer.alloc(160 * 1024)]).toString("base64");
    for (const signature of [png, huge, "not base64!!", Buffer.from("hello").toString("base64"), jpegBase64(20, 20)]) {
      expect(await savePayrollSignatory({ ...input, signature }), signature.slice(0, 12)).toMatchObject({ ok: false });
    }
    expect(await savePayrollSignatory({ ...input, name: "   " })).toMatchObject({ ok: false });
    expect(await savePayrollSignatory({ ...input, title: "" })).toMatchObject({ ok: false });
    expect(await rows(sql`select 1 from payroll.pay_signatory`)).toHaveLength(0);
  });

  it("keeps the signature private and clean, and the audit log never holds the name, title or picture", async () => {
    as(superAdmin);
    expect(await savePayrollSignatory(input)).toEqual({ ok: true, data: undefined });
    const [row] = await rows<{ signature_enc: string }>(sql`select signature_enc from payroll.pay_signatory order by created_at desc limit 1`);
    expect(row.signature_enc).not.toContain(jpegBase64().slice(0, 24));
    const current = await currentSignatory(db);
    expect(current).toMatchObject({ name: "Carmen Dela Rosa", title: "Human Resources Director", signatureUnreadable: false });
    const bytes = Buffer.from(current!.signatureBase64!, "base64");
    expect(bytes.includes(Buffer.from("GPS-secret-location"))).toBe(false);
    expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    const [audit] = await rows<{ j: unknown }>(sql`select to_jsonb(a) as j from ops.audit_log a where action = 'payroll.signatory.update' order by id desc limit 1`);
    const text = JSON.stringify(audit.j);
    expect(text).toContain("hasSignature");
    expect(text).not.toMatch(/Carmen|Dela Rosa|Human Resources|GPS-secret|\/9j\//);
    // The payroll change history records it too (detail encrypted, the picture never copied into it).
    const [change] = await rows<{ id: string; actor_id: string; detail_enc: string }>(
      sql`select id, actor_id, detail_enc from payroll.pay_change_log where action = 'signatory_changed' and actor_id = ${superAdmin.id} order by created_at desc limit 1`,
    );
    expect(change).toBeTruthy();
    expect(change.detail_enc).not.toMatch(/Carmen|Dela Rosa/);
    const detail = readChangeDetail(change);
    expect(detail).toMatchObject({ new: { name: "Carmen Dela Rosa", title: "Human Resources Director", hasSignature: true }, signatureChanged: true });
    expect(JSON.stringify(detail)).not.toMatch(/\/9j\//);
    await expect(db.execute(sql`update payroll.pay_signatory set name = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payroll.pay_signatory`)).rejects.toThrow();
  });

  it("keeps on each payslip the signatory in force when its run was paid", async () => {
    const first = await account();
    const second = await account();
    const third = await account();
    const [e1, e2, e3] = [await person(first.id), await person(second.id), await person(third.id)];

    const run1 = await paidRun(slot(19), [e1]); // paid under Carmen, with her picture
    as(superAdmin);
    expect(await savePayrollSignatory({ name: "Elena Marquez", title: "Director of People", signature: null, removeSignature: false })).toMatchObject({ ok: true });
    const run2 = await paidRun(slot(20), [e2]); // paid under Elena, who keeps the picture saved before
    as(superAdmin);
    expect(await savePayrollSignatory({ name: "Elena Marquez", title: "Director of People", signature: null, removeSignature: true })).toMatchObject({ ok: true });
    const run3 = await paidRun(slot(21), [e3]); // paid under Elena with no picture

    const view = async (who: { id: string }, runId: string) => {
      as(who);
      return payslipView((await getMyPayslip(who as never, runId))!).signature;
    };
    expect(await view(first, run1)).toMatchObject({ name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-12-30" });
    expect((await view(first, run1))?.imageBase64).toBeTruthy();
    expect(await view(second, run2)).toMatchObject({ name: "Elena Marquez", title: "Director of People" });
    expect((await view(second, run2))?.imageBase64).toBeTruthy();
    expect(await view(third, run3)).toMatchObject({ name: "Elena Marquez", imageBase64: null });
    // Later changes never touch a payslip that was already made: the first one still says Carmen.
    expect((await view(first, run1))?.name).toBe("Carmen Dela Rosa");

    // The PDF draws with and without a picture.
    for (const [who, runId] of [[first, run1], [third, run3]] as const) {
      as(who);
      const res = await call(runId);
      expect(res.status).toBe(200);
      expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    }
    expect(await rows(sql`select 1 from payroll.pay_run_signatures where run_id in (${run1}, ${run2}, ${run3})`)).toHaveLength(3);
  });
});

describe("the Contractor Payment Statement lists every named line", () => {
  it("shows several named allowances, a reimbursement, a bonus and an adjustment, each under its own name, with the right totals, and a removed line is gone", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const p = slot(22);
    await giveLine(emp, p); // 22,000 a month: 11,000.00 for the cutoff
    const runId = await newRun(p);
    const [line] = await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`);
    as(preparer);
    const add = async (type: string, label: string, value: string) => {
      const r = await savePayItem({ runId, employeeId: emp, runLineId: line.id, type, label, value });
      if (!r.ok) throw new Error(`item failed: ${r.error}`);
    };
    await add("allowance", "Health allowance", "1,000");
    await add("allowance", "Internet allowance", "500");
    await add("allowance", "Hazard fee", "300");
    await add("reimbursement", "Supplies", "250.50");
    await add("bonus", "Performance bonus", "2,000");
    await add("adjustment", "Correction of an earlier payment", "75");

    // Remove one named allowance by its item id: only that line goes.
    const hazard = (await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and type = 'allowance' and state = 'confirmed' order by created_at`))[2];
    expect(await dismissPayItem({ runId, itemId: hazard.id })).toMatchObject({ ok: true });

    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    as(approver);
    const a = await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! });
    expect(a).toMatchObject({ ok: true });
    await payAll(runId, [emp]);
    await release(runId);

    // 11,000.00 + 1,500.00 allowances = 12,500.00 gross; plus 250.50, 2,000.00 and 75.00 = 14,825.50 total payable compensation.
    const [row] = await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`);
    const result = decryptRunLine(row.id, row.payload_enc).result;
    expect(result).toMatchObject({ allowances: 150_000n, reimbursements: 25_050n, bonuses: 200_000n, adjustments: 7_500n, gross: 1_250_000n, net: 1_482_550n });

    as(owner);
    const { getMyPayslip } = await import("@/modules/payroll/payslip-queries");
    const { payslipView } = await import("@/modules/payroll/payslip");
    const view = payslipView((await getMyPayslip(owner as never, runId))!);
    expect(view.lines).toHaveLength(1);
    const v = view.lines[0];
    expect(v.compensation.filter((r) => r.detail === "Allowance")).toEqual([
      { label: "Health allowance", detail: "Allowance", amount: formatPesos(100_000n) },
      { label: "Internet allowance", detail: "Allowance", amount: formatPesos(50_000n) },
    ]);
    expect(JSON.stringify(view)).not.toContain("Hazard fee");
    expect(v.compensation.filter((r) => r.detail === "Reimbursement")).toEqual([{ label: "Supplies", detail: "Reimbursement", amount: formatPesos(25_050n) }]);
    expect(v.compensation.filter((r) => r.detail === "Bonus")).toEqual([{ label: "Performance bonus", detail: "Bonus", amount: formatPesos(200_000n) }]);
    expect(v.compensation.filter((r) => r.detail === "Adjustment")).toEqual([{ label: "Correction of an earlier payment", detail: "Adjustment", amount: formatPesos(7_500n) }]);
    // Every kind that has no line still shows, with a dash; the totals add up to the total payable.
    expect(v.deductions.every((r) => r.amount === "-")).toBe(true);
    expect(v.totalCompensation).toBe(formatPesos(1_482_550n));
    expect(v.totalDeductions).toBe("0.00");
    expect(view.hiredOn === null || /^d{4}-d{2}-d{2}$/.test(view.hiredOn)).toBe(true);
    expect(v.net).toBe(formatPesos(1_482_550n));
    expect(view.title).toBe("Contractor Payment Statement");
    expect((await listMyPayslips()).find((x) => x.runId === runId)!.net).toBe(formatPesos(1_482_550n));

    const res = await call(runId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(`contractor-payment-statement-${p.periodStart}-to-${p.periodEnd}.pdf`);
  });
});
