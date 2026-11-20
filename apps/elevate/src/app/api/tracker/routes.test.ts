import { beforeEach, describe, expect, it, vi } from "vitest";

// The tracker routes sit outside the sign-in gate, so each one must check the device token itself. The database is replaced by mocks.

const state = vi.hoisted(() => ({ device: null as null | { deviceId: string; employeeId: string }, allow: true }));
vi.mock("@/modules/activity/device-auth", () => ({
  authenticateDevice: vi.fn(async () => state.device),
  redeemEnrollmentCode: vi.fn(async () => ({ ok: true, token: "tok", deviceId: "d1", employeeId: "e1" })),
}));
vi.mock("@/modules/activity/ingest", () => ({
  clockStateFor: vi.fn(async () => ({ state: "working", since: null, policy: true, settings: { idleTimeoutSeconds: 180, shotIntervalMinutes: 10 } })),
  ingestSegments: vi.fn(async () => ({ ok: true, accepted: 1, clipped: 0, duplicate: 0, rejected: {} })),
  requestShot: vi.fn(async () => ({ ok: true, shotId: "s1", path: "p", token: "t" })),
  finalizeShot: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => state.allow) }));

const enroll = await import("./enroll/route");
const clockState = await import("./clock-state/route");
const segments = await import("./segments/route");
const shotRequest = await import("./shots/request/route");
const shotFinalize = await import("./shots/finalize/route");

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const AUTH = { authorization: "Bearer abc" };
const uuid = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.device = { deviceId: "d1", employeeId: "e1" };
  state.allow = true;
});

describe("device authentication", () => {
  it("answers 401 on every route except enroll when there is no valid device", async () => {
    state.device = null;
    expect((await clockState.GET(new Request("http://localhost/api/tracker/clock-state"))).status).toBe(401);
    expect((await segments.POST(post("/api/tracker/segments", {}, AUTH))).status).toBe(401);
    expect((await shotRequest.POST(post("/api/tracker/shots/request", {}, AUTH))).status).toBe(401);
    expect((await shotFinalize.POST(post("/api/tracker/shots/finalize", {}, AUTH))).status).toBe(401);
  });
});

describe("input checks", () => {
  it("answers 400 for a body that is not JSON or does not fit", async () => {
    expect((await segments.POST(post("/api/tracker/segments", "not json", AUTH))).status).toBe(400);
    expect((await segments.POST(post("/api/tracker/segments", { segments: [] }, AUTH))).status).toBe(400);
    expect((await shotFinalize.POST(post("/api/tracker/shots/finalize", { shotId: "nope" }, AUTH))).status).toBe(400);
  });
  it("never accepts a window title: unknown fields are not stored and not required", async () => {
    const body = { segments: [{ start: new Date().toISOString(), end: new Date().toISOString(), app: "Chrome", state: "active", title: "Patient John" }] };
    expect((await segments.POST(post("/api/tracker/segments", body, AUTH))).status).toBe(200);
    const { ingestSegments } = await import("@/modules/activity/ingest");
    const sent = vi.mocked(ingestSegments).mock.calls.at(-1)?.[1];
    expect(JSON.stringify(sent)).not.toContain("Patient");
  });
});

describe("happy paths", () => {
  it("enroll trades a code for a token", async () => {
    const res = await enroll.POST(post("/api/tracker/enroll", { code: "ABCD2345", name: "PC", os: "windows", appVersion: "1.0.0" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "tok", deviceId: "d1" });
  });
  it("enroll answers 400 with a plain reason when the code is bad", async () => {
    const { redeemEnrollmentCode } = await import("@/modules/activity/device-auth");
    vi.mocked(redeemEnrollmentCode).mockResolvedValueOnce({ ok: false, reason: "expired" });
    const res = await enroll.POST(post("/api/tracker/enroll", { code: "ABCD2345", name: "PC", os: "windows", appVersion: "1.0.0" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "expired" });
  });
  it("clock-state, segments and shots answer 200", async () => {
    expect((await clockState.GET(new Request("http://localhost/api/tracker/clock-state", { headers: AUTH }))).status).toBe(200);
    expect((await shotRequest.POST(post("/api/tracker/shots/request", { takenAt: new Date().toISOString() }, AUTH))).status).toBe(200);
    expect((await shotFinalize.POST(post("/api/tracker/shots/finalize", { shotId: uuid }, AUTH))).status).toBe(200);
  });
});

describe("rate limit", () => {
  it("answers 429 when the limiter says no", async () => {
    state.allow = false;
    expect((await enroll.POST(post("/api/tracker/enroll", { code: "ABCD2345", name: "PC", os: "windows", appVersion: "1.0.0" }))).status).toBe(429);
    expect((await segments.POST(post("/api/tracker/segments", { segments: [] }, AUTH))).status).toBe(429);
  });
});

describe("screenshot upload link", () => {
  it("gives the app a ready upload address, so it never needs to know the storage service", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
    const res = await shotRequest.POST(post("/api/tracker/shots/request", { takenAt: new Date().toISOString() }, AUTH));
    const body = await res.json();
    expect(body.uploadUrl).toBe("https://storage.example.test/storage/v1/object/upload/sign/activity-shots/p?token=t");
    expect(body.shotId).toBe("s1");
    vi.unstubAllEnvs();
  });
});

describe("when storage is down", () => {
  it("answers the app with a JSON 503 it can retry on, not a bare 500", async () => {
    const { requestShot, finalizeShot } = await import("@/modules/activity/ingest");
    vi.mocked(requestShot).mockRejectedValueOnce(new Error("Could not create an upload link"));
    const res = await shotRequest.POST(post("/api/tracker/shots/request", { takenAt: new Date().toISOString() }, AUTH));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "storage_unavailable" });
    vi.mocked(finalizeShot).mockRejectedValueOnce(new Error("storage down"));
    const fin = await shotFinalize.POST(post("/api/tracker/shots/finalize", { shotId: uuid }, AUTH));
    expect(fin.status).toBe(503);
  });
});
