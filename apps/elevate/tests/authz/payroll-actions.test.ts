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
const { getRates, getPaySettings } = await import("@/modules/payroll/queries");

const LEVELS = [null, "viewer", "approver", "preparer"] as const;
const GENERIC = "Something went wrong. Try again.";
const asLevel = (role: RoleSlug, level: (typeof LEVELS)[number]) => {
  currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.com", roles: [role], payrollAccess: level };
};
const LINE_KEY = "33333333-3333-4333-8333-333333333333";
const calls: Record<string, () => Promise<{ ok: boolean; error?: string }>> = {
  createPayLine: () =>
    createPayLine({ employeeId: OTHER, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: "2030-11-01", monthly: "25000", pesoAllowance: "0", dollarAllowance: "0" }),
  updatePayLine: () =>
    updatePayLine({ lineKey: LINE_KEY, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: "2030-11-16", monthly: "26000", pesoAllowance: "0", dollarAllowance: "0", reason: "Raise" }),
  endPayLine: () => endPayLine({ lineKey: LINE_KEY, endsOn: "2030-11-30", reason: "Contract ended" }),
  savePaySettings: () =>
    savePaySettings({ effectiveFrom: "2030-11-01", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "", extraHoliday: "", extraRestDay: "", extraRestDayOver8: "", holiday: "", reason: "Update" }),
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

describe("pay line input is checked on the server", () => {
  const valid = {
    employeeId: OTHER, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: "2030-11-01", monthly: "25,000.50", pesoAllowance: "0", dollarAllowance: "0",
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
    ["a negative FTE", { fte: "-1" }],
    ["an FTE with three decimals", { fte: "0.555" }],
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
