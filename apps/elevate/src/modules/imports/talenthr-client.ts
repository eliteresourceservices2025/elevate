// A small read-only client for TalentHR's public API (https://pubapi.talenthr.io/v1, HTTP basic auth, 2,000 requests a minute).
// Plain fetch with no server-only import, so the pull script and the tests can use it. It only ever sends GET requests, never logs the key,
// and sends credentials only to TalentHR's own host.

export const TALENTHR_BASE = "https://pubapi.talenthr.io/v1";

export type TalentHrDirectoryRow = { id: number; first_name: string; last_name: string; email: string; termination_date: string | null };
export type TalentHrDocument = { id: number; client_filename: string; filename: string; filetype: string; is_employee_file: boolean; url: string | null; deleted_at: string | null };
export type TalentHrBudget = { id: number; employee_id: number; budget: string; year: string; timeoff_type_name: string; timeoff_type_slug: string; used_budget: string; original_budget: string; paid: boolean };
export type TalentHrTimeOff = { id: number; approved: boolean; budget: string; is_canceled: boolean; start_date: string; end_date: string; timeoff_type_name: string; timeoff_type_slug: string };

/** What the pull needs. Tests provide a fake with the same shape. */
export interface TalentHrApi {
  directory(): Promise<TalentHrDirectoryRow[]>;
  documents(employeeId: number): Promise<TalentHrDocument[]>;
  downloadDocument(doc: TalentHrDocument, maxBytes: number): Promise<{ bytes: Uint8Array } | { error: "too_large" | "download_failed" }>;
  timeOffBudgets(employeeId: number): Promise<TalentHrBudget[]>;
  timeOffRequests(employeeId: number): Promise<TalentHrTimeOff[]>;
  jobPositions(): Promise<unknown[]>;
  applicants(): Promise<unknown[]>;
}

type Envelope<T> = { success?: boolean; data?: T };

export class TalentHrHttpError extends Error {
  constructor(public readonly status: number) {
    super(`TalentHR answered ${status}`);
    this.name = "TalentHrHttpError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createTalentHrClient(opts: { apiKey: string; scheme?: "key-as-user" | "key-as-password"; baseUrl?: string; fetchImpl?: typeof fetch; delayMs?: number }): TalentHrApi {
  const base = opts.baseUrl ?? TALENTHR_BASE;
  const host = new URL(base).host;
  const f = opts.fetchImpl ?? fetch;
  const delay = opts.delayMs ?? 40; // about 1,500 a minute at most, under the 2,000 limit
  const token = Buffer.from(opts.scheme === "key-as-password" ? `:${opts.apiKey}` : `${opts.apiKey}:`).toString("base64");
  const headers = { Authorization: `Basic ${token}`, Accept: "application/json" };

  async function get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(delay);
      const res = await f(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.min(Number(res.headers.get("retry-after") ?? 0) * 1000 || 1000 * 2 ** attempt, 30_000);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new TalentHrHttpError(res.status);
      return (await res.json()) as T;
    }
    throw new TalentHrHttpError(503);
  }

  /** Lists that come as { total, rows } and take limit and offset. */
  async function paged<T>(path: string, extra: Record<string, string | number> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let offset = 0; ; offset += 100) {
      const res = await get<Envelope<{ total: number; rows: T[] } | T[]>>(path, { limit: 100, offset, ...extra });
      const data = res.data;
      const rows = Array.isArray(data) ? data : (data?.rows ?? []);
      out.push(...rows);
      const total = Array.isArray(data) ? rows.length : (data?.total ?? rows.length);
      if (rows.length < 100 || out.length >= total) return out;
    }
  }

  const list = async <T>(path: string) => ((await get<Envelope<T[]>>(path)).data ?? []) as T[];

  return {
    directory: () => paged<TalentHrDirectoryRow>("/directory"),
    documents: async (id) => (await list<TalentHrDocument>(`/employees/${id}/documents`)).filter((d) => !d.deleted_at),
    async downloadDocument(doc, maxBytes) {
      if (!doc.url) return { error: "download_failed" };
      try {
        const target = new URL(doc.url);
        // Credentials go only to TalentHR's own API host; a file link on another host is fetched without them
        const res = await f(target, { headers: target.host === host ? headers : {}, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return { error: "download_failed" };
        const length = Number(res.headers.get("content-length") ?? 0);
        if (length > maxBytes) return { error: "too_large" };
        const bytes = new Uint8Array(await res.arrayBuffer());
        return bytes.length > maxBytes ? { error: "too_large" } : { bytes };
      } catch {
        return { error: "download_failed" };
      }
    },
    timeOffBudgets: (id) => list<TalentHrBudget>(`/employees/${id}/time-off-budgets`),
    timeOffRequests: (id) => paged<TalentHrTimeOff>(`/employees/${id}/time-off-requests`),
    jobPositions: () => list<unknown>("/job-positions"),
    applicants: () => paged<unknown>("/ats-applicants"),
  };
}

/** Finds out which way the key works (as the user name or as the password) with one cheap call. Returns null when neither does. */
export async function probeTalentHr(apiKey: string, fetchImpl?: typeof fetch): Promise<"key-as-user" | "key-as-password" | null> {
  for (const scheme of ["key-as-user", "key-as-password"] as const) {
    const token = Buffer.from(scheme === "key-as-password" ? `:${apiKey}` : `${apiKey}:`).toString("base64");
    try {
      const res = await (fetchImpl ?? fetch)(`${TALENTHR_BASE}/employment-statuses`, { headers: { Authorization: `Basic ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) return scheme;
    } catch {
      // try the next way
    }
  }
  return null;
}
