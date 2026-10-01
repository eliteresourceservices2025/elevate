import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// ELEVATE Sign actions and queries run as each of the six roles with the database mocked to throw: a role without access is refused
// before anything touches data. The signer-side actions (sign, decline, open the document) look up the person's own signer row
// first, so they are covered per role in tests/integration/signing.test.ts instead.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/signing/actions");
const queries = await import("@/modules/signing/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "sendEnvelope", call: () => actions.sendEnvelope({ envelopeId: ID }) },
  { name: "voidEnvelope", call: () => actions.voidEnvelope({ envelopeId: ID, reason: "Wrong version" }) },
  { name: "remindSigners", call: () => actions.remindSigners({ envelopeId: ID }) },
  { name: "discardDraft", call: () => actions.discardDraft({ envelopeId: ID }) },
  { name: "archiveTemplate", call: () => actions.archiveTemplate({ templateId: ID }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Signing HR actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = HR.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const result = await c.call();
          expect(result.ok).toBe(false);
          if (allowed) expect(result.error).not.toBe(NO_ACCESS);
          else expect(result.error).toBe(NO_ACCESS);
        });
      }
    });
  }
});

const queryCases: { name: string; allowed: RoleSlug[]; call: () => Promise<unknown> }[] = [
  { name: "listMySigning", allowed: [...ROLE_SLUGS], call: () => queries.listMySigning() },
  { name: "listEnvelopes", allowed: HR, call: () => queries.listEnvelopes() },
  { name: "listTemplates", allowed: HR, call: () => queries.listTemplates() },
  { name: "listSignerChoices", allowed: HR, call: () => queries.listSignerChoices() },
];

describe("Signing queries, every role", () => {
  for (const c of queryCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await c.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
    });
  }
});
