import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Runs every invoice action and query as each of the six roles, with and without a payroll level. The database is a mock that throws if
// touched: a forbidden role must be refused before it, an allowed role gets past authorize() and then trips the mock.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: () => { throw new Error("database touched"); } }),
}));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { previewInvoiceRun, createInvoice, addBillRate } = await import("@/modules/invoices/actions");
const { listInvoices, listInvoiceableRuns, getInvoice, getBillRates } = await import("@/modules/invoices/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const ALLOWED: RoleSlug[] = ["super_admin", "hr_admin", "executive"];

const as = (role: RoleSlug, payrollAccess: "preparer" | "approver" | "viewer" | null = null) => {
  currentUser.value = { id: ID, email: "actor@example.com", roles: [role], payrollAccess };
};

const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "previewInvoiceRun", call: () => previewInvoiceRun({ runId: OTHER }) },
  { name: "createInvoice", call: () => createInvoice({ runId: OTHER, clientId: ID }) },
  { name: "addBillRate", call: () => addBillRate({ clientId: OTHER, effectiveFrom: "2031-01-01", rate: "25.50" }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("invoice actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = ALLOWED.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const result = await c.call();
          expect(result.ok).toBe(false); // the mocked database always fails the allowed path
          if (allowed) expect(result.error).not.toBe(NO_ACCESS);
          else expect(result.error).toBe(NO_ACCESS);
        });
      }
      it("a payroll level alone opens nothing (employee + preparer, approver, viewer)", async () => {
        for (const level of ["preparer", "approver", "viewer"] as const) {
          as("employee", level);
          expect((await c.call()).error).toBe(NO_ACCESS);
        }
      });
      it("a bad request from an allowed role is refused before the database", async () => {
        as("executive");
        const bad = (await (c.name === "previewInvoiceRun" ? previewInvoiceRun({ runId: "nope" }) : c.name === "createInvoice" ? createInvoice({ runId: "x" }) : addBillRate({ clientId: OTHER, effectiveFrom: "2031-01-01", rate: "-5" }))) as { ok: boolean; error?: string };
        expect(bad.ok).toBe(false);
        expect(bad.error).not.toBe(NO_ACCESS);
        expect(console.error).not.toHaveBeenCalled(); // never reached the throwing database
      });
    });
  }
});

describe("invoice queries, every role", () => {
  const queries: { name: string; call: () => Promise<unknown> }[] = [
    { name: "listInvoices", call: () => listInvoices({ page: 1, pageSize: 25 }) },
    { name: "listInvoiceableRuns", call: () => listInvoiceableRuns() },
    { name: "getInvoice", call: () => getInvoice(OTHER) },
    { name: "getBillRates", call: () => getBillRates({ page: 1, pageSize: 25 }) },
  ];
  for (const q of queries) {
    describe(q.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = ALLOWED.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await q.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
      it("a payroll level alone opens nothing", async () => {
        as("employee", "preparer");
        const outcome = await q.call().then(() => "resolved", (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"));
        expect(outcome).toBe("forbidden");
      });
    });
  }
});
