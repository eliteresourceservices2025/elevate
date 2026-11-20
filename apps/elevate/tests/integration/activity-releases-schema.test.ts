import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

// Releases are frozen once published; builds belong to a draft; both tables have row level security.

const { db } = await import("@/lib/db");
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const dbMessage = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    const err = e as { message: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message;
  }
  return "";
};

let n = 0;
async function release(status = "draft") {
  const version = `9.${Date.now() % 100_000}.${n++}`;
  const [r] = await rows<{ id: string; version: string }>(sql`insert into time.tracker_releases (version, status, notes_added, created_by) values (${version}, ${status}, array['Something new'], ${randomUUID()}) returning id, version`);
  return r;
}
const build = (releaseId: string, platform = "windows-x86_64", kind = "installer", signature: string | null = null) =>
  db.execute(sql`insert into time.tracker_release_builds (release_id, platform, kind, storage_path, file_name, size_bytes, sha256, signature) values (${releaseId}, ${platform}, ${kind}, ${`releases/${randomUUID()}`}, 'app.exe', 1000000, 'abc', ${signature})`);

describe("a draft release", () => {
  it("can be edited and deleted", async () => {
    const r = await release();
    await db.execute(sql`update time.tracker_releases set notes_fixed = array['A fix'], min_required = true where id = ${r.id}`);
    await db.execute(sql`delete from time.tracker_releases where id = ${r.id}`);
  });
  it("needs a version of the form MAJOR.MINOR.PATCH, and a version is used once", async () => {
    expect(await dbMessage(() => db.execute(sql`insert into time.tracker_releases (version, created_by) values ('1.2', ${randomUUID()})`))).not.toBe("");
    expect(await dbMessage(() => db.execute(sql`insert into time.tracker_releases (version, created_by) values ('1x2x3', ${randomUUID()})`))).not.toBe(""); // the dots are real dots
    const r = await release();
    expect(await dbMessage(() => db.execute(sql`insert into time.tracker_releases (version, created_by) values (${r.version}, ${randomUUID()})`))).not.toBe("");
  });
});

describe("a published release", () => {
  it("cannot be changed or deleted", async () => {
    const r = await release();
    await db.execute(sql`update time.tracker_releases set status = 'published', published_at = now(), published_by = ${randomUUID()} where id = ${r.id}`);
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set notes_fixed = array['Edited'] where id = ${r.id}`))).toMatch(/frozen|published/);
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set version = '9.9.9' where id = ${r.id}`))).toMatch(/frozen|published/);
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set min_required = true where id = ${r.id}`))).toMatch(/frozen|published/);
    expect(await dbMessage(() => db.execute(sql`delete from time.tracker_releases where id = ${r.id}`))).toMatch(/frozen|published|cannot be deleted/);
  });
  it("can be withdrawn, once, and a withdrawn one cannot change again", async () => {
    const r = await release();
    await db.execute(sql`update time.tracker_releases set status = 'published', published_at = now(), published_by = ${randomUUID()} where id = ${r.id}`);
    await db.execute(sql`update time.tracker_releases set status = 'withdrawn', withdrawn_at = now() where id = ${r.id}`);
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set status = 'published' where id = ${r.id}`))).not.toBe("");
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set notes_added = array['x'] where id = ${r.id}`))).not.toBe("");
  });
  it("cannot go back to a draft", async () => {
    const r = await release();
    await db.execute(sql`update time.tracker_releases set status = 'published', published_at = now(), published_by = ${randomUUID()} where id = ${r.id}`);
    expect(await dbMessage(() => db.execute(sql`update time.tracker_releases set status = 'draft' where id = ${r.id}`))).not.toBe("");
  });
});

describe("builds", () => {
  it("can be added to a draft but not to a published release, and cannot be removed once published", async () => {
    const draft = await release();
    await build(draft.id);
    const published = await release();
    await build(published.id);
    await db.execute(sql`update time.tracker_releases set status = 'published', published_at = now(), published_by = ${randomUUID()} where id = ${published.id}`);
    expect(await dbMessage(() => build(published.id, "darwin-aarch64"))).toMatch(/draft|published|frozen/);
    expect(await dbMessage(() => db.execute(sql`delete from time.tracker_release_builds where release_id = ${published.id}`))).toMatch(/draft|published|frozen/);
  });
  it("cannot be moved out of a published release into a draft, and cannot all be wiped by truncating the table", async () => {
    const published = await release();
    await build(published.id);
    await db.execute(sql`update time.tracker_releases set status = 'published', published_at = now(), published_by = ${randomUUID()} where id = ${published.id}`);
    const draft = await release();
    expect(await dbMessage(() => db.execute(sql`update time.tracker_release_builds set release_id = ${draft.id} where release_id = ${published.id}`))).toMatch(/draft/);
    expect(await rows(sql`select 1 from time.tracker_release_builds where release_id = ${published.id}`)).toHaveLength(1);
    expect(await dbMessage(() => db.execute(sql`truncate time.tracker_release_builds`))).toMatch(/truncated/);
  });
  it("allow one per release, platform and kind", async () => {
    const r = await release();
    await build(r.id);
    expect(await dbMessage(() => build(r.id))).not.toBe("");
    await build(r.id, "windows-x86_64", "update", "SIGTEXT");
  });
  it("need a signature for an update build, and a known platform", async () => {
    const r = await release();
    expect(await dbMessage(() => build(r.id, "windows-x86_64", "update", null))).not.toBe("");
    expect(await dbMessage(() => build(r.id, "linux-x86_64"))).not.toBe("");
  });
});

describe("row level security", () => {
  it("is on for both tables", async () => {
    const found = await rows<{ relrowsecurity: boolean }>(sql`select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'time' and c.relname in ('tracker_releases', 'tracker_release_builds')`);
    expect(found).toHaveLength(2);
    expect(found.every((r) => r.relrowsecurity)).toBe(true);
  });
});
