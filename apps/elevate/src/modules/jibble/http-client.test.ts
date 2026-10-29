import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_URLS, JibbleError, JibbleHttpClient, explain } from "./http-client";

// The real client against a stubbed fetch: the requests it makes, how it reads answers, and that errors never carry a body.

type Call = { url: string; method: string; headers: Record<string, string>; body: string | undefined };
const calls: Call[] = [];
const answer = (responses: { status?: number; json?: unknown }[]) => {
  calls.length = 0;
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      const r = responses[Math.min(i++, responses.length - 1)];
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }),
  );
};
afterEach(() => vi.unstubAllGlobals());

const token = new JibbleHttpClient({ ...DEFAULT_URLS, accessToken: "pat-123" });

describe("Jibble HTTP client", () => {
  it("lists people with the bearer token, a page at a time", async () => {
    const page = (n: number, from: number) => ({ value: Array.from({ length: n }, (_, i) => ({ id: `id-${from + i}`, email: `p${from + i}@example.com`, fullName: `Person ${from + i}`, status: "Active" })) });
    answer([{ json: page(200, 0) }, { json: page(5, 200) }]);
    const people = await token.listPeople();
    expect(people).toHaveLength(205);
    expect(people[0]).toMatchObject({ id: "id-0", email: "p0@example.com", fullName: "Person 0" });
    expect(calls[0].url).toContain("https://workspace.prod.jibble.io/v1/People?");
    expect(calls[1].url).toContain("$skip=200");
    expect(calls[0].headers.Authorization).toBe("Bearer pat-123");
  });

  it("reads the member code of each person, and carries on without it when Jibble refuses the field", async () => {
    const client = new JibbleHttpClient({ ...DEFAULT_URLS, accessToken: "pat-123" });
    answer([{ json: { value: [{ id: "p1", email: null, fullName: "Invented One", status: "Active", code: " IO-1 " }, { id: "p2", fullName: "Invented Two" }] } }]);
    const withCode = await client.listPeople();
    expect(calls[0].url).toContain("$select=id,email,fullName,status,code");
    expect(withCode[0]).toMatchObject({ id: "p1", code: "IO-1" });
    expect(withCode[1]).toMatchObject({ id: "p2", code: null });

    const refusing = new JibbleHttpClient({ ...DEFAULT_URLS, accessToken: "pat-123" });
    answer([{ status: 400, json: { error: "no such property" } }, { json: { value: [{ id: "p3", email: "x@example.com", fullName: "Invented Three", status: "Active" }] } }]);
    const without = await refusing.listPeople();
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("$select=id,email,fullName,status&");
    expect(without).toEqual([{ id: "p3", email: "x@example.com", fullName: "Invented Three", status: "Active", code: null }]);
  });

  it("sends a clock-in as a time entry for the person and a clock-out the same way", async () => {
    answer([{ json: { id: "entry-1" } }, { json: {} }]);
    expect(await token.clock("person-1", "In")).toEqual({ entryId: "entry-1" });
    expect(await token.clock("person-1", "Out")).toEqual({ entryId: null });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://time-tracking.prod.jibble.io/v1/TimeEntries" });
    expect(JSON.parse(calls[0].body!)).toMatchObject({ personId: "person-1", type: "In" });
    expect(JSON.parse(calls[1].body!)).toMatchObject({ type: "Out" });
  });

  it("ends a break through the EndBreak endpoint, pointing at the entry that started it", async () => {
    answer([{ json: {} }]);
    await token.clock("person-1", "EndBreak", { previousEntryId: "entry-9" });
    expect(calls[0].url).toBe("https://time-tracking.prod.jibble.io/v1/TimeEntries/EndBreak");
    expect(JSON.parse(calls[0].body!).model).toMatchObject({ personId: "person-1", previousTimeEntryId: "entry-9" });
  });

  it("reads the person's breaks and starts a break with the one that fits the chosen length, remembering the list", async () => {
    answer([
      { json: [{ id: "b-15", name: "15 minutes", duration: "PT15M", type: "Unpaid", isAvailable: true }, { id: "b-60", name: "1 hour", duration: "PT1H", type: "Unpaid", isAvailable: true }, { id: "b-open", name: "Flexible", duration: "PT0S", type: "Unpaid", isAvailable: true }, { id: "b-gone", name: "Not available", duration: "PT30M", type: "Unpaid", isAvailable: false }] },
      { json: { id: "entry-1" } },
      { json: { id: "entry-2" } },
      { json: { id: "entry-3" } },
    ]);
    expect(await token.clock("person-1", "StartBreak", { breakMinutes: 60 })).toEqual({ entryId: "entry-1" });
    expect(calls[0].url).toContain("https://time-tracking.prod.jibble.io/v1/GetBreaks(personId=person-1,time=");
    expect(calls[1]).toMatchObject({ method: "POST", url: "https://time-tracking.prod.jibble.io/v1/TimeEntries" });
    expect(JSON.parse(calls[1].body!)).toMatchObject({ personId: "person-1", type: "StartBreak", breakId: "b-60" });
    await token.clock("person-1", "StartBreak", { breakMinutes: null });
    expect(JSON.parse(calls[2].body!).breakId).toBe("b-open");
    expect(calls.filter((c) => c.url.includes("/v1/GetBreaks("))).toHaveLength(1); // the list was remembered
  });

  it("reads breaks as a flexible break when the length is zero, and skips ones that are not available", async () => {
    answer([{ json: [{ id: "h", name: "1 Hour Break", duration: "PT1H", type: "Unpaid", isAvailable: true }, { id: "s", name: "Staggered", duration: "PT0S", type: "Unpaid", isAvailable: true }, { id: "x", name: "Off", duration: "PT15M", type: "Paid", isAvailable: false }] }]);
    const fresh = new JibbleHttpClient({ ...DEFAULT_URLS, accessToken: "pat-123" });
    expect(await fresh.listBreaks("p1")).toEqual([
      { id: "h", name: "1 Hour Break", durationMinutes: 60, paid: false },
      { id: "s", name: "Staggered", durationMinutes: null, paid: false },
    ]);
  });

  it("refuses to start a break when the person has no break in Jibble, with a clear error that is not retried", async () => {
    answer([{ json: [] }]);
    const fresh = new JibbleHttpClient({ ...DEFAULT_URLS, accessToken: "pat-123" });
    const err = (await fresh.clock("person-1", "StartBreak", { breakMinutes: 15 }).catch((e: unknown) => e)) as JibbleError;
    expect(err).toBeInstanceOf(JibbleError);
    expect(err.message).toContain("no break set up for this person in Jibble");
    expect(err.retryable).toBe(false);
    expect(calls).toHaveLength(1); // nothing was sent to the time entries endpoint
  });

  it("reads tracked minutes per person and day from the timesheet summary", async () => {
    answer([{ json: [{ personId: "p1", daily: [{ date: "2026-10-01", tracked: "PT7H30M" }, { date: "2026-10-02", tracked: null }] }, { personId: "p2", daily: [{ date: "2026-10-01", tracked: "08:00:00" }] }] }]);
    const days = await token.dailyTracked(["p1", "p2"], "2026-10-01", "2026-10-02");
    expect(days).toEqual([
      { personId: "p1", date: "2026-10-01", trackedMinutes: 450 },
      { personId: "p2", date: "2026-10-01", trackedMinutes: 480 },
    ]);
    expect(calls[0].url).toContain("time-attendance.prod.jibble.io/v2/TimesheetsSummary?Period=Custom&Date=2026-10-01&EndDate=2026-10-02");
    expect(calls[0].url).toContain("PersonIds=p1&PersonIds=p2");
  });

  it("gets a token with a client id and secret when there is no personal token, and reuses it", async () => {
    const withSecret = new JibbleHttpClient({ ...DEFAULT_URLS, clientId: "cid", clientSecret: "csecret" });
    answer([{ json: { access_token: "jwt", expires_in: 3600 } }, { json: { value: [] } }, { json: { value: [] } }]);
    await withSecret.listPeople();
    await withSecret.listPeople();
    expect(calls.filter((c) => c.url.includes("/connect/token"))).toHaveLength(1);
    expect(calls[0].body).toContain("grant_type=client_credentials");
    expect(calls[1].headers.Authorization).toBe("Bearer jwt");
  });

  it("turns refusals into short errors with the status and no response body", async () => {
    answer([{ status: 401, json: { error: "secret details ana@example.com" } }]);
    const err = await token.clock("p", "In").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JibbleError);
    expect((err as JibbleError).status).toBe(401);
    expect((err as JibbleError).retryable).toBe(false);
    expect((err as JibbleError).message).not.toContain("ana@example.com");

    answer([{ status: 503 }]);
    expect(((await token.clock("p", "In").catch((e: unknown) => e)) as JibbleError).retryable).toBe(true);
  });

  it("sends who is making the entry in the format Jibble expects", async () => {
    answer([{ json: { id: "e1" } }]);
    await token.clock("person-1", "In");
    expect(JSON.parse(calls[0].body!).platform).toMatchObject({ deviceName: "ELEVATE", isQrKiosk: false });
  });

  it("sends a caller-supplied entry ID when requested", async () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    answer([{ json: { id } }]);
    expect(await token.clock("person-1", "In", { requestId: id })).toEqual({ entryId: id });
    expect(JSON.parse(calls[0].body!).id).toBe(id);
  });

  it("keeps what Jibble said was wrong for the probe, but not in the message that gets stored", async () => {
    answer([{ status: 400, json: { errors: { Platform: ["The Platform field is required."] }, title: "One or more validation errors occurred." } }]);
    const err = (await token.clock("person-1", "In").catch((e: unknown) => e)) as JibbleError;
    expect(err.status).toBe(400);
    expect(err.detail).toContain("Platform: The Platform field is required.");
    expect(err.message).toBe("http 400: request refused"); // what the log stores has no detail
    expect(explain("")).toBeNull();
    expect(explain("plain text")).toBe("plain text");
    expect(explain(JSON.stringify({ message: "x".repeat(500) }))?.length).toBe(300);
  });

  it("reads where a person is in Jibble from their latest time entry", async () => {
    answer([{ json: { type: "In" } }, { json: { type: "StartBreak" } }, { json: { type: "Out" } }, { json: {} }]);
    expect(await token.latestState("p1")).toBe("in");
    expect(await token.latestState("p1")).toBe("break");
    expect(await token.latestState("p1")).toBe("out");
    expect(await token.latestState("p1")).toBeNull();
    expect(calls[0].url).toContain("/v1/People(p1)/LatestTimeEntry");
  });

  it("reads only valid, timezone-qualified latest entry evidence", async () => {
    answer([{ json: { id: "entry-1", type: "In", time: "2026-10-26T13:03:00-07:00" } }, { json: { id: "entry-2", type: "In", time: "2026-10-26T13:03:00" } }, { json: { type: "Out", time: "2026-10-26T20:03:00Z" } }]);
    expect(await token.latestEntry("p1")).toEqual({ id: "entry-1", state: "in", time: "2026-10-26T20:03:00.000Z" });
    expect(await token.latestEntry("p1")).toBeNull();
    expect(await token.latestEntry("p1")).toBeNull();
    expect(calls[0].url).toContain("$select=id,type,time");
  });

  it("looks up one person's active entry without exposing device identifiers", async () => {
    const person = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const entry = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    answer([{ json: { value: [{ id: entry, personId: person, type: "In", time: "2026-10-26T20:03:00Z", createdAt: "2026-10-26T20:03:01Z", updatedAt: "2026-10-26T20:03:01Z", clientType: "Desktop", platform: { deviceId: "private-device", clientVersion: "desktop" }, status: "Active" }] } }]);
    const result = await token.entryEvidence(person, entry);
    expect(result).toMatchObject({ id: entry, personId: person, state: "in", clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    expect(JSON.stringify(result)).not.toContain("private-device");
    expect(new URL(calls[0].url).searchParams.get("$filter")).toBe(`(id eq ${entry} and personId eq ${person})`);
    expect(await token.entryEvidence("invalid", entry)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("keeps how long Jibble asked us to wait when it says to slow down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "90" } })));
    const err = (await token.clock("p", "In").catch((e: unknown) => e)) as JibbleError;
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(90_000);
    expect(err.retryable).toBe(true);
    expect(err.message).toBe("http 429: slow down");
  });

  it("asks for a token once when many calls start together", async () => {
    const withSecret = new JibbleHttpClient({ ...DEFAULT_URLS, clientId: "cid", clientSecret: "csecret" });
    answer([{ json: { access_token: "jwt", expires_in: 3600 } }, { json: { id: "e" } }]);
    await Promise.all([withSecret.clock("a", "In"), withSecret.clock("b", "In"), withSecret.clock("c", "In")]);
    expect(calls.filter((c) => c.url.includes("/connect/token"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/v1/TimeEntries"))).toHaveLength(3);
  });

  it("reports a dead connection as a retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const err = (await token.clock("p", "In").catch((e: unknown) => e)) as JibbleError;
    expect(err.status).toBeNull();
    expect(err.retryable).toBe(true);
  });
});
