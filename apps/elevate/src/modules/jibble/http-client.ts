// The real Jibble API client (plain fetch). Deliberately free of server-only imports so the one-off probe script can use it.
// Never import this from a client component: it handles the access token.
// Endpoints (from Jibble's public OpenAPI files): Workspace /v1/People, TimeTracking /v1/TimeEntries and
// /v1/TimeEntries/EndBreak, TimeAttendance /v2/TimesheetsSummary. Auth is a Bearer token: a personal access token
// (JIBBLE_ACCESS_TOKEN), or a token fetched with a Client ID and Secret (client_credentials) when the plan has them.

import { describeFailure, isRetryable, parseDuration, pickBreak, type JibbleAction, type JibbleBreak, type JibbleState } from "./mirror-rules";

export type JibblePerson = { id: string; email: string | null; fullName: string; status: string | null };
export type JibbleDay = { personId: string; date: string; trackedMinutes: number };

/** Extra facts for a break call: the length ELEVATE's break was set to (to pick the matching Jibble break), and the entry that started it. */
export type ClockOptions = { breakMinutes?: number | null; previousEntryId?: string | null };

export interface JibbleClient {
  listPeople(): Promise<JibblePerson[]>;
  /** Where a person is in Jibble right now (from their latest time entry); null when they have none. */
  latestState(personId: string): Promise<JibbleState | null>;
  /** The breaks available to one person in Jibble (they come from the person's schedule). */
  listBreaks(personId: string): Promise<JibbleBreak[]>;
  /** Sends one clock action for a person. Returns the new time entry's id when Jibble gives one. */
  clock(personId: string, action: JibbleAction, options?: ClockOptions): Promise<{ entryId: string | null }>;
  /** Tracked minutes per person and day, for the nightly comparison. Totals only: nothing else is read. */
  dailyTracked(personIds: string[], fromDate: string, toDate: string): Promise<JibbleDay[]>;
}

export class JibbleError extends Error {
  constructor(
    public readonly status: number | null,
    public readonly code: string,
    /** What Jibble said was wrong, shortened. For the local probe script only: never stored, logged or shown in the app. */
    public readonly detail: string | null = null,
    /** How long Jibble asked us to wait before trying again (a "slow down" answer), in milliseconds. */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(describeFailure(status, code));
    this.name = "JibbleError";
  }
  get retryable() {
    return isRetryable(this.status);
  }
}

export type JibbleConfig = {
  accessToken?: string;
  clientId?: string;
  clientSecret?: string;
  identityUrl: string;
  workspaceUrl: string;
  timeTrackingUrl: string;
  timeAttendanceUrl: string;
};

export const DEFAULT_URLS = {
  identityUrl: "https://identity.prod.jibble.io",
  workspaceUrl: "https://workspace.prod.jibble.io",
  timeTrackingUrl: "https://time-tracking.prod.jibble.io",
  timeAttendanceUrl: "https://time-attendance.prod.jibble.io",
};

const strip = (url: string) => url.replace(/\/+$/, "");

export function configFromEnv(env: Record<string, string | undefined>): JibbleConfig | null {
  const accessToken = env.JIBBLE_ACCESS_TOKEN?.trim() || undefined;
  const clientId = env.JIBBLE_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.JIBBLE_CLIENT_SECRET?.trim() || undefined;
  if (!accessToken && !(clientId && clientSecret)) return null;
  return {
    accessToken,
    clientId,
    clientSecret,
    identityUrl: strip(env.JIBBLE_IDENTITY_URL || DEFAULT_URLS.identityUrl),
    workspaceUrl: strip(env.JIBBLE_WORKSPACE_URL || DEFAULT_URLS.workspaceUrl),
    timeTrackingUrl: strip(env.JIBBLE_TIME_TRACKING_URL || DEFAULT_URLS.timeTrackingUrl),
    timeAttendanceUrl: strip(env.JIBBLE_TIME_ATTENDANCE_URL || DEFAULT_URLS.timeAttendanceUrl),
  };
}

type Json = Record<string, unknown>;

/** A short reading of an error answer from Jibble (its message, or the fields it names), at most 300 characters. */
export function explain(body: string): string | null {
  if (!body.trim()) return null;
  try {
    const json = JSON.parse(body) as Json;
    const pick = (v: unknown) => (typeof v === "string" ? v : null);
    const errors = json.errors && typeof json.errors === "object" ? Object.entries(json.errors as Record<string, unknown>).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ") : null;
    const nested = json.error && typeof json.error === "object" ? pick((json.error as Json).message) : null;
    const text = [pick(json.message), pick(json.detail), pick(json.title), pick(json.error), nested, errors].filter(Boolean).join(" | ");
    return (text || body).slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Who is making the entry, in the format Jibble's time entries expect: ELEVATE's server, not a person's device. */
const PLATFORM = { clientVersion: "elevate", os: "server", deviceModel: "server", deviceName: "ELEVATE", deviceId: "elevate-server", isQrKiosk: false };

export class JibbleHttpClient implements JibbleClient {
  private cached: { token: string; expiresAt: number } | null = null;
  private breakCache = new Map<string, { at: number; breaks: JibbleBreak[] }>();
  /** One token request at a time, so a burst of calls on a cold server asks for a token once, not once per call. */
  private tokenRequest: Promise<string> | null = null;
  constructor(private readonly config: JibbleConfig) {}

  private async token(): Promise<string> {
    if (this.config.accessToken) return this.config.accessToken;
    if (this.cached && this.cached.expiresAt > Date.now() + 60_000) return this.cached.token;
    this.tokenRequest ??= this.fetchToken().finally(() => {
      this.tokenRequest = null;
    });
    return this.tokenRequest;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: this.config.clientId ?? "", client_secret: this.config.clientSecret ?? "" });
    const json = (await this.send("POST", `${this.config.identityUrl}/connect/token`, { form: body }, false)) as Json;
    const token = typeof json.access_token === "string" ? json.access_token : null;
    if (!token) throw new JibbleError(null, "no token in the answer");
    this.cached = { token, expiresAt: Date.now() + (typeof json.expires_in === "number" ? json.expires_in : 3600) * 1000 };
    return token;
  }

  private async send(method: string, url: string, opts: { json?: unknown; form?: URLSearchParams } = {}, auth = true): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) headers.Authorization = `Bearer ${await this.token()}`;
    if (opts.json !== undefined) headers["Content-Type"] = "application/json";
    if (opts.form) headers["Content-Type"] = "application/x-www-form-urlencoded";
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: opts.form ? opts.form.toString() : opts.json !== undefined ? JSON.stringify(opts.json) : undefined, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new JibbleError(null, error instanceof Error && error.name === "TimeoutError" ? "timeout" : "no connection");
    }
    if (!response.ok) {
      const detail = await response.text().then((t) => explain(t), () => null);
      const seconds = Number(response.headers.get("retry-after"));
      throw new JibbleError(response.status, response.status === 401 ? "token rejected" : response.status === 403 ? "not allowed" : response.status === 429 ? "slow down" : "request refused", detail, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : null);
    }
    if (response.status === 204) return {};
    return (await response.json().catch(() => ({}))) as unknown;
  }

  async listPeople(): Promise<JibblePerson[]> {
    const out: JibblePerson[] = [];
    for (let skip = 0; skip < 5000; skip += 200) {
      const page = (await this.send("GET", `${this.config.workspaceUrl}/v1/People?$select=id,email,fullName,status&$top=200&$skip=${skip}&$orderby=fullName`)) as { value?: Json[] };
      const rows = page.value ?? [];
      for (const r of rows) out.push({ id: String(r.id), email: typeof r.email === "string" && r.email ? r.email : null, fullName: String(r.fullName ?? ""), status: typeof r.status === "string" ? r.status : null });
      if (rows.length < 200) break;
    }
    return out;
  }

  async latestState(personId: string): Promise<JibbleState | null> {
    const entry = (await this.send("GET", `${this.config.timeTrackingUrl}/v1/People(${encodeURIComponent(personId)})/LatestTimeEntry?$select=type,time`)) as Json;
    return entry.type === "In" ? "in" : entry.type === "StartBreak" ? "break" : entry.type === "Out" ? "out" : null;
  }

  async listBreaks(personId: string): Promise<JibbleBreak[]> {
    const answer = (await this.send("GET", `${this.config.timeTrackingUrl}/v1/GetBreaks(personId=${encodeURIComponent(personId)},time=${encodeURIComponent(new Date().toISOString())})`)) as Json[] | { value?: Json[] };
    const list = Array.isArray(answer) ? answer : (answer.value ?? []);
    return list
      .filter((b) => b.isAvailable !== false)
      .map((b) => {
        const minutes = parseDuration(typeof b.duration === "string" ? b.duration : null);
        // A length of zero is a flexible ("staggered") break: it has no fixed length of its own.
        return { id: String(b.id), name: String(b.name ?? ""), durationMinutes: minutes === null || minutes === 0 ? null : minutes, paid: b.type === "Paid" };
      });
  }

  /** A person's breaks, remembered for ten minutes (every break start needs them). */
  private async breaksFor(personId: string): Promise<JibbleBreak[]> {
    const cached = this.breakCache.get(personId);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.breaks;
    const breaks = await this.listBreaks(personId);
    this.breakCache.set(personId, { at: Date.now(), breaks });
    return breaks;
  }

  async clock(personId: string, action: JibbleAction, options: ClockOptions = {}): Promise<{ entryId: string | null }> {
    // clientType "Web" because the entry is made by a server on the person's behalf; Jibble stamps the time itself.
    let entry: Record<string, unknown> = { personId, type: action === "EndBreak" ? "In" : action, clientType: "Web", platform: PLATFORM };
    if (action === "StartBreak") {
      // Jibble starts one of the person's breaks: pick the one that fits the length chosen in ELEVATE.
      const chosen = pickBreak(await this.breaksFor(personId), options.breakMinutes ?? null);
      if (!chosen) throw new JibbleError(422, "no break set up for this person in Jibble");
      entry = { ...entry, breakId: chosen.id };
    }
    if (action === "EndBreak" && options.previousEntryId) entry = { ...entry, previousTimeEntryId: options.previousEntryId };
    const url = action === "EndBreak" ? `${this.config.timeTrackingUrl}/v1/TimeEntries/EndBreak` : `${this.config.timeTrackingUrl}/v1/TimeEntries`;
    const json = (await this.send("POST", url, { json: action === "EndBreak" ? { model: entry } : entry })) as Json;
    return { entryId: typeof json.id === "string" ? json.id : null };
  }

  async dailyTracked(personIds: string[], fromDate: string, toDate: string): Promise<JibbleDay[]> {
    const out: JibbleDay[] = [];
    for (let i = 0; i < personIds.length; i += 40) {
      const ids = personIds.slice(i, i + 40).map((id) => `PersonIds=${encodeURIComponent(id)}`).join("&");
      const rows = (await this.send("GET", `${this.config.timeAttendanceUrl}/v2/TimesheetsSummary?Period=Custom&Date=${fromDate}&EndDate=${toDate}&${ids}`)) as unknown;
      const list = Array.isArray(rows) ? (rows as Json[]) : Array.isArray((rows as { value?: unknown }).value) ? ((rows as { value: Json[] }).value) : [];
      for (const r of list) {
        for (const d of (Array.isArray(r.daily) ? (r.daily as Json[]) : [])) {
          const minutes = parseDuration(typeof d.tracked === "string" ? d.tracked : null);
          if (typeof d.date === "string" && minutes !== null) out.push({ personId: String(r.personId), date: d.date.slice(0, 10), trackedMinutes: minutes });
        }
      }
    }
    return out;
  }
}
