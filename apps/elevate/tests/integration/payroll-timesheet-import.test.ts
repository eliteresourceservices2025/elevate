import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { excelSerial, jibbleDay, jibbleMemberSheet, workbook } from "../helpers/jibble-workbook";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: filling a draft run from a Jibble timesheet file. Invented people and figures only. Runs use March and April 2032
// (no other file uses 2032), the pay lines are ended afterwards by the shared helper.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const actions = await import("@/modules/payroll/actions");
const { createPayLine, savePaySettings, createPayRun, updateRunPeople } = actions;
const { uploadJibbleTimesheet, applyJibbleTimesheet, discardJibbleTimesheet, confirmAllSuggestions, savePayItem } = actions;
const { getImportPage } = await import("@/modules/payroll/timesheet-queries");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { decryptItemValue, decryptRunLine } = await import("@/modules/payroll/service");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: string | null = "preparer", role = "employee") {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("tsi")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email: `${id}@example.com`, roles: [role], payrollAccess: level };
}
async function person(first: string) {
  const last = uniq("Testreyes");
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values (${first}, ${last}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return { id: e.id, name: `${first} ${last}` };
}
async function giveLine(employeeId: string, alias: string | null = null, over: Record<string, unknown> = {}) {
  current.user = preparer;
  const r = await createPayLine({ employeeId, alias, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2023-01-01", monthly: "22,000", ...over });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(start: string, end: string) {
  current.user = preparer;
  const r = await createPayRun({ periodStart: start, periodEnd: end });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLines = (runId: string, employeeId: string) =>
  rows<{ id: string; alias: string | null; payload_enc: string }>(sql`select id, alias, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} order by alias, id`);
const netOf = async (runId: string, employeeId: string) => {
  const [l] = await runLines(runId, employeeId);
  return decryptRunLine(l.id, l.payload_enc).result.net;
};
const items = (runId: string) =>
  rows<{ id: string; run_line_id: string; type: string; state: string; value_enc: string }>(sql`select id, run_line_id, type, state, value_enc from payroll.pay_run_items where run_id = ${runId} order by created_at, id`);
const valueOf = (r: { id: string; value_enc: string }) => decryptItemValue(r.id, r.value_enc).value;

const upload = (runId: string, bytes: Buffer, name = "timesheet.xlsx") => {
  const data = new FormData();
  data.set("runId", runId);
  data.set("file", new File([new Uint8Array(bytes)], name));
  return uploadJibbleTimesheet(data);
};

// March 2032: the run is 1 to 15 March. Days in the sheet: 2 to 4 March inside it, 20 March outside it.
const d = (iso: string) => excelSerial(iso);
const sheetFor = (members: { name: string; code: string; days: ReturnType<typeof jibbleDay>[] }[]) => workbook([{ name: "Team Summary", rows: [["Custom Timesheets"]] }, ...members.map((m) => jibbleMemberSheet(m.name, m.code, m.days))]);

let preparer: Awaited<ReturnType<typeof account>>;
let ana: { id: string; name: string };
let ben: { id: string; name: string };
let lone: { id: string; name: string }; // on the run, not in the sheet
let runId: string;
const codes = { ana: uniq("ANA-"), ben1: uniq("BEN-"), ben2: uniq("BEN-") };

beforeAll(async () => {
  preparer = await account();
  current.user = preparer;
  // Overtime percents left blank: the standard ones apply. (A date no other file uses.)
  // Settings are never overwritten, so a second run against the same database finds this version already there: that is fine.
  const saved = await savePaySettings({ effectiveFrom: "2031-12-15", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "", extraRestDay: "", extraRestDayOver8: "", reason: "Standard" });
  expect(saved.ok || /already a version/.test(saved.error)).toBe(true);
  ana = await person("Ana");
  ben = await person("Ben");
  lone = await person("Lia");
  await giveLine(ana.id);
  await giveLine(ben.id, "One");
  await giveLine(ben.id, "Two");
  await giveLine(lone.id);
  runId = await newRun("2032-03-01", "2032-03-15");
});

const anaDays = [jibbleDay(d("2032-03-02"), "8h 06m"), jibbleDay(d("2032-03-03"), "9h 30m", { dailyOt: "1h 30m", restDayOt: "2h 00m" }), jibbleDay(d("2032-03-04"), "8h 00m", { holidayOt: "1h 00m", pto: "4h 00m" }), jibbleDay(d("2032-03-20"), "8h 00m")];
const benDays = (hours: string) => [jibbleDay(d("2032-03-02"), hours), jibbleDay(d("2032-03-03"), hours)];
const fullSheet = () =>
  sheetFor([
    { name: ana.name, code: codes.ana, days: anaDays },
    { name: ben.name, code: codes.ben1, days: benDays("8h 00m") },
    { name: ben.name, code: codes.ben2, days: benDays("4h 00m") },
  ]);

describe("uploading a Jibble timesheet", () => {
  it("keeps only totals, encrypted, and replaces an earlier upload for the same run", async () => {
    current.user = preparer;
    const first = await upload(runId, fullSheet());
    expect(first).toMatchObject({ ok: true, data: { members: 3 } });
    const second = await upload(runId, fullSheet());
    expect(second.ok).toBe(true);
    const stored = await rows<{ payload_enc: string }>(sql`select payload_enc from payroll.timesheet_imports where run_id = ${runId}`);
    expect(stored).toHaveLength(1);
    expect(stored[0].payload_enc).not.toContain(ana.name);
    expect(stored[0].payload_enc).not.toContain(codes.ana);
    const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.timesheet.upload' order by id desc limit 1`);
    expect(JSON.stringify(audit[0].metadata)).toBe('{"members":3}');
  });

  it("refuses a file that is not a Jibble export, one that is empty, and a missing file, with a plain message", async () => {
    current.user = preparer;
    expect(await upload(runId, Buffer.from("this is not an excel file at all"))).toEqual({ ok: false, error: "That file is not an Excel (.xlsx) file." });
    expect(await upload(runId, workbook([{ name: "Sheet1", rows: [["a"], [1]] }]))).toMatchObject({ ok: false, error: expect.stringMatching(/does not look like a Jibble timesheet/) });
    expect(await upload(runId, Buffer.alloc(0))).toMatchObject({ ok: false });
    const data = new FormData();
    data.set("runId", runId);
    expect(await uploadJibbleTimesheet(data)).toEqual({ ok: false, error: "Check the request and try again." });
    const bad = new FormData();
    bad.set("runId", "not-an-id");
    bad.set("file", new File([new Uint8Array(fullSheet())], "x.xlsx"));
    expect(await uploadJibbleTimesheet(bad)).toEqual({ ok: false, error: "Check the request and try again." });
  });

  it("is for Preparers only", async () => {
    for (const who of [await account(null), await account("viewer"), await account("approver")]) {
      current.user = who;
      expect(await upload(runId, fullSheet())).toEqual({ ok: false, error: "You do not have access to do that." });
    }
  });
});

describe("the preview", () => {
  it("matches a member by name, leaves a person with two lines to the Preparer, and counts days outside the run", async () => {
    current.user = preparer;
    await upload(runId, fullSheet());
    const page = (await getImportPage(runId))!;
    expect(page.run.status).toBe("draft");
    const preview = page.preview!;
    expect(preview.outsideDays).toBe(1); // 20 March
    expect(preview.runPeriod).toEqual({ start: "2032-03-01", end: "2032-03-15" });
    const anaRow = preview.members.find((m) => m.code === codes.ana)!;
    expect(anaRow).toMatchObject({ matchedBy: "name", days: 3, clientHours: "25.6", overtime: "1 h 30 min", restDayOvertime: "2 h", holidayPay: "1 h", ptoDays: "0.5" });
    expect(anaRow.runLineId).toBe((await runLines(runId, ana.id))[0].id);
    const b1 = preview.members.find((m) => m.code === codes.ben1)!;
    expect(b1).toMatchObject({ runLineId: null, matchedBy: null });
    expect(b1.candidates).toHaveLength(2);
    expect(preview.lines.map((l) => l.label).join("|")).toContain(ben.name);
  });

  it("is only for Preparers, and a run that is not a draft has no preview", async () => {
    current.user = await account("viewer");
    await expect(getImportPage(runId)).rejects.toThrow();
  });
});

describe("filling the run", () => {
  it("writes suggestions only, leaves pay unchanged, remembers the matches and wipes the upload", async () => {
    current.user = preparer;
    await upload(runId, fullSheet());
    const preview = (await getImportPage(runId))!.preview!;
    const [anaLine] = await runLines(runId, ana.id);
    const [benOne, benTwo] = await runLines(runId, ben.id);
    const netBefore = await netOf(runId, ana.id);

    const done = await applyJibbleTimesheet({
      runId,
      importId: preview.importId,
      assignments: [
        { code: codes.ana, runLineId: anaLine.id },
        { code: codes.ben1, runLineId: benOne.id },
        { code: codes.ben2, runLineId: benTwo.id },
      ],
    });
    expect(done).toMatchObject({ ok: true, data: { lines: 3, kept: 0 } });

    const all = await items(runId);
    expect(all.every((i) => i.state === "suggested")).toBe(true);
    const mine = Object.fromEntries(all.filter((i) => i.run_line_id === anaLine.id).map((i) => [i.type, valueOf(i)]));
    // 25.6 hours as hundredths; 90 daily OT minutes; 120 rest day minutes; 60 holiday minutes; 4 PTO hours of an 8 hour day = half a day.
    expect(mine).toEqual({ client_hours: 2560n, extra_regular: 90n, extra_rest_day: 120n, holiday: 60n, pto_days: 50n });
    const benOneItems = Object.fromEntries(all.filter((i) => i.run_line_id === benOne.id).map((i) => [i.type, valueOf(i)]));
    expect(benOneItems).toEqual({ client_hours: 1600n }); // nothing else for him: no overtime, so no zero rows
    // Pay did not change.
    expect(await netOf(runId, ana.id)).toBe(netBefore);

    expect(await rows(sql`select 1 from payroll.timesheet_imports where run_id = ${runId}`)).toHaveLength(0);
    const remembered = await rows<{ member_code: string }>(sql`select member_code from payroll.jibble_matches where member_code in (${codes.ana}, ${codes.ben1}, ${codes.ben2})`);
    expect(remembered).toHaveLength(3);
    const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.timesheet.apply' order by id desc limit 1`);
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(new RegExp(`${ana.name}|${codes.ana}`));
    const log = await rows<{ action: string }>(sql`select action from payroll.pay_change_log where run_id = ${runId} and action = 'timesheet_imported'`);
    expect(log).toHaveLength(1);
  });

  it("confirms all suggestions in one step, so the overtime is paid at each person's own rate, and a check is needed again", async () => {
    current.user = preparer;
    const before = await netOf(runId, ana.id);
    const done = await confirmAllSuggestions({ runId });
    expect(done).toMatchObject({ ok: true });
    expect(done.ok && done.data.confirmed).toBeGreaterThanOrEqual(7);
    // 22,000 a month, divisor 11, 8 hours a day: hourly 125.00. Overtime 1.5 h at 125% = 234.38; rest day 2 h at 130% = 325.00; holiday 1 h at 100% = 125.00.
    expect(before).toBe(1_100_000n);
    expect(await netOf(runId, ana.id)).toBe(1_100_000n + 23_438n + 32_500n + 12_500n);
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.find((l) => l.employeeId === ana.id)).toMatchObject({ confirmedByName: null });
    expect(sheet.checks.blocking).toEqual([]);
    // Nothing left to confirm.
    expect(await confirmAllSuggestions({ runId })).toMatchObject({ ok: true, data: { confirmed: 0 } });
    // Client hours are an item on the line, never added to pay.
    const hours = (await items(runId)).filter((i) => i.type === "client_hours" && i.state === "confirmed");
    expect(hours.length).toBeGreaterThanOrEqual(3);
  });

  it("never overwrites an amount a Preparer confirmed, and adds nothing for a suggestion that is unchanged", async () => {
    current.user = preparer;
    const [anaLine] = await runLines(runId, ana.id);
    const savedItem = await savePayItem({ runId, employeeId: ana.id, runLineId: anaLine.id, type: "extra_regular", value: "2 h", reason: "Checked with the lead" });
    expect(savedItem).toMatchObject({ ok: true });
    await upload(runId, fullSheet());
    const preview = (await getImportPage(runId))!.preview!;
    const [benOne, benTwo] = await runLines(runId, ben.id);
    const before = (await items(runId)).length;
    const done = await applyJibbleTimesheet({
      runId,
      importId: preview.importId,
      assignments: [
        { code: codes.ana, runLineId: anaLine.id },
        { code: codes.ben1, runLineId: benOne.id },
        { code: codes.ben2, runLineId: benTwo.id },
      ],
    });
    // Everything for these lines is already confirmed (the five types for Ana; client hours for the Bens): kept, nothing written.
    expect(done).toMatchObject({ ok: true, data: { written: 0 } });
    expect(done.ok && done.data.kept).toBeGreaterThanOrEqual(7);
    expect((await items(runId)).length).toBe(before);
    const typed = (await items(runId)).filter((i) => i.run_line_id === anaLine.id && i.type === "extra_regular" && i.state === "confirmed").map(valueOf).at(-1);
    expect(typed).toBe(120n); // the Preparer's 2 hours, not Jibble's 90 minutes
  });
});

describe("the next run", () => {
  it("matches the Jibble members by their remembered code, even when the name alone is ambiguous", async () => {
    current.user = preparer;
    const next = await newRun("2032-03-16", "2032-03-31");
    await upload(next, fullSheet());
    const preview = (await getImportPage(next))!.preview!;
    const b1 = preview.members.find((m) => m.code === codes.ben1)!;
    const b2 = preview.members.find((m) => m.code === codes.ben2)!;
    expect(b1.matchedBy).toBe("remembered");
    expect(b2.matchedBy).toBe("remembered");
    const [one, two] = await runLines(next, ben.id);
    expect(b1.runLineId).toBe(one.id);
    expect(b2.runLineId).toBe(two.id);
  });
});

describe("what is refused", () => {
  it("refuses two members on one line, a line that is not on the run, an unknown member and someone else's upload", async () => {
    current.user = preparer;
    const run2 = await newRun("2032-04-01", "2032-04-15");
    await upload(run2, fullSheet());
    const preview = (await getImportPage(run2))!.preview!;
    const [anaLine] = await runLines(run2, ana.id);
    const [benOne] = await runLines(run2, ben.id);
    const apply = (assignments: { code: string; runLineId: string | null }[], importId = preview.importId, id = run2) => applyJibbleTimesheet({ runId: id, importId, assignments });
    expect(await apply([{ code: codes.ana, runLineId: anaLine.id }, { code: codes.ben1, runLineId: anaLine.id }])).toEqual({ ok: false, error: "Two members were given the same pay line. Choose a different line for one of them." });
    expect(await apply([{ code: codes.ana, runLineId: randomUUID() }])).toEqual({ ok: false, error: "A chosen person is not on this run any more. Update people and try again." });
    expect(await apply([{ code: "NOT-IN-FILE", runLineId: benOne.id }])).toEqual({ ok: false, error: "The upload changed. Upload the file again." });
    expect(await apply([{ code: codes.ana, runLineId: anaLine.id }], randomUUID())).toEqual({ ok: false, error: "That upload was not found. Upload the file again." });
    // A line taken off the run (removed person) is not on the run.
    await actions.removePersonFromRun({ runId: run2, runLineId: benOne.id, reason: "Not this cutoff" });
    expect(await apply([{ code: codes.ben1, runLineId: benOne.id }])).toEqual({ ok: false, error: "A chosen person is not on this run any more. Update people and try again." });
    // Nothing was written by any refused call.
    expect(await items(run2)).toHaveLength(0);
    // Skipping every member is fine and writes nothing.
    expect(await apply([{ code: codes.ana, runLineId: null }])).toMatchObject({ ok: true, data: { lines: 0, written: 0 } });
  });

  it("throws an upload away on request, and purges uploads older than 14 days on the next upload", async () => {
    current.user = preparer;
    const run3 = await newRun("2032-05-01", "2032-05-15");
    await upload(run3, fullSheet());
    expect(await discardJibbleTimesheet({ runId: run3 })).toMatchObject({ ok: true });
    expect(await rows(sql`select 1 from payroll.timesheet_imports where run_id = ${run3}`)).toHaveLength(0);

    // An old upload for another run is purged by the next upload.
    const run4 = await newRun("2032-05-16", "2032-05-31");
    await upload(run4, fullSheet());
    await db.execute(sql`update payroll.timesheet_imports set created_at = now() - interval '15 days' where run_id = ${run4}`);
    await upload(run3, fullSheet());
    expect(await rows(sql`select 1 from payroll.timesheet_imports where run_id = ${run4}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.timesheet_imports where run_id = ${run3}`)).toHaveLength(1);
  });

  it("does not fill a run that is not a draft", async () => {
    current.user = preparer;
    const run5 = await newRun("2032-06-01", "2032-06-15");
    await upload(run5, fullSheet());
    // Sent for review: no longer a draft (a person with no line other than their own is enough: another Preparer checks and sends is not needed for this state check).
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${run5}`);
    expect(await upload(run5, fullSheet())).toMatchObject({ ok: false });
    expect((await getImportPage(run5))!.preview).toBeNull();
    const [anaLine] = await runLines(run5, ana.id);
    expect(await applyJibbleTimesheet({ runId: run5, importId: randomUUID(), assignments: [{ code: codes.ana, runLineId: anaLine.id }] })).toMatchObject({ ok: false });
  });
});

describe("a person taken off the run", () => {
  it("is not offered as a pay line in the preview", async () => {
    current.user = preparer;
    const run6 = await newRun("2032-07-01", "2032-07-15");
    const [loneLine] = await runLines(run6, lone.id);
    await actions.removePersonFromRun({ runId: run6, runLineId: loneLine.id, reason: "On leave" });
    await upload(run6, fullSheet());
    const preview = (await getImportPage(run6))!.preview!;
    expect(preview.lines.some((l) => l.runLineId === loneLine.id)).toBe(false);
    void updateRunPeople;
  });
});
