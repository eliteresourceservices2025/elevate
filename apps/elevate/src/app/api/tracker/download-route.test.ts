import { beforeEach, describe, expect, it, vi } from "vitest";

// The signed-in installer download: what happens when storage is down, and that a download is audited only when it really happens.

const state = vi.hoisted(() => ({ storageDown: false, audits: [] as unknown[] }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ id: "u1", email: "a@example.com", roles: ["employee"] })) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn(async (entry: unknown) => void state.audits.push(entry)) }));
vi.mock("@/modules/activity/releases-service", () => ({
  getPublishedReleases: vi.fn(async () => [
    {
      id: "r1",
      version: "1.0.0",
      status: "published",
      minRequired: false,
      publishedAt: "2026-11-20T10:00:00.000Z",
      notes: { added: ["x"], improved: [], fixed: [] },
      builds: [{ platform: "windows-x86_64", kind: "installer", sizeBytes: 300_000, sha256: "a".repeat(64), signature: null, storagePath: "releases/1.0.0/win/installer/a.exe", fileName: "a.exe" }],
    },
  ]),
}));
vi.mock("@/modules/documents/storage", () => ({
  BUCKETS: { trackerBuilds: "tracker-builds" },
  getDocumentStorage: () => ({
    createSignedDownload: async (_b: string, path: string, seconds: number) => {
      if (state.storageDown) throw new Error("Could not create a download link");
      return `https://storage.example.test/signed/${path}?expires=${seconds}`;
    },
  }),
}));

const installer = await import("./download/[platform]/route");
const call = (platform: string) => installer.GET(new Request(`http://localhost/api/tracker/download/${platform}`), { params: Promise.resolve({ platform }) });

beforeEach(() => {
  state.storageDown = false;
  state.audits.length = 0;
});

describe("the installer route", () => {
  it("redirects to a 60-second link and audits the download once", async () => {
    const res = await call("windows-x86_64");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example.test/signed/releases/1.0.0/win/installer/a.exe?expires=60");
    expect(state.audits).toHaveLength(1);
  });
  it("answers a JSON 503 when storage is down, and audits no download that did not happen", async () => {
    state.storageDown = true;
    const res = await call("windows-x86_64");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage_unavailable" });
    expect(state.audits).toHaveLength(0);
  });
  it("answers 404 for a platform with no installer", async () => {
    expect((await call("darwin-aarch64")).status).toBe(404);
    expect(state.audits).toHaveLength(0);
  });
});
