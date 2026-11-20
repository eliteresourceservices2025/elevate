import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS } from "@/lib/roles";

// Own payslips, as each of the six roles at each payroll level. `payroll.view_own` is own scope for every role and no level changes it.
// The database is a mock that throws: passing authorize() means reaching it, and a refusal happens before any data is read.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("server-only", () => ({}));

const { allowRequest } = await import("@/lib/rate-limit");
const { listMyPayslips, countMyPayslips, getMyPayslip } = await import("@/modules/payroll/payslip-queries");
const { GET } = await import("@/app/api/payroll/payslips/[runId]/route");

const RUN_ID = "44444444-4444-4444-8444-444444444444";
const LEVELS = [null, "viewer", "approver", "preparer"] as const;
const as = (roles: string[], level: unknown = null) => {
  currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.com", roles, payrollAccess: level };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("own payslips, every role at every payroll level", () => {
  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      it(`${role} (${level ?? "no level"}): passes authorize() on the list, the count and one payslip`, async () => {
        as([role], level);
        await expect(listMyPayslips()).rejects.toThrow("database touched");
        await expect(countMyPayslips()).rejects.toThrow("database touched");
        await expect(getMyPayslip(currentUser.value as never, RUN_ID)).rejects.toThrow("database touched");
      });
    }
  }

  it("a user with no role is refused before any data is read", async () => {
    as([], "preparer");
    await expect(listMyPayslips()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(countMyPayslips()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMyPayslip(currentUser.value as never, RUN_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the payslip route", () => {
  const call = (runId: string) => GET(new Request("http://localhost/api/payroll/payslips/x"), { params: Promise.resolve({ runId }) });

  it("answers 404 to a run id that is not a uuid, for every role", async () => {
    for (const role of ROLE_SLUGS) {
      as([role], "approver");
      expect((await call("nope")).status).toBe(404);
    }
  });

  for (const role of ROLE_SLUGS) {
    for (const level of LEVELS) {
      it(`${role} (${level ?? "no level"}): a valid run id passes authorize() and goes to the caller's own record lookup`, async () => {
        as([role], level);
        await expect(call(RUN_ID)).rejects.toThrow("database touched");
      });
    }
  }

  it("a Super Admin with no payroll level is scoped the same way as everyone else", async () => {
    as(["super_admin"], null);
    await expect(call(RUN_ID)).rejects.toThrow("database touched");
    await expect(getMyPayslip(currentUser.value as never, RUN_ID)).rejects.toThrow("database touched");
  });

  it("answers 429 with no-store and nosniff headers when the rate limit is hit", async () => {
    as(["employee"], null);
    vi.mocked(allowRequest).mockResolvedValueOnce(false);
    const res = await call(RUN_ID);
    expect(res.status).toBe(429);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("answers 404 to a user with no role, without reading data", async () => {
    as([]);
    expect((await call(RUN_ID)).status).toBe(404);
  });
});
