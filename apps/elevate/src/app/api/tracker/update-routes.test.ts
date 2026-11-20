import { beforeEach, describe, expect, it, vi } from "vitest";

// The update feed, the update download, the release notes and the version floor. The database and storage are replaced by mocks.

const state = vi.hoisted(() => ({
  device: null as null | { deviceId: string; employeeId: string },
  required: null as string | null,
  releases: [] as unknown[],
  storageDown: false,
}));
vi.mock("@/modules/activity/device-auth", () => ({ authenticateDevice: vi.fn(async () => state.device), redeemEnrollmentCode: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/activity/releases-service", () => ({
  getPublishedReleases: vi.fn(async () => state.releases),
  minRequiredVersion: vi.fn(async () => state.required),
  clearReleaseCache: vi.fn(),
}));
vi.mock("@/modules/documents/storage", () => ({
  BUCKETS: { trackerBuilds: "tracker-builds", tracker: "activity-shots" },
  getDocumentStorage: () => ({
    createSignedDownload: async (_bucket: string, path: string, seconds: number) => {
      if (state.storageDown) throw new Error("Could not create a download link");
      return `https://storage.example.test/signed/${path}?expires=${seconds}`;
    },
  }),
}));
vi.mock("@/modules/activity/ingest", () => ({
  clockStateFor: vi.fn(async () => ({ state: "working" })),
  ingestSegments: vi.fn(async () => ({ ok: true, accepted: 0, clipped: 0, duplicate: 0, rejected: {} })),
  requestShot: vi.fn(),
  finalizeShot: vi.fn(),
}));

const update = await import("./update/route");
const download = await import("./update/download/[platform]/route");
const notes = await import("./releases/[version]/route");
const clockState = await import("./clock-state/route");

const AUTH = { authorization: "Bearer abc" };
const rel = (version: string, status: "published" | "withdrawn" = "published", minRequired = false) => ({
  id: `id-${version}`,
  version,
  status,
  minRequired,
  publishedAt: "2026-11-20T10:00:00.000Z",
  notes: { added: ["New page"], improved: [], fixed: ["A fix"] },
  builds: [
    { platform: "windows-x86_64", kind: "installer", sizeBytes: 9_000_000, sha256: "a".repeat(64), signature: null, storagePath: `releases/${version}/win/installer/a.exe`, fileName: "a.exe" },
    { platform: "windows-x86_64", kind: "update", sizeBytes: 9_000_000, sha256: "b".repeat(64), signature: `SIG-${version}`, storagePath: `releases/${version}/win/update/a.exe`, fileName: "a.exe" },
  ],
});
const get = (url: string, headers: Record<string, string> = AUTH) => new Request(`http://localhost${url}`, { headers });

beforeEach(() => {
  state.device = { deviceId: "d1", employeeId: "e1" };
  state.required = null;
  state.storageDown = false;
  state.releases = [rel("1.1.0"), rel("1.2.0"), rel("1.3.0", "withdrawn")];
});

describe("authentication", () => {
  it("answers 401 on all three routes with no valid device", async () => {
    state.device = null;
    expect((await update.GET(get("/api/tracker/update?platform=windows-x86_64&version=1.0.0"))).status).toBe(401);
    expect((await download.GET(get("/api/tracker/update/download/windows-x86_64?version=1.2.0"), { params: Promise.resolve({ platform: "windows-x86_64" }) })).status).toBe(401);
    expect((await notes.GET(get("/api/tracker/releases/1.2.0"), { params: Promise.resolve({ version: "1.2.0" }) })).status).toBe(401);
  });
});

describe("the update feed", () => {
  it("answers 204 when the device is on the newest version, and when the only newer one is withdrawn", async () => {
    expect((await update.GET(get("/api/tracker/update?platform=windows-x86_64&version=1.2.0"))).status).toBe(204);
    expect((await update.GET(get("/api/tracker/update?platform=windows-x86_64&version=9.0.0"))).status).toBe(204);
  });
  it("offers the newest published version to an older device, with our own download address and the signature", async () => {
    const res = await update.GET(get("/api/tracker/update?platform=windows-x86_64&version=1.0.0"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe("1.2.0");
    expect(body.signature).toBe("SIG-1.2.0");
    expect(body.url).toBe("http://localhost/api/tracker/update/download/windows-x86_64?version=1.2.0");
    expect(body.url).not.toContain("storage.example.test");
    // Each group is a heading with one line per change, so a note that ends in a full stop does not run into the next one.
    expect(body.notes).toBe("Added:\n- New page\nFixed:\n- A fix");
    expect(body.pub_date).toBe("2026-11-20T10:00:00.000Z");
  });
  it("treats a missing or unreadable current version as older than everything", async () => {
    for (const q of ["", "&version=0.0.0-sim", "&version=junk"]) {
      const res = await update.GET(get(`/api/tracker/update?platform=windows-x86_64${q}`));
      expect(res.status).toBe(200);
    }
  });
  it("answers 400 for an unknown platform", async () => {
    expect((await update.GET(get("/api/tracker/update?platform=linux-x86_64&version=1.0.0"))).status).toBe(400);
    expect((await update.GET(get("/api/tracker/update?version=1.0.0"))).status).toBe(400);
  });
  it("answers 204 for a platform with no build", async () => {
    expect((await update.GET(get("/api/tracker/update?platform=darwin-aarch64&version=1.0.0"))).status).toBe(204);
  });
});

describe("the update download", () => {
  const call = (platform: string, version: string) => download.GET(get(`/api/tracker/update/download/${platform}?version=${version}`), { params: Promise.resolve({ platform }) });
  it("redirects to a 60-second link for a published release", async () => {
    const res = await call("windows-x86_64", "1.2.0");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example.test/signed/releases/1.2.0/win/update/a.exe?expires=60");
  });
  it("answers 404 for a withdrawn, unknown or malformed version and for a bad platform", async () => {
    expect((await call("windows-x86_64", "1.3.0")).status).toBe(404);
    expect((await call("windows-x86_64", "7.7.7")).status).toBe(404);
    expect((await call("windows-x86_64", "junk")).status).toBe(404);
    expect((await call("linux-x86_64", "1.2.0")).status).toBe(404);
  });
});

describe("when storage is down", () => {
  it("answers the update download with a JSON 503 the app can retry on, not a bare 500", async () => {
    state.storageDown = true;
    const res = await download.GET(get("/api/tracker/update/download/windows-x86_64?version=1.2.0"), { params: Promise.resolve({ platform: "windows-x86_64" }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage_unavailable" });
    state.storageDown = false;
  });
});

describe("the release notes route", () => {
  const call = (version: string) => notes.GET(get(`/api/tracker/releases/${version}`), { params: Promise.resolve({ version }) });
  it("returns the notes of a published release only", async () => {
    const res = await call("1.2.0");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "1.2.0", publishedAt: "2026-11-20T10:00:00.000Z", notes: { added: ["New page"], improved: [], fixed: ["A fix"] }, minRequired: false });
    expect((await call("1.3.0")).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
  });
});

describe("the version floor", () => {
  const ping = (headers: Record<string, string>) => clockState.GET(get("/api/tracker/clock-state", { ...AUTH, ...headers }));
  it("refuses an older app with an answer it can show", async () => {
    state.required = "2.0.0";
    const res = await ping({ "x-tracker-version": "1.0.0" });
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({ error: "update_required", minVersion: "2.0.0" });
  });
  it("lets a current app, an app with no version header and an unreadable version through", async () => {
    state.required = "2.0.0";
    expect((await ping({ "x-tracker-version": "2.0.0" })).status).toBe(200);
    expect((await ping({ "x-tracker-version": "2.1.0" })).status).toBe(200);
    expect((await ping({})).status).toBe(200);
    expect((await ping({ "x-tracker-version": "junk" })).status).toBe(200);
  });
  it("never stands in the way of updating itself", async () => {
    state.required = "2.0.0";
    const res = await update.GET(get("/api/tracker/update?platform=windows-x86_64&version=1.0.0", { ...AUTH, "x-tracker-version": "1.0.0" }));
    expect(res.status).toBe(200);
    const dl = await download.GET(get("/api/tracker/update/download/windows-x86_64?version=1.2.0", { ...AUTH, "x-tracker-version": "1.0.0" }), { params: Promise.resolve({ platform: "windows-x86_64" }) });
    expect(dl.status).toBe(302);
  });
  it("does nothing when no release is required", async () => {
    state.required = null;
    expect((await ping({ "x-tracker-version": "0.0.1" })).status).toBe(200);
  });
});
