import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage } from "./fake-storage";

// Real-database tests for profile photos, with storage replaced by an in-memory fake.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { ForbiddenError } = await import("@/lib/authz");
const photoActions = await import("@/modules/people/photo-actions");
const service = await import("@/modules/people/photo-service");
const queries = await import("@/modules/people/photo-queries");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const fake = new FakeStorage();
setDocumentStorage(fake);

let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const SECRET = "GPS-secret-location";
function jpeg(size = 320) {
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe1, [...Buffer.from(`Exif\0\0${SECRET}`)]),
    ...seg(0xdb, [0, ...new Array<number>(64).fill(8)]),
    ...seg(0xc0, [8, size >> 8, size & 0xff, size >> 8, size & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0x34, 0xff, 0xd9,
  ]);
}

const photoRow = async (id: string) => (await rows<{ photo_path: string | null; ms: string | null }>(sql`select photo_path, floor(extract(epoch from photo_updated_at) * 1000)::bigint::text as ms from core.users where id = ${id}`))[0];
const auditActions = async (id: string) => (await rows<{ action: string }>(sql`select action from ops.audit_log where target_id = ${id} and action like 'profile.photo%' order by id`)).map((r) => r.action);

describe("profile photo", () => {
  it("stores a cleaned copy under the person's own folder and records it", async () => {
    const me = await makeUser("photo", ["employee"]);
    as(me);
    expect(await queries.getMyPhotoVersion()).toBeNull();

    const result = await service.saveOwnPhoto(me, jpeg());
    expect(result).toEqual({ ok: true });

    const row = await photoRow(me.id);
    expect(row.photo_path).toMatch(new RegExp(`^avatars/${me.id}/[0-9a-f-]{36}\\.jpg$`));
    const stored = await fake.read("employee-docs", row.photo_path!);
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!).includes(Buffer.from(SECRET))).toBe(false); // the location detail never reaches storage
    expect(await queries.getMyPhotoVersion()).toBe(Number(row.ms));
    expect(await auditActions(me.id)).toEqual(["profile.photo_set"]);
  });

  it("refuses a file that is not a picture and stores nothing", async () => {
    const me = await makeUser("notpic", ["employee"]);
    as(me);
    const before = fake.objects.size;
    const result = await service.saveOwnPhoto(me, new TextEncoder().encode("%PDF-1.4 not a picture"));
    expect(result.ok).toBe(false);
    expect(fake.objects.size).toBe(before);
    expect((await photoRow(me.id)).photo_path).toBeNull();
  });

  it("a new photo replaces the old one and the old file is removed", async () => {
    const me = await makeUser("replace", ["employee"]);
    as(me);
    await service.saveOwnPhoto(me, jpeg());
    const first = (await photoRow(me.id)).photo_path!;
    await service.saveOwnPhoto(me, jpeg(200));
    const second = (await photoRow(me.id)).photo_path!;
    expect(second).not.toBe(first);
    expect(await fake.read("employee-docs", first)).toBeNull();
    expect(await fake.read("employee-docs", second)).not.toBeNull();
  });

  it("any signed-in colleague can read it; nothing is returned for a person with no photo", async () => {
    const owner = await makeUser("owner", ["employee"]);
    const colleague = await makeUser("colleague", ["employee"]);
    const nobody = await makeUser("nobody", ["employee"]);
    await service.saveOwnPhoto(owner, jpeg());
    expect(await service.readPhotoOf(colleague, owner.id)).not.toBeNull();
    expect(await service.readPhotoOf(colleague, nobody.id)).toBeNull();
    expect(await service.readPhotoOf(colleague, randomUUID())).toBeNull();
    await expect(service.readPhotoOf({ ...colleague, roles: [] }, owner.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an archived account's photo is not served", async () => {
    const gone = await makeUser("gone", ["employee"]);
    const viewer = await makeUser("viewer", ["employee"]);
    await service.saveOwnPhoto(gone, jpeg());
    await db.execute(sql`update core.users set archived_at = now() where id = ${gone.id}`);
    expect(await service.readPhotoOf(viewer, gone.id)).toBeNull();
  });

  it("a person removes their own; HR removes anyone's; a colleague cannot", async () => {
    const owner = await makeUser("rm", ["employee"]);
    const colleague = await makeUser("rmcol", ["employee"]);
    const hr = await makeUser("rmhr", ["hr_admin"]);

    await service.saveOwnPhoto(owner, jpeg());
    as(colleague);
    expect(await photoActions.removeProfilePhoto({ userId: owner.id })).toEqual({ ok: false, error: "You do not have access to do that." });
    expect((await photoRow(owner.id)).photo_path).not.toBeNull();

    as(hr);
    expect((await photoActions.removeProfilePhoto({ userId: owner.id })).ok).toBe(true);
    const after = await photoRow(owner.id);
    expect(after.photo_path).toBeNull();
    expect(await auditActions(owner.id)).toEqual(["profile.photo_set", "profile.photo_remove"]);

    await service.saveOwnPhoto(owner, jpeg());
    as(owner);
    expect((await photoActions.removeProfilePhoto()).ok).toBe(true);
    expect((await photoRow(owner.id)).photo_path).toBeNull();
    // removing when there is none is harmless
    expect((await photoActions.removeProfilePhoto()).ok).toBe(true);
  });

  it("a stored path that is not this module's is never read", async () => {
    const owner = await makeUser("badpath", ["employee"]);
    const viewer = await makeUser("badview", ["employee"]);
    await fake.write("employee-docs", "selfies/other/x.jpg", jpeg(), "image/jpeg");
    await db.execute(sql`update core.users set photo_path = 'selfies/other/x.jpg', photo_updated_at = now() where id = ${owner.id}`);
    expect(await service.readPhotoOf(viewer, owner.id)).toBeNull();
  });
});
