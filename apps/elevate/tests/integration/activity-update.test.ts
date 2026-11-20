import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// The update feed, release notes and the version floor with real releases, called through the real route handlers.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const releaseActions = await import("@/modules/activity/release-actions");
const service = await import("@/modules/activity/releases-service");
const { newDeviceToken } = await import("@/modules/activity/device-token");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const update = await import("@/app/api/tracker/update/route");
const download = await import("@/app/api/tracker/update/download/[platform]/route");
const notes = await import("@/app/api/tracker/releases/[version]/route");
const segments = await import("@/app/api/tracker/segments/route");

setDocumentStorage(new FakeStorage());
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function hrUser() {
  const id = randomUUID();
  const email = `upd${Date.now().toString(36)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'hr_admin')`);
  return { id, email, roles: ["hr_admin"] };
}
async function device(status = "active") {
  const userId = randomUUID();
  const email = `dev${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${email})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Up', 'Date', ${email}, 'active', ${userId}) returning id`);
  const { token, hash } = newDeviceToken();
  await db.execute(sql`insert into time.tracker_devices (employee_id, name, os, token_hash, status) values (${e.id}, 'PC', 'windows', ${hash}, ${status})`);
  return token;
}
let minor = 1;
const requiredVersions: string[] = []; // every release published as "required", in order
async function publish(opts: { minRequired?: boolean } = {}) {
  const version = `80.${minor++}.0`;
  const created = await releaseActions.createRelease({ version, added: "A thing", improved: "", fixed: "", minRequired: opts.minRequired ?? false, addsCollection: false, policyVersionId: null });
  if (!created.ok) throw new Error(created.error);
  for (const kind of ["installer", "update"] as const) {
    const r = await service.registerBuild({ version, platform: "windows-x86_64", kind, storagePath: `releases/${version}/${kind}/${randomUUID()}.exe`, fileName: "app.exe", sizeBytes: 1_000_000, sha256: "e".repeat(64), signature: kind === "update" ? `SIG-${version}` : null });
    if (!r.ok) throw new Error(r.error);
  }
  const published = await releaseActions.publishRelease({ id: created.data.id });
  if (!published.ok) throw new Error(published.error);
  if (opts.minRequired) requiredVersions.push(version);
  return { id: created.data.id, version };
}
const auth = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
const req = (path: string, token: string, extra: Record<string, string> = {}) => new Request(`http://localhost${path}`, { headers: auth(token, extra) });

describe("update feed with real releases", () => {
  it("offers a device on an older version the newest published release, and not a withdrawn one", async () => {
    current.user = await hrUser();
    const older = await publish();
    const newest = await publish();
    const withdrawn = await publish();
    await releaseActions.withdrawRelease({ id: withdrawn.id });
    const token = await device();
    const res = await update.GET(req(`/api/tracker/update?platform=windows-x86_64&version=${older.version}`, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(newest.version);
    expect(body.signature).toBe(`SIG-${newest.version}`);
    expect((await update.GET(req(`/api/tracker/update?platform=windows-x86_64&version=${newest.version}`, token))).status).toBe(204);
    const dl = await download.GET(req(`/api/tracker/update/download/windows-x86_64?version=${newest.version}`, token), { params: Promise.resolve({ platform: "windows-x86_64" }) });
    expect(dl.status).toBe(302);
    expect(dl.headers.get("location")).toContain("fake://tracker-builds/");
    const gone = await download.GET(req(`/api/tracker/update/download/windows-x86_64?version=${withdrawn.version}`, token), { params: Promise.resolve({ platform: "windows-x86_64" }) });
    expect(gone.status).toBe(404);
    const noteRes = await notes.GET(req(`/api/tracker/releases/${newest.version}`, token), { params: Promise.resolve({ version: newest.version }) });
    expect((await noteRes.json()).notes.added).toEqual(["A thing"]);
  });

  it("refuses a revoked device on all three routes", async () => {
    current.user = await hrUser();
    const r = await publish();
    const token = await device("revoked");
    expect((await update.GET(req("/api/tracker/update?platform=windows-x86_64&version=1.0.0", token))).status).toBe(401);
    expect((await download.GET(req(`/api/tracker/update/download/windows-x86_64?version=${r.version}`, token), { params: Promise.resolve({ platform: "windows-x86_64" }) })).status).toBe(401);
    expect((await notes.GET(req(`/api/tracker/releases/${r.version}`, token), { params: Promise.resolve({ version: r.version }) })).status).toBe(401);
  });
});

describe("the version floor with real releases", () => {
  it("refuses uploads from an app below the required version, lets a current one through, and the update route stays open", async () => {
    current.user = await hrUser();
    const required = await publish({ minRequired: true });
    const token = await device();
    const body = JSON.stringify({ segments: [{ start: new Date(Date.now() - 120_000).toISOString(), end: new Date(Date.now() - 60_000).toISOString(), app: "Chrome", state: "active" }] });
    const post = (version?: string) => segments.POST(new Request("http://localhost/api/tracker/segments", { method: "POST", headers: { ...auth(token, version ? { "x-tracker-version": version } : {}), "content-type": "application/json" }, body }));
    const old = await post("80.0.5");
    expect(old.status).toBe(426);
    expect(await old.json()).toEqual({ error: "update_required", minVersion: required.version });
    expect((await post(required.version)).status).not.toBe(426);
    expect((await post()).status).not.toBe(426); // an app that sends no version is not blocked (the simulator)
    const feed = await update.GET(req("/api/tracker/update?platform=windows-x86_64&version=80.0.5", token, { "x-tracker-version": "80.0.5" }));
    expect(feed.status).toBe(200);
  });

  it("stops requiring a release once it is withdrawn", async () => {
    current.user = await hrUser();
    const required = await publish({ minRequired: true });
    const token = await device();
    const post = () => segments.POST(new Request("http://localhost/api/tracker/segments", { method: "POST", headers: { ...auth(token, { "x-tracker-version": "80.0.5" }), "content-type": "application/json" }, body: JSON.stringify({ segments: [{ start: new Date(Date.now() - 120_000).toISOString(), end: new Date(Date.now() - 60_000).toISOString(), app: "Chrome", state: "active" }] }) }));
    const before = await post();
    expect(before.status).toBe(426);
    expect((await before.json()).minVersion).toBe(required.version);
    await releaseActions.withdrawRelease({ id: required.id });
    // The floor falls back to the previous required release (published by the test above), never the withdrawn one.
    const after = await post();
    expect(after.status).toBe(426);
    const floor = (await after.json()).minVersion;
    expect(floor).not.toBe(required.version);
    expect(floor).toBe(requiredVersions[requiredVersions.length - 2]);
  });
});
