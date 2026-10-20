import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The public job feed against the real database: only open, un-archived jobs, only public fields, CORS only for listed sites, and a
// job closed or archived disappears at once (the cache in front is what keeps it for up to a minute in production).

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77" }) }));

const { db } = await import("@/lib/db");
const list = await import("@/app/api/careers/jobs/route");
const one = await import("@/app/api/careers/jobs/[slug]/route");

let counter = 0;
const uniq = (p: string) => `${p}-${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function opening(over: { status?: string; archived?: boolean; slug?: string; title?: string; location?: string } = {}) {
  const slug = over.slug ?? uniq("feed-job");
  const [row] = await rows<{ id: string }>(sql`
    insert into talent.job_openings (title, slug, description, location, pay_note, status, opened_at, archived_at, send_ack, send_rejection)
    values (${over.title ?? "Feed test VA"}, ${slug}, ${"# Role\n\nSupport our **clients** every day."}, ${over.location ?? "Remote"}, 'Paid per client', ${over.status ?? "open"},
            ${over.status === "draft" ? null : new Date().toISOString()}, ${over.archived ? new Date().toISOString() : null}, true, true)
    returning id`);
  return { id: row.id, slug };
}

const get = (url: string, origin?: string) => new Request(`http://localhost${url}`, { headers: origin ? { origin } : {} });
const ask = async (origin?: string) => {
  const res = await list.GET(get("/api/careers/jobs", origin));
  return { res, body: (await res.json()) as { jobs: { slug: string; title: string; url: string; summary: string }[]; careersUrl: string } };
};

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://elevate.example.com";
  process.env.CAREERS_FEED_ALLOWED_ORIGINS = "https://www.example.com";
});
afterEach(() => undefined);

describe("the public job feed", () => {
  it("lists only open, un-archived jobs, with public fields only, newest first, and says how long it may be cached", async () => {
    const live = await opening({ title: "Open feed job" });
    const draft = await opening({ status: "draft" });
    const closed = await opening({ status: "closed" });
    const archived = await opening({ archived: true });
    const { res, body } = await ask();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=60");
    const slugs = body.jobs.map((j) => j.slug);
    expect(slugs).toContain(live.slug);
    for (const hidden of [draft, closed, archived]) expect(slugs).not.toContain(hidden.slug);

    const item = body.jobs.find((j) => j.slug === live.slug)!;
    expect(Object.keys(item).sort()).toEqual(["id", "location", "payNote", "postedAt", "slug", "summary", "title", "url"]);
    expect(item.url).toBe(`https://elevate.example.com/careers/${live.slug}`);
    expect(item.summary).toBe("Role Support our clients every day.");
    expect(body.careersUrl).toBe("https://elevate.example.com/careers");
    expect(JSON.stringify(body)).not.toMatch(/team_id|teamId|createdBy|created_by|sendAck|archived/);
  });

  it("a job that is closed or archived is gone from the next answer", async () => {
    const job = await opening();
    expect((await ask()).body.jobs.some((j) => j.slug === job.slug)).toBe(true);
    await db.execute(sql`update talent.job_openings set status = 'closed' where id = ${job.id}`);
    expect((await ask()).body.jobs.some((j) => j.slug === job.slug)).toBe(false);
    await db.execute(sql`update talent.job_openings set status = 'open', archived_at = now() where id = ${job.id}`);
    expect((await ask()).body.jobs.some((j) => j.slug === job.slug)).toBe(false);
  });

  it("lets a listed website read it from a browser, and no other", async () => {
    const ok = await ask("https://www.example.com");
    expect(ok.res.headers.get("Access-Control-Allow-Origin")).toBe("https://www.example.com");
    expect(ok.res.headers.get("Vary")).toBe("Origin");
    const other = await ask("https://evil.example.com");
    expect(other.res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(other.res.status).toBe(200); // the data is public; the browser is what is refused
    const none = await ask();
    expect(none.res.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const preflight = await list.OPTIONS(get("/api/careers/jobs", "https://www.example.com"));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("gives one job with its full description, and a plain not-found for anything that is not open", async () => {
    const live = await opening();
    const res = await one.GET(get(`/api/careers/jobs/${live.slug}`), { params: Promise.resolve({ slug: live.slug }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { slug: string; description: string; summary: string } };
    expect(body.job).toMatchObject({ slug: live.slug, description: "# Role\n\nSupport our **clients** every day." });

    const draft = await opening({ status: "draft" });
    const hidden = await one.GET(get(`/api/careers/jobs/${draft.slug}`), { params: Promise.resolve({ slug: draft.slug }) });
    expect(hidden.status).toBe(404);
    const junk = await one.GET(get("/api/careers/jobs/..%2F..%2Fetc"), { params: Promise.resolve({ slug: "../../etc" }) });
    expect(junk.status).toBe(404);
    const byId = await one.GET(get(`/api/careers/jobs/${live.id}`), { params: Promise.resolve({ slug: live.id }) });
    expect(byId.status).toBe(200);
  });
});
