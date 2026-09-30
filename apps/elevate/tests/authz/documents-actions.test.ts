import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Document vault actions and queries that decide access before touching the database, run as each of
// the six roles with the database mocked to throw. Forbidden roles are refused first; allowed roles pass
// authorize() and then trip the mock. Actions that must look the record up first (download, archive,
// upload for a person) are covered by the database-backed suite in tests/integration/documents.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/documents/actions");
const queries = await import("@/modules/documents/queries");
const notificationQueries = await import("@/modules/notifications/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const companyUpload = {
  target: "company", typeId: ID, title: "Code of conduct", audience: "all_staff", fileName: "conduct.pdf",
  mimeType: "application/pdf", sizeBytes: 1000, acknowledged: true,
};
const typeInput = { name: "Visa", scope: "employee", requiresExpiry: true, requiresClient: false, requiredForAll: false };

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "requestUpload (company)", call: () => actions.requestUpload(companyUpload), allowed: HR },
  { name: "verifyDocument", call: () => actions.verifyDocument({ documentId: ID, verified: true }), allowed: HR },
  { name: "createDocumentType", call: () => actions.createDocumentType(typeInput), allowed: HR },
  { name: "updateDocumentType", call: () => actions.updateDocumentType({ ...typeInput, typeId: OTHER }), allowed: HR },
  { name: "archiveDocumentType", call: () => actions.archiveDocumentType({ typeId: OTHER }), allowed: HR },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("document actions, every role", () => {
  for (const c of actionCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
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

describe("document and notification queries, every role", () => {
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "getDocumentOverview", call: () => queries.getDocumentOverview(), allowed: HR },
    { name: "listDocumentTypes", call: () => queries.listDocumentTypes(), allowed: HR },
    { name: "getUploadOptions (company)", call: () => queries.getUploadOptions("company"), allowed: HR },
    { name: "listCompanyDocuments", call: () => queries.listCompanyDocuments(), allowed: [...ROLE_SLUGS] },
    { name: "countMyUnread", call: () => notificationQueries.countMyUnread(), allowed: [...ROLE_SLUGS] },
    { name: "listMyNotifications", call: () => notificationQueries.listMyNotifications(), allowed: [...ROLE_SLUGS] },
  ];

  for (const q of queryCases) {
    describe(q.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = q.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await q.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
    });
  }
});
