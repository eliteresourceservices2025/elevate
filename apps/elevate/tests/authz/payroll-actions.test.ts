import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Choosing payroll access, as each of the six roles. The database is replaced with a mock that throws if touched:
// whoever is refused is refused before any data is read.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setPayrollAccess } = await import("@/modules/settings/actions");
const { getPayrollAccessList } = await import("@/modules/settings/queries");

const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";

const as = (role: RoleSlug) => {
  currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.com", roles: [role], payrollAccess: null };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("setPayrollAccess, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = role === "super_admin";
    it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const result = await setPayrollAccess({ userId: OTHER, level: "viewer" });
      expect(result.ok).toBe(false);
      if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
  }

  it("a payroll level alone does not let a non-Super Admin choose access", async () => {
    currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com", roles: ["hr_admin"], payrollAccess: "approver" };
    expect(await setPayrollAccess({ userId: OTHER, level: "viewer" })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("rejects an unknown level before touching data", async () => {
    as("super_admin");
    expect(await setPayrollAccess({ userId: OTHER, level: "owner" })).toEqual({ ok: false, error: "Check the request and try again." });
    expect(await setPayrollAccess({ userId: "nope", level: null })).toEqual({ ok: false, error: "Check the request and try again." });
  });
});

// Pay lines, rates and settings, as each of the six roles at each payroll level. Only a Preparer passes authorize();
// a valid request from a Preparer reaches the (mocked, throwing) database, so it ends in the generic message.
const { createPayLine, updatePayLine, endPayLine, savePaySettings } = await import("@/modules/payroll/actions");
const { getRates, getPaySettings, getRuns, getWorksheet } = await import("@/modules/payroll/queries");
const { updateRunPeople, removePersonFromRun, restorePersonToRun } = await import("@/modules/payroll/actions");
const { createPayRun, cancelPayRun, savePayItem, dismissPayItem, confirmRunLine, refreshSuggestions, confirmSuggestion, assignSuggestion, submitRun, sendBackRun, approveRun } =
  await import("@/modules/payroll/actions");
const { payrollRunsAwaitingApproval, getPayments } = await import("@/modules/payroll/queries");
const { exportRemitlyList, markPaid } = await import("@/modules/payroll/actions");

const LEVELS = [null, "viewer", "approver", "preparer"] as const;
const GENERIC = "Something went wrong. Try again.";
const asLevel = (role: RoleSlug, level: (typeof LEVELS)[number]) => {
  currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.com", roles: [role], payrollAccess: level };
};
const LINE_KEY = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const calls: Record<string, () => Promise<{ ok: boolean; error?: string }>> = {
  createPayLine: () =>
    createPayLine({ employeeId: OTHER, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-01", monthly: "25000" }),
  updatePayLine: () =>
    updatePayLine({ lineKey: LINE_KEY, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-16", monthly: "26000", reason: "Raise" }),
  endPayLine: () => endPayLine({ lineKey: LINE_KEY, endsOn: "2030-11-30", reason: "Contract ended" }),
  savePaySettings: () =>
    savePaySettings({ effectiveFrom: "2030-11-01", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "", extraRestDay: "", extraRestDayOver8: "", reason: "Update" }),
  createPayRun: () => createPayRun({ periodStart: "2030-11-01", periodEnd: "2030-11-15" }),
  savePayItem: () => savePayItem({ runId: RUN_ID, employeeId: OTHER, runLineId: LINE_KEY, type: "late_minutes", value: "30" }),
  savePayItemAllowance: () => savePayItem({ runId: RUN_ID, employeeId: OTHER, runLineId: LINE_KEY, type: "allowance", label: "Health allowance", value: "500" }),
  dismissPayItem: () => dismissPayItem({ runId: RUN_ID, itemId: LINE_KEY }),
  confirmRunLine: () => confirmRunLine({ runLineId: LINE_KEY }),
  cancelPayRun: () => cancelPayRun({ runId: RUN_ID, reason: "Pay lines changed" }),
  updateRunPeople: () => updateRunPeople({ runId: RUN_ID }),
  removePersonFromRun: () => removePersonFromRun({ runId: RUN_ID, runLineId: LINE_KEY, reason: "Not on this run" }),
  restorePersonToRun: () => restorePersonToRun({ runId: RUN_ID, runLineId: LINE_KEY }),
  refreshSuggestions: () => refreshSuggestions({ runId: RUN_ID }),
  confirmSuggestion: () => confirmSuggestion({ runId: RUN_ID, itemId: LINE_KEY, runLineId: LINE_KEY }),
  assignSuggestion: () => assignSuggestion({ runId: RUN_ID, itemId: LINE_KEY, runLineId: LINE_KEY }),
  submitRun: () => submitRun({ runId: RUN_ID }),
  exportRemitlyList: () => exportRemitlyList({ runId: RUN_ID }),
  markPaid: () => markPaid({ runId: RUN_ID, employeeId: OTHER, reference: "RMT-TEST-1", paidOn: "2030-11-20" }),
};

describe.each(Object.keys(calls))("%s, every role at every payroll level", (name) => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level === "preparer";
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        const result = await calls[name]();
        expect(result.ok).toBe(false);
        expect(result.error).toBe(allowed ? GENERIC : NO_ACCESS);
      });
    }
  }
});

// Deciding a run: only an Approver passes authorize(). Who touched the run is checked after that, against the database.
const HASH = "a".repeat(64);
const decisions: Record<string, () => Promise<{ ok: boolean; error?: string }>> = {
  approveRun: () => approveRun({ runId: RUN_ID, expectedHash: HASH }),
  sendBackRun: () => sendBackRun({ runId: RUN_ID, note: "Check the late minutes" }),
};

describe.each(Object.entries(decisions))("%s, every role at every payroll level", (_name, decide) => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level === "approver";
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        const result = await decide();
        expect(result.ok).toBe(false);
        expect(result.error).toBe(allowed ? GENERIC : NO_ACCESS);
      });
    }
  }
});

describe("decisions are checked on the server", () => {
  const BAD = "Check the request and try again.";
  it("refuses a missing note, a malformed hash and a bad run id before touching data", async () => {
    asLevel("employee", "approver");
    expect(await sendBackRun({ runId: RUN_ID, note: "   " })).toEqual({ ok: false, error: BAD });
    expect(await sendBackRun({ runId: RUN_ID })).toEqual({ ok: false, error: BAD });
    for (const expectedHash of ["", "abc", "A".repeat(64), "g".repeat(64), undefined]) {
      expect(await approveRun({ runId: RUN_ID, expectedHash })).toEqual({ ok: false, error: BAD });
    }
    expect(await approveRun({ runId: "nope", expectedHash: HASH })).toEqual({ ok: false, error: BAD });
    asLevel("employee", "preparer");
    expect(await submitRun({ runId: "nope" })).toEqual({ ok: false, error: BAD });
  });
});

describe("the awaiting-approval count, every role at every payroll level", () => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level === "approver";
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        if (allowed) await expect(payrollRunsAwaitingApproval()).rejects.toThrow("database touched");
        else await expect(payrollRunsAwaitingApproval()).rejects.toMatchObject({ name: "ForbiddenError" });
      });
    }
  }
});

describe("rates and settings queries, every role at every payroll level", () => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level !== null;
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        for (const query of [getRates, getPaySettings]) {
          if (allowed) await expect(query()).rejects.toThrow("database touched");
          else await expect(query()).rejects.toMatchObject({ name: "ForbiddenError" });
        }
      });
    }
  }
});

describe("run queries, every role at every payroll level", () => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level !== null;
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        const queries = [() => getRuns({ page: 1, pageSize: 25 }), () => getWorksheet(RUN_ID), () => getPayments(RUN_ID)];
        for (const query of queries) {
          if (allowed) await expect(query()).rejects.toThrow("database touched");
          else await expect(query()).rejects.toMatchObject({ name: "ForbiddenError" });
        }
      });
    }
  }
});

describe("run input is checked on the server", () => {
  const BAD = "Check the request and try again.";
  const item = (patch: Record<string, unknown>) => ({ runId: RUN_ID, employeeId: OTHER, runLineId: LINE_KEY, type: "late_minutes", value: "30", ...patch });
  it.each([
    ["zero minutes", { value: "0" }],
    ["negative minutes", { value: "-5" }],
    ["fractional minutes", { value: "1.5" }],
    ["days with three decimals", { type: "absence_days", value: "1.555" }],
    ["a negative loan", { type: "loan", value: "-100", reason: "x" }],
    ["a dollar sign", { type: "adjustment", label: "Fix", value: "$50" }],
    ["an allowance with no name", { type: "allowance", value: "500" }],
    ["an allowance with a name that is too long", { type: "allowance", label: "x".repeat(61), value: "500" }],
    ["a reimbursement of zero", { type: "reimbursement", label: "Supplies", value: "0" }],
    ["a name on a plain amount", { type: "late_minutes", label: "Late", value: "30" }],
    ["sick leave of zero days", { type: "sick_leave_days", value: "0" }],
    ["a removed item type", { type: "dollar_allowance", value: "5" }],
    ["a removed holiday overtime type", { type: "extra_holiday", value: "60" }],
    ["a misplaced comma", { type: "other_deduction", value: "1,25.0", reason: "x" }],
    ["an unknown type", { type: "overtime" }],
    ["a line id that is not an id", { runLineId: "nope" }],
  ])("refuses %s before touching data", async (_label, patch) => {
    asLevel("employee", "preparer");
    expect(await savePayItem(item(patch))).toEqual({ ok: false, error: BAD });
  });

  it("refuses a bad payment or export request before touching data", async () => {
    asLevel("employee", "preparer");
    const pay = { runId: RUN_ID, employeeId: OTHER, reference: "RMT-1", paidOn: "2030-11-20" };
    for (const patch of [{ reference: "  " }, { reference: "x".repeat(101) }, { paidOn: "2030-02-31" }, { employeeId: "nope" }, { runId: "nope" }]) {
      expect(await markPaid({ ...pay, ...patch })).toEqual({ ok: false, error: BAD });
    }
    expect(await exportRemitlyList({ runId: "nope" })).toEqual({ ok: false, error: BAD });
    expect(await exportRemitlyList({})).toEqual({ ok: false, error: BAD });
  });

  it("refuses a bad period before touching data", async () => {
    asLevel("employee", "preparer");
    expect(await createPayRun({ periodStart: "2030-11-15", periodEnd: "2030-11-01" })).toEqual({ ok: false, error: BAD });
    expect(await createPayRun({ periodStart: "2030-11-01", periodEnd: "2031-01-15" })).toEqual({ ok: false, error: BAD });
    expect(await cancelPayRun({ runId: RUN_ID, reason: "  " })).toEqual({ ok: false, error: BAD });
  });

  it("accepts a valid item and reaches the database", async () => {
    asLevel("employee", "preparer");
    expect(await savePayItem(item({ type: "bonus", label: "Performance bonus", value: "2,000" }))).toEqual({ ok: false, error: GENERIC });
    expect(await savePayItem(item({ type: "pto_days", value: "2" }))).toEqual({ ok: false, error: GENERIC });
    expect(await savePayItem(item({ type: "loan", value: "1,250.50", reason: "Advance" }))).toEqual({ ok: false, error: GENERIC });
  });
});

describe("pay line input is checked on the server", () => {
  const valid = {
    employeeId: OTHER, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-11-01", monthly: "25,000.50",
  };
  const BAD = "Check the request and try again.";
  it.each([
    ["zero hours a day", { hoursPerDay: 0 }],
    ["13 hours a day", { hoursPerDay: 13 }],
    ["fractional hours a day", { hoursPerDay: 7.5 }],
    ["a negative amount", { monthly: "-100" }],
    ["a dollar sign", { monthly: "$50" }],
    ["a misplaced comma", { monthly: "1,25.0" }],
    ["three decimals", { monthly: "1.255" }],
    ["an empty monthly rate", { monthly: "" }],
    ["an unknown payment method", { paymentMethod: "crypto" }],
    ["a date that is not real", { effectiveFrom: "2030-02-31" }],
    ["an end before the start", { endsOn: "2030-10-01" }],
  ])("refuses %s", async (_label, patch) => {
    asLevel("employee", "preparer");
    expect(await createPayLine({ ...valid, ...patch })).toEqual({ ok: false, error: BAD });
  });

  it("accepts a pasted amount with a thousands comma (it then reaches the database)", async () => {
    asLevel("employee", "preparer");
    expect(await createPayLine(valid)).toEqual({ ok: false, error: GENERIC });
  });

  it("refuses a divisor that is not a positive whole number", async () => {
    asLevel("employee", "preparer");
    for (const cutoffDivisor of [0, -1, 1.5, 366]) {
      const result = await savePaySettings({ effectiveFrom: "2030-11-01", cutoffDivisor, changeWarnPercent: 10, extraRegular: "", extraHoliday: "", extraRestDay: "", extraRestDayOver8: "", holiday: "", reason: "x" });
      expect(result).toEqual({ ok: false, error: "Check the request and try again." });
    }
  });
});

describe("getPayrollAccessList, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${role === "super_admin" ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      if (role === "super_admin") await expect(getPayrollAccessList()).rejects.toThrow("database touched");
      else await expect(getPayrollAccessList()).rejects.toMatchObject({ name: "ForbiddenError" });
    });
  }
});

// The change history: Preparer, Approver and Viewer read it; every role with no level (a Super Admin included) is refused before any data is read.
const { getPayrollHistory, getHistoryFilterOptions } = await import("@/modules/payroll/history-queries");

describe("change history queries, every role at every payroll level", () => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      const allowed = level !== null;
      it(`${role} (${level ?? "no level"}): ${allowed ? "passes authorize()" : "is refused"}`, async () => {
        asLevel(role, level);
        const queries = [() => getPayrollHistory({ page: 1 }), () => getPayrollHistory({ runId: RUN_ID, page: 2, pageSize: 10 }), () => getHistoryFilterOptions()];
        for (const query of queries) {
          if (allowed) await expect(query()).rejects.toThrow("database touched");
          else await expect(query()).rejects.toMatchObject({ name: "ForbiddenError" });
        }
      });
    }
  }

  it("answers a bad filter with a message, before any data is read", async () => {
    asLevel("employee", "viewer");
    for (const bad of [{ runId: "nope" }, { from: "2030-02-30" }, { to: "soon" }]) {
      const r = await getPayrollHistory({ ...bad, page: 1 });
      expect(r.error).toEqual(expect.any(String));
      expect(r.rows).toEqual([]);
    }
  });
});
