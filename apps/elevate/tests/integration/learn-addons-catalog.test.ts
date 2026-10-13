import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Courses as data (client add-ons, step 1): the course list comes from the database for add-ons, the table's checks keep the
// kind and client together, and the nightly core assignment never touches an add-on.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { listLearnCourses, findLearnCourse } = await import("@/modules/learn/course-catalog");
const { runLearnAssign } = await import("@/modules/learn/jobs");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeClient() {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Addon client ")}) returning id`);
  return c.id;
}

describe("client add-on courses in the catalog", () => {
  it("lists add-ons after the core courses, with their client, and hides an archived one", async () => {
    const clientId = await makeClient();
    const slug = uniq("acme-").toLowerCase();
    await db.execute(sql`insert into learn.courses (slug, title, kind, client_id, label, noun, fixed_track) values (${slug}, 'Acme requirements', 'client_addon', ${clientId}, 'Acme', 'Acme training', 'full')`);

    const list = await listLearnCourses(db);
    expect(list.slice(0, 2).map((c) => c.slug)).toEqual(["hipaa", "cybersecurity"]);
    expect(list.find((c) => c.slug === slug)).toMatchObject({ kind: "client_addon", clientId, label: "Acme", noun: "Acme training", fixedTrack: "full" });
    expect((await findLearnCourse(db, slug))?.clientId).toBe(clientId);

    await db.execute(sql`update learn.courses set archived_at = now() where slug = ${slug}`);
    expect((await listLearnCourses(db)).some((c) => c.slug === slug)).toBe(false);
    expect((await listLearnCourses(db, { includeArchived: true })).some((c) => c.slug === slug)).toBe(true);
  });

  it("the database keeps kind and client together", async () => {
    const clientId = await makeClient();
    await expect(db.execute(sql`insert into learn.courses (slug, title, kind) values (${uniq("noclient-")}, 'x', 'client_addon')`)).rejects.toThrow();
    await expect(db.execute(sql`insert into learn.courses (slug, title, kind, client_id) values (${uniq("core-")}, 'x', 'core', ${clientId})`)).rejects.toThrow();
    await expect(db.execute(sql`insert into learn.courses (slug, title, kind) values (${uniq("badkind-")}, 'x', 'other')`)).rejects.toThrow();
    await expect(db.execute(sql`insert into learn.courses (slug, title, fixed_track) values (${uniq("badtrack-")}, 'x', 'expert')`)).rejects.toThrow();
  });

  it("the nightly core assignment skips an add-on and an unknown course", async () => {
    const clientId = await makeClient();
    const slug = uniq("skip-").toLowerCase();
    await db.execute(sql`insert into learn.courses (slug, title, kind, client_id) values (${slug}, 'Skip me', 'client_addon', ${clientId})`);
    expect(await runLearnAssign("2026-10-12", { userIds: [randomUUID()] }, slug)).toMatchObject({ skipped: true, assigned: 0 });
    expect(await runLearnAssign("2026-10-12", { userIds: [randomUUID()] }, "no-such-course")).toMatchObject({ skipped: true });
  });
});
