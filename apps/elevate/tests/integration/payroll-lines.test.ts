import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database test: pay lines, rates and settings. Invented names and figures only.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { fieldCrypto } = await import("@/lib/crypto");
const { createPayLine, updatePayLine, endPayLine, savePaySettings } = await import("@/modules/payroll/actions");
const { getRates, getPaySettings } = await import("@/modules/payroll/queries");
const { settingsInForce } = await import("@/modules/payroll/service");
const { readChangeDetail } = await import("@/modules/payroll/changes");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: string | null = "preparer") {
  const id = randomUUID();
  const email = `${uniq("payl")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email, roles: ["employee"], payrollAccess: level };
}
async function person(userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Maria', 'Testcruz', ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
const base = (employeeId: string, over: Record<string, unknown> = {}) => ({
  employeeId,
  hoursPerDay: 8,
  fte: "1",
  paymentMethod: "remitly",
  effectiveFrom: "2030-11-01",
  monthly: "31,415.92",
  pesoAllowance: "1,000.00",
  dollarAllowance: "12.50",
  ...over,
});
const lineRows = (employeeId: string) =>
  rows<{ id: string; line_key: string; amounts_enc: string; effective_from: string; ends_on: string | null; hours_per_day: number }>(
    sql`select id, line_key, amounts_enc, effective_from::text, ends_on::text, hours_per_day from payroll.pay_lines where employee_id = ${employeeId} order by created_at, id`,
  );

describe("pay lines", () => {
  it("stores the amounts only encrypted, in the row and in the audit trail", async () => {
    const preparer = await account();
    const emp = await person();
    current.user = preparer;
    expect(await createPayLine(base(emp))).toMatchObject({ ok: true });

    const [line] = await lineRows(emp);
    expect(line.amounts_enc).not.toMatch(/31415|31,415|1000|12\.5/);
    expect(JSON.parse(fieldCrypto().decrypt(line.amounts_enc, `pay_line:${line.id}`))).toEqual({
      monthlyCentavos: "3141592",
      pesoAllowanceCentavos: "100000",
      dollarAllowanceCents: "1250",
    });

    const audit = await rows<Record<string, unknown>>(sql`select * from ops.audit_log where actor_user_id = ${preparer.id}`);
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toMatch(/31415|31,415|3141592|100000|1250|31\.4/);
    const log = await rows<{ detail_enc: string }>(sql`select detail_enc from payroll.pay_change_log where actor_id = ${preparer.id}`);
    expect(JSON.stringify(log)).not.toMatch(/31415|3141592/);
  });

  it("lets a Preparer not create or update their own line, and lets another Preparer", async () => {
    const mine = await account();
    const other = await account();
    const ownEmployee = await person(mine.id);

    current.user = mine;
    expect(await createPayLine(base(ownEmployee))).toEqual({ ok: false, error: "You can't change your own pay." });
    expect(await lineRows(ownEmployee)).toHaveLength(0);

    current.user = other;
    expect(await createPayLine(base(ownEmployee))).toMatchObject({ ok: true });
    const [line] = await lineRows(ownEmployee);

    current.user = mine;
    expect(await updatePayLine({ ...base(ownEmployee), lineKey: line.line_key, effectiveFrom: "2030-11-16", monthly: "40000", reason: "Raise" })).toEqual({
      ok: false,
      error: "You can't change your own pay.",
    });
    expect(await endPayLine({ lineKey: line.line_key, endsOn: "2030-12-31", reason: "Ended" })).toEqual({
      ok: false,
      error: "You can't change your own pay.",
    });
    expect(await lineRows(ownEmployee)).toHaveLength(1);

    current.user = other;
    expect(await updatePayLine({ ...base(ownEmployee), lineKey: line.line_key, effectiveFrom: "2030-11-16", monthly: "40000", reason: "Raise" })).toMatchObject({ ok: true });
    expect(await lineRows(ownEmployee)).toHaveLength(2);
  });

  it("an update is a new version with the same line key; the change log carries old and new amounts, encrypted", async () => {
    const preparer = await account();
    const emp = await person();
    current.user = preparer;
    await createPayLine(base(emp, { monthly: "20,000" }));
    const [first] = await lineRows(emp);
    expect(await updatePayLine({ ...base(emp, { monthly: "22,500.25" }), lineKey: first.line_key, effectiveFrom: "2030-11-16", reason: "Annual raise" })).toMatchObject({ ok: true });

    const all = await lineRows(emp);
    expect(all).toHaveLength(2);
    expect(all[1].line_key).toBe(first.line_key);
    expect(all[1].effective_from).toBe("2030-11-16");

    const log = await rows<{ id: string; detail_enc: string; action: string }>(
      sql`select id, detail_enc, action from payroll.pay_change_log where line_key = ${first.line_key} and action = 'line_updated'`,
    );
    expect(log).toHaveLength(1);
    expect(JSON.stringify(log)).not.toMatch(/2000000|2250025|Annual/);
    const detail = readChangeDetail(log[0]) as { old: { monthlyCentavos: string }; new: { monthlyCentavos: string }; reason: string };
    expect(detail.old.monthlyCentavos).toBe("2000000");
    expect(detail.new.monthlyCentavos).toBe("2250025");
    expect(detail.reason).toBe("Annual raise");
  });

  it("refuses an update before the latest version's date, and an update of an ended line", async () => {
    const preparer = await account();
    const emp = await person();
    current.user = preparer;
    await createPayLine(base(emp, { effectiveFrom: "2030-11-10" }));
    const [first] = await lineRows(emp);
    const early = await updatePayLine({ ...base(emp), lineKey: first.line_key, effectiveFrom: "2030-11-01", reason: "x" });
    expect(early.ok).toBe(false);

    expect(await endPayLine({ lineKey: first.line_key, endsOn: "2030-12-31", reason: "Ended" })).toMatchObject({ ok: true });
    const ended = (await lineRows(emp)).at(-1)!;
    expect(ended.ends_on).toBe("2030-12-31");
    expect(ended.line_key).toBe(first.line_key);
    const again = await updatePayLine({ ...base(emp), lineKey: first.line_key, effectiveFrom: "2030-12-01", reason: "x" });
    expect(again.ok).toBe(false);
  });

  it("ends a leaver's line before a raise already scheduled, and the later version stops applying", async () => {
    const preparer = await account();
    const emp = await person();
    current.user = preparer;
    await createPayLine(base(emp, { effectiveFrom: "2030-11-01", monthly: "20,000" }));
    const [first] = await lineRows(emp);
    await updatePayLine({ ...base(emp, { monthly: "30,000" }), lineKey: first.line_key, effectiveFrom: "2030-12-01", reason: "Scheduled raise" });

    expect(await endPayLine({ lineKey: first.line_key, endsOn: "2030-11-25", reason: "Left" })).toMatchObject({ ok: true });
    const versions = await lineRows(emp);
    const end = versions.at(-1)!;
    expect(end.ends_on).toBe("2030-11-25");
    expect(end.effective_from).toBe("2030-11-01"); // dated like the version in force on the last day, not like the scheduled raise
    expect(JSON.parse(fieldCrypto().decrypt(end.amounts_enc, `pay_line:${end.id}`)).monthlyCentavos).toBe("2000000");

    const { resolveLines } = await import("@/modules/payroll/lines");
    const resolved = resolveLines(
      versions.map((r) => ({ lineKey: r.line_key, effectiveFrom: r.effective_from, endsOn: r.ends_on, createdAt: 0, id: r.id })),
      { start: "2030-11-16", end: "2030-11-30" },
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].flags).toEqual(["ends_mid_period"]);

    // A second end, or a change, is refused.
    expect((await endPayLine({ lineKey: first.line_key, endsOn: "2030-11-20", reason: "x" })).ok).toBe(false);
    expect((await updatePayLine({ ...base(emp), lineKey: first.line_key, effectiveFrom: "2030-12-05", reason: "x" })).ok).toBe(false);

    // The change log for the end carries the old version's details as well.
    const [log] = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where line_key = ${first.line_key} and action = 'line_ended'`,
    );
    const detail = readChangeDetail(log) as { old: { monthlyCentavos: string; effectiveFrom: string }; endsOn: string };
    expect(detail.old.monthlyCentavos).toBe("2000000");
    expect(detail.old.effectiveFrom).toBe("2030-11-01");
    expect(detail.endsOn).toBe("2030-11-25");
  });

  it("refuses to change or end a line of someone who is archived, and to use an archived client", async () => {
    const preparer = await account();
    const emp = await person();
    current.user = preparer;
    await createPayLine(base(emp));
    const [first] = await lineRows(emp);

    const [archivedClient] = await rows<{ id: string }>(sql`insert into core.clients (name, archived_at) values (${uniq("Archived Client ")}, now()) returning id`);
    expect(await createPayLine(base(emp, { clientId: archivedClient.id }))).toEqual({ ok: false, error: "That client was not found." });
    expect(await updatePayLine({ ...base(emp, { clientId: archivedClient.id }), lineKey: first.line_key, effectiveFrom: "2030-11-16", reason: "x" })).toEqual({
      ok: false,
      error: "That client was not found.",
    });

    await db.execute(sql`update core.employees set archived_at = now() where id = ${emp}`);
    expect(await updatePayLine({ ...base(emp), lineKey: first.line_key, effectiveFrom: "2030-11-16", reason: "x" })).toEqual({ ok: false, error: "That person was not found." });
    expect(await endPayLine({ lineKey: first.line_key, endsOn: "2030-12-01", reason: "x" })).toEqual({ ok: false, error: "That person was not found." });
    expect(await lineRows(emp)).toHaveLength(1);
  });

  it("orders versions saved on one date by when they were really saved (clock_timestamp default)", async () => {
    const [col] = await rows<{ column_default: string }>(
      sql`select column_default from information_schema.columns where table_schema = 'payroll' and table_name = 'pay_lines' and column_name = 'created_at'`,
    );
    expect(col.column_default).toMatch(/clock_timestamp/);
  });

  it("leaves the old profile pay rate untouched", async () => {
    const preparer = await account();
    const emp = await person();
    await db.execute(sql`insert into core.employee_sensitive (employee_id, pay_rate_enc) values (${emp}, 'sentinel-ciphertext')`);
    current.user = preparer;
    await createPayLine(base(emp));
    const [s] = await rows<{ pay_rate_enc: string }>(sql`select pay_rate_enc from core.employee_sensitive where employee_id = ${emp}`);
    expect(s.pay_rate_enc).toBe("sentinel-ciphertext");
  });

  it("lists current lines with the amount decrypted, writing one sensitive.view audit row per view", async () => {
    const preparer = await account();
    const viewer = await account("viewer");
    const emp = await person();
    current.user = preparer;
    await createPayLine(base(emp, { monthly: "55,000", effectiveFrom: "2026-01-01" }));
    await createPayLine(base(emp, { monthly: "10,000", alias: "Second role" })); // starts in 2030: listed, not yet in force

    current.user = viewer;
    const before = await rows(sql`select 1 from ops.audit_log where action = 'sensitive.view' and actor_user_id = ${viewer.id}`);
    const list = await getRates();
    const mine = list.filter((r) => r.employeeId === emp);
    expect(mine).toHaveLength(2);
    expect(mine.map((r) => r.monthly).sort()).toEqual(["10,000.00", "55,000.00"]);
    const after = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'sensitive.view' and actor_user_id = ${viewer.id}`);
    expect(after.length - before.length).toBe(1);
    expect(JSON.stringify(after)).not.toMatch(/55,?000|10,?000/);
  });
});

describe("pay settings", () => {
  it("saves a dated version and settingsInForce picks the newest at or before a date", async () => {
    const preparer = await account();
    current.user = preparer;
    const date = "2031-03-01";
    expect(
      await savePaySettings({
        effectiveFrom: date, cutoffDivisor: 12, changeWarnPercent: 15,
        extraRegular: "125", extraHoliday: "200", extraRestDay: "130", extraRestDayOver8: "", holiday: "", reason: "Per owner",
      }),
    ).toMatchObject({ ok: true });

    const snap = await settingsInForce(db as never, "2031-03-15");
    expect(snap).toEqual({
      cutoffDivisor: 12,
      changeWarnBp: 1500,
      multipliersBp: { regular: 12500, holiday: 20000, restDay: 13000, restDayOver8: null, holidayPay: null },
    });
    const before = await settingsInForce(db as never, "2031-02-28");
    expect(before.cutoffDivisor).not.toBe(12);
    expect((await getPaySettings()).current?.cutoffDivisor).toBeDefined();

    const log = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where actor_id = ${preparer.id} and action = 'settings_changed'`,
    );
    expect(log).toHaveLength(1);
    expect(readChangeDetail(log[0])).toMatchObject({ new: { cutoffDivisor: 12 } });
  });

  it("refuses an effective date that already has a version", async () => {
    const preparer = await account();
    current.user = preparer;
    const input = { effectiveFrom: "2031-06-01", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "", extraHoliday: "", extraRestDay: "", extraRestDayOver8: "", holiday: "", reason: "" };
    expect(await savePaySettings(input)).toMatchObject({ ok: true });
    expect((await savePaySettings(input)).ok).toBe(false);
  });
});
