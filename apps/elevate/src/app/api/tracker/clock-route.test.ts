import { beforeEach, describe, expect, it, vi } from "vitest";

// The device clock route: the tracker app clocks the person in and out. The server clock and request IP decide everything; the body can
// only name the action, a client and a break length.

const state = vi.hoisted(() => ({ device: null as null | { deviceId: string; employeeId: string }, minRequired: null as string | null }));
vi.mock("@/modules/activity/device-auth", () => ({ authenticateDevice: vi.fn(async () => state.device) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/activity/releases-service", () => ({ minRequiredVersion: vi.fn(async () => state.minRequired) }));
vi.mock("@/modules/activity/device-clock", () => ({
  clockForDevice: vi.fn(async () => ({ ok: true as const, result: { state: "working", at: "2026-11-20T10:00:00.000Z", outsideAllowedRange: false } })),
}));

const route = await import("./clock/route");
const { clockForDevice } = await import("@/modules/activity/device-clock");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/tracker/clock", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer abc", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const uuid = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.device = { deviceId: "d1", employeeId: "e1" };
  state.minRequired = null;
  vi.mocked(clockForDevice).mockClear();
});

describe("POST /api/tracker/clock", () => {
  it("answers 401 without a valid device token", async () => {
    state.device = null;
    expect((await route.POST(post({ action: "clock_in" }))).status).toBe(401);
    expect(clockForDevice).not.toHaveBeenCalled();
  });
  it("answers 400 for an unknown action or a bad break length", async () => {
    expect((await route.POST(post({ action: "start_over" }))).status).toBe(400);
    expect((await route.POST(post({ action: "switch_client", projectId: "nope" }))).status).toBe(400);
    expect((await route.POST(post({ action: "break_start", breakMinutes: 20 }))).status).toBe(400);
    expect((await route.POST(post({ action: "clock_in", clientId: "nope" }))).status).toBe(400);
    expect((await route.POST(post("not json"))).status).toBe(400);
  });
  it("passes only the action, client and break length: time and address from the body never reach the clock", async () => {
    const res = await route.POST(post({ action: "break_start", breakMinutes: 15, clientId: uuid, at: "2020-01-01T00:00:00Z", occurredAt: "2020-01-01T00:00:00Z", ip: "1.2.3.4" }));
    expect(res.status).toBe(200);
    expect(vi.mocked(clockForDevice).mock.calls[0]).toEqual(["e1", "break_start", { clientId: uuid, breakMinutes: 15 }]);
  });
  it("passes a chosen project, for clocking in and for switching", async () => {
    await route.POST(post({ action: "clock_in", projectId: uuid }));
    expect(vi.mocked(clockForDevice).mock.calls[0]).toEqual(["e1", "clock_in", { projectId: uuid }]);
    const res = await route.POST(post({ action: "switch_client", clientId: uuid, projectId: uuid }));
    expect(res.status).toBe(200);
    expect(vi.mocked(clockForDevice).mock.calls[1]).toEqual(["e1", "switch_client", { clientId: uuid, projectId: uuid }]);
  });
  it("answers 200 with the new state", async () => {
    const res = await route.POST(post({ action: "clock_in" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "working", at: "2026-11-20T10:00:00.000Z", outsideAllowedRange: false });
  });
  it("answers 409 with the plain reason when the clock refuses", async () => {
    vi.mocked(clockForDevice).mockResolvedValueOnce({ ok: false, error: "refused", message: "You are already clocked in." });
    const res = await route.POST(post({ action: "clock_in" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "refused", message: "You are already clocked in." });
  });
  it("answers 403 when the device owner has no person record", async () => {
    vi.mocked(clockForDevice).mockResolvedValueOnce({ ok: false, error: "no_person" });
    expect((await route.POST(post({ action: "clock_in" }))).status).toBe(403);
  });
  it("is not blocked by the version floor, so an old app can still clock out", async () => {
    state.minRequired = "2.0.0";
    expect((await route.POST(post({ action: "clock_out" }, { "x-tracker-version": "1.0.0" }))).status).toBe(200);
  });
});
