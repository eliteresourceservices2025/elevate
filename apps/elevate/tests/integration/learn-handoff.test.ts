import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { testDatabaseUrl } from "./global-setup";

// The sign-in handoff end to end against the real database: ELEVATE's action makes a token, Learn's real handlers (run by relative
// path, through the real learn_app role) turn it into a session. Covers single use, expiry, the origin check, the rate limit, cookie
// flags, hashes only in the database, no token in the audit log, an account deactivated afterwards, and signing out.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: vi.fn(async () => "password, totp") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.31" }), cookies: async () => ({ get: () => undefined }) }));

const APP_PASSWORD = "learn-app-test-password-not-a-secret";
const adminUrl = process.env.TEST_DB_ADMIN_URL!;
const ELEVATE = "https://elevate.example.com";
const LEARN = "https://learn.example.com";

process.env.NEXT_PUBLIC_LEARN_URL = LEARN;

const admin = postgres(testDatabaseUrl(adminUrl), { max: 2, onnotice: () => {} });
await admin.unsafe(`alter role learn_app login password '${APP_PASSWORD}'`);
const appUrl = new URL(testDatabaseUrl(adminUrl));
appUrl.username = "learn_app";
appUrl.password = APP_PASSWORD;
const app = postgres(appUrl.toString(), { max: 2, onnotice: () => {}, prepare: false });

const { db } = await import("@/lib/db");
const actions = await import("@/modules/learn/actions");
const { handleHandoff, handleSignOut, resolveSession } = await import("../../../learn/src/lib/handlers");

afterAll(async () => {
  await app.end();
  await admin.end();
});

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;

async function makePerson(roles: RoleSlug[] = ["employee"]) {
  const id = randomUUID();
  const email = `learn${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values ('Ana', 'Cruz', ${email}, 'active', ${id}, '2026-01-05')`);
  return { id, email, roles };
}

const deps = (over: Partial<Parameters<typeof handleHandoff>[1]> = {}) => ({
  sql: app,
  elevateOrigin: ELEVATE,
  production: true,
  allow: async () => true,
  ...over,
});

const post = (token: string, origin: string | null = ELEVATE) =>
  new Request(`${LEARN}/auth/handoff`, {
    method: "POST",
    body: new URLSearchParams({ token }),
    headers: origin ? { origin, "content-type": "application/x-www-form-urlencoded" } : { "content-type": "application/x-www-form-urlencoded" },
  });

async function launchFor(person: { id: string; email: string; roles: RoleSlug[] }) {
  current.user = person;
  const r = await actions.startLearnLaunch();
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

const cookieValue = (setCookie: string) => setCookie.split(";")[0].split("=")[1];

describe("the handoff from ELEVATE to Learn", () => {
  it("makes a token, posts it to Learn's address, and turns it into a session", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    expect(launch.action).toBe(`${LEARN}/auth/handoff`);
    expect(launch.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const res = await handleHandoff(post(launch.token), deps());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${LEARN}/`);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-learn_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toMatch(/Domain=/i);

    // the cookie resolves to the right person, with how they signed in
    const session = await resolveSession(cookie.split(";")[0], deps());
    expect(session?.userId).toBe(person.id);
    expect(session?.authMethods).toEqual(["password", "totp"]);
  });

  it("stores only hashes: not the token, not the cookie value", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    const res = await handleHandoff(post(launch.token), deps());
    const value = cookieValue(res.headers.get("set-cookie")!);
    const stored = await rows<{ token_hash: Buffer }>(sql`select token_hash from learn.launch_tokens where user_id = ${person.id}`);
    expect(stored.length).toBe(1);
    expect(stored[0].token_hash.length).toBe(32);
    expect(Buffer.from(launch.token).equals(stored[0].token_hash)).toBe(false);
    const sessions = await rows<{ token_hash: Buffer }>(sql`select token_hash from learn.sessions where user_id = ${person.id}`);
    expect(sessions.length).toBe(1);
    expect(Buffer.from(value).equals(sessions[0].token_hash)).toBe(false);
    // and nothing about the token reaches the audit log
    const audit = await rows<{ metadata: unknown; action: string }>(sql`select action, to_jsonb(a) as metadata from ops.audit_log a where actor_user_id = ${person.id} and action = 'learn.launch'`);
    expect(audit.length).toBe(1);
    expect(JSON.stringify(audit[0].metadata)).not.toContain(launch.token);
  });

  it("works once: a second use of the same token goes to the expired page", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    expect((await handleHandoff(post(launch.token), deps())).headers.get("location")).toBe(`${LEARN}/`);
    const again = await handleHandoff(post(launch.token), deps());
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(`${LEARN}/expired`);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an expired token, an unknown one and a malformed one the same way", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    await admin`update learn.launch_tokens set expires_at = now() - interval '1 second' where user_id = ${person.id}`;
    for (const token of [launch.token, "A".repeat(43), "not-a-token"]) {
      const res = await handleHandoff(post(token), deps());
      expect(res.headers.get("location")).toBe(`${LEARN}/expired`);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("only accepts a post that comes from ELEVATE", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    expect((await handleHandoff(post(launch.token, "https://evil.example.com"), deps())).status).toBe(403);
    expect((await handleHandoff(post(launch.token, null), deps())).status).toBe(403);
    expect((await handleHandoff(post(launch.token, ELEVATE), deps({ elevateOrigin: null }))).status).toBe(403);
    // a refused request did not use the token up
    expect((await handleHandoff(post(launch.token), deps())).headers.get("location")).toBe(`${LEARN}/`);
  });

  it("refuses when the rate limit says so", async () => {
    const person = await makePerson();
    const launch = await launchFor(person);
    const res = await handleHandoff(post(launch.token), deps({ allow: async () => false }));
    expect(res.status).toBe(429);
  });

  it("does not sign in an account that was deactivated, and ends a session when it is", async () => {
    const gone = await makePerson();
    const launch = await launchFor(gone);
    await db.execute(sql`update core.users set archived_at = now() where id = ${gone.id}`);
    expect((await handleHandoff(post(launch.token), deps())).headers.get("location")).toBe(`${LEARN}/expired`);

    const person = await makePerson();
    const l2 = await launchFor(person);
    const res = await handleHandoff(post(l2.token), deps());
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    expect((await resolveSession(cookie, deps()))?.userId).toBe(person.id);
    await db.execute(sql`update core.users set archived_at = now() where id = ${person.id}`);
    expect(await resolveSession(cookie, deps())).toBeNull();
  });

  it("signs out: the session ends, the cookie is cleared, and only a same-site form may ask", async () => {
    const person = await makePerson();
    const l = await launchFor(person);
    const cookie = (await handleHandoff(post(l.token), deps())).headers.get("set-cookie")!.split(";")[0];
    const out = (origin: string | null) =>
      new Request(`${LEARN}/auth/signout`, { method: "POST", headers: origin ? { origin, cookie, host: "learn.example.com" } : { cookie, host: "learn.example.com" } });

    expect((await handleSignOut(out("https://evil.example.com"), deps())).status).toBe(403);
    expect((await resolveSession(cookie, deps()))?.userId).toBe(person.id);

    const res = await handleSignOut(out(LEARN), deps());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${LEARN}/signed-out`);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await resolveSession(cookie, deps())).toBeNull();
  });

  it("ignores a cookie that is missing or not ours", async () => {
    expect(await resolveSession(null, deps())).toBeNull();
    expect(await resolveSession("__Host-learn_session=short", deps())).toBeNull();
    expect(await resolveSession(`__Host-learn_session=${"B".repeat(43)}`, deps())).toBeNull();
  });
});
