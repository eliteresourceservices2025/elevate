import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTurnUsageQuery, sumTurnBytes } from "./usage";

vi.mock("server-only", () => ({}));

const ACCOUNT = "0123456789abcdef0123456789abcdef";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("TURN usage question and answer", () => {
  it("asks from the first of the month (UTC) to today, with no values spliced in", () => {
    const q = buildTurnUsageQuery(new Date("2026-11-19T23:30:00Z"));
    expect(q.variables).toEqual({ dateFrom: "2026-11-01", dateTo: "2026-11-19" });
    expect(q.text).toContain("callsTurnUsageAdaptiveGroups");
    expect(q.text).not.toContain("keyId:");
  });
  it("filters by our key only when its id is plain", () => {
    expect(buildTurnUsageQuery(new Date("2026-11-19T00:00:00Z"), "turn-key-1234").text).toContain('keyId: "turn-key-1234"');
    expect(buildTurnUsageQuery(new Date("2026-11-19T00:00:00Z"), 'x") { evil').text).not.toContain("evil");
  });
  it("adds the rows up in decimal gigabytes", () => {
    const data = { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 1_500_000_000, ingressBytes: 500_000_000 } }, { sum: { egressBytes: 500_000_000, ingressBytes: 0 } }] }] } };
    expect(sumTurnBytes(data)).toEqual({ egressGb: 2, ingressGb: 0.5 });
  });
  it("is null for an answer in the wrong shape, zero for no rows", () => {
    expect(sumTurnBytes(null)).toBeNull();
    expect(sumTurnBytes({ viewer: {} })).toBeNull();
    expect(sumTurnBytes({ viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [] }] } })).toEqual({ egressGb: 0, ingressGb: 0 });
  });
});

describe("fetchTurnUsage", () => {
  it("is off without the two settings", async () => {
    const { fetchTurnUsage } = await import("./cloudflare-usage");
    expect(await fetchTurnUsage()).toEqual({ state: "off" });
  });
  it("reads the figure and sends the token only as a bearer header", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
    vi.stubEnv("CLOUDFLARE_ANALYTICS_TOKEN", "tok-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: [{ sum: { egressBytes: 2_000_000_000, ingressBytes: 1_000_000_000 } }] }] } } })));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchTurnUsage } = await import("./cloudflare-usage");
    expect(await fetchTurnUsage()).toEqual({ state: "ok", egressGb: 2, ingressGb: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-secret");
    expect(String(init.body)).not.toContain("tok-secret");
  });
  it("turns a refusal, a GraphQL error and a network failure into a short reason", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT);
    vi.stubEnv("CLOUDFLARE_ANALYTICS_TOKEN", "tok-secret");
    const { fetchTurnUsage } = await import("./cloudflare-usage");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    expect(await fetchTurnUsage()).toMatchObject({ state: "error", reason: expect.stringContaining("Account Analytics") });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "no" }] }))));
    expect(await fetchTurnUsage()).toMatchObject({ state: "error" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const result = await fetchTurnUsage();
    expect(result).toMatchObject({ state: "error" });
    expect(JSON.stringify(result)).not.toContain("tok-secret");
  });
});
