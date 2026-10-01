import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for filing many corrections from a spreadsheet (an outage) and deciding them as a batch.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const HOUR = 3_600_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const utc = (agoMs: number) => new Date(Date.now() - agoMs).toISOString().slice(0, 16).replace("T", " ");
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label).toLowerCase()}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, roles: RoleSlug[] = ["employee"]) {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}) returning id`);
  return { user, employeeId: e.id };
}
const csvFor = (lines: string[]) => ["email,type,time", ...lines].join("\n");
const file = (csv: string, extra: Record<string, unknown> = {}) => actions.fileBulkCorrections({ csv, timeZone: "UTC", reason: "ELEVATE was down for two hours", kind: "connection_problem", ...extra });

let hrA: Awaited<ReturnType<typeof person>>;
let hrB: TestUser;
beforeAll(async () => {
  hrA = await person("BulkHrA", ["hr_admin", "employee"]);
  hrB = await makeUser("BulkHrB", ["hr_admin", "employee"]);
});

describe("filing a batch from a spreadsheet", () => {
  it("files an ordinary correction for each person who fits, lists the rows that do not, and tells the people and the other HR admins", async () => {
    const ana = await person("BulkAna");
    const ben = await person("BulkBen");
    as(hrA.user);
    const result = await file(
      csvFor([
        `${ana.user.email},clock_in,${utc(3 * HOUR)}`,
        `${ana.user.email},clock_out,${utc(2 * HOUR)}`,
        `${ben.user.email},clock_out,${utc(2 * HOUR)}`, // a clock-out with no clock-in does not fit
        "nobody.here@example.com,clock_in,2026-10-05 09:00", // no such person
        "not an email,clock_in,2026-10-05 09:00", // a bad row
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toBe(1);
    expect(result.data.batchId).not.toBeNull();
    expect(result.data.failed.map((f) => f.email).sort()).toEqual([ben.user.email, "nobody.here@example.com"].sort());
    expect(result.data.failed.find((f) => f.email === "nobody.here@example.com")?.error).toBe("No active person has that email.");
    expect(result.data.parseErrors).toEqual([{ line: 6, message: "That is not an email address." }]);

    const [c] = await rows<{ status: string; requested_by: string; kind: string; batch_id: string; reason: string }>(sql`select status, requested_by, kind, batch_id, reason from time.clock_corrections where employee_id = ${ana.employeeId}`);
    expect(c).toMatchObject({ status: "pending", requested_by: hrA.user.id, kind: "connection_problem", batch_id: result.data.batchId });
    expect(await rows(sql`select 1 from time.clock_corrections where employee_id = ${ben.employeeId}`)).toHaveLength(0);
    expect(await notes(ana.user.id, "attendance.correction_filed_for_you")).toHaveLength(1);
    expect((await notes(hrB.id, "attendance.correction_needed")).length).toBeGreaterThanOrEqual(1);
    expect(await notes(hrA.user.id, "attendance.correction_needed")).toHaveLength(0); // the filer is not told to decide it
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock.correction_batch' and actor_user_id = ${hrA.user.id}`)).not.toHaveLength(0);
  });

  it("converts the times from the zone HR chose", async () => {
    const cy = await person("BulkCy");
    as(hrA.user);
    // 9 PM to 5 AM in Manila (UTC+8) is 13:00 to 21:00 UTC, as an earlier day than the 31 day limit allows
    const day = new Date(Date.now() - 3 * 24 * HOUR).toISOString().slice(0, 10);
    const next = new Date(Date.now() - 2 * 24 * HOUR).toISOString().slice(0, 10);
    expect((await file(csvFor([`${cy.user.email},clock_in,${day} 21:00`, `${cy.user.email},clock_out,${next} 05:00`]), { timeZone: "Asia/Manila" })).ok).toBe(true);
    const [c] = await rows<{ proposed: { type: string; at: string }[] }>(sql`select proposed from time.clock_corrections where employee_id = ${cy.employeeId}`);
    expect(c.proposed.map((p) => p.at)).toEqual([`${day}T13:00:00.000Z`, `${day}T21:00:00.000Z`]); // 9 PM to 5 AM Manila is one 8 hour stretch
  });

  it("refuses more than six events for a person, a third waiting correction, and the HR admin's own", async () => {
    const dee = await person("BulkDee");
    as(hrA.user);
    const many = Array.from({ length: 7 }, (_, i) => `${dee.user.email},${i % 2 ? "clock_out" : "clock_in"},${utc((10 - i) * HOUR)}`);
    const tooMany = await file(csvFor(many));
    expect(tooMany.ok && tooMany.data.failed[0].error).toContain("More than six events");

    for (let i = 0; i < 3; i++) await file(csvFor([`${dee.user.email},clock_in,${utc((30 + i * 2) * HOUR)}`, `${dee.user.email},clock_out,${utc((29 + i * 2) * HOUR)}`]));
    const fourth = await file(csvFor([`${dee.user.email},clock_in,${utc(60 * HOUR)}`, `${dee.user.email},clock_out,${utc(59 * HOUR)}`]));
    expect(fourth.ok && fourth.data.failed[0].error).toBe("They already have 3 corrections waiting.");

    const own = await file(csvFor([`${hrA.user.email},clock_in,${utc(3 * HOUR)}`]));
    expect(own.ok && own.data.failed[0].error).toBe("You cannot file your own corrections.");
  });

  it("is HR only, and checks the file, the zone and the reason", async () => {
    const eli = await person("BulkEli");
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nobulkfile", [role]));
      expect(await file(csvFor([`${eli.user.email},clock_in,${utc(3 * HOUR)}`]))).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.decideCorrectionBatch({ batchId: randomUUID(), decision: "approve" })).toEqual({ ok: false, error: NO_ACCESS });
      await expect(queries.listCorrectionBatches()).rejects.toThrow();
    }
    as(hrA.user);
    expect((await file("short")).ok).toBe(false);
    expect((await file(csvFor([`${eli.user.email},clock_in,${utc(3 * HOUR)}`]), { timeZone: "Mars/Base" })).ok).toBe(false);
    expect((await file(csvFor([`${eli.user.email},clock_in,${utc(3 * HOUR)}`]), { reason: "no" })).ok).toBe(false);
    expect(await file("name,when\nAna,today")).toMatchObject({ ok: false, error: expect.stringContaining("must name the columns") });
    expect(await file(csvFor(["bad row,clock_in,2026-10-05 09:00"]))).toMatchObject({ ok: false, error: expect.stringContaining("Line 2") });
  });
});

describe("deciding a batch", () => {
  async function batchOf(label: string, count: number) {
    const people = await Promise.all(Array.from({ length: count }, (_, i) => person(`${label}${i}`)));
    as(hrA.user);
    const result = await file(csvFor(people.flatMap((p) => [`${p.user.email},clock_in,${utc(3 * HOUR)}`, `${p.user.email},clock_out,${utc(2 * HOUR)}`])));
    if (!result.ok || !result.data.batchId) throw new Error("batch not filed");
    return { people, batchId: result.data.batchId };
  }

  it("shows the batch to the other HR admin and marks it as the filer's own", async () => {
    const { batchId } = await batchOf("BatchShow", 2);
    expect((await queries.listCorrectionBatches()).find((b) => b.batchId === batchId)).toMatchObject({ waiting: 2, people: 2, mine: true, reason: "ELEVATE was down for two hours" });
    as(hrB);
    expect((await queries.listCorrectionBatches()).find((b) => b.batchId === batchId)).toMatchObject({ mine: false, filedBy: expect.stringContaining("BulkHrA") });
  });

  it("never lets the HR admin who filed it decide it", async () => {
    const { batchId } = await batchOf("BatchSelf", 2);
    as(hrA.user);
    expect(await actions.decideCorrectionBatch({ batchId, decision: "approve" })).toEqual({ ok: true, data: { done: 0, failed: ["Someone else must decide on your own request."] } });
    expect(await rows(sql`select 1 from time.clock_corrections where batch_id = ${batchId} and status = 'pending'`)).toHaveLength(2);
  });

  it("lets another HR admin approve all of it, which writes the clock events, and tells each person", async () => {
    const { people, batchId } = await batchOf("BatchOk", 3);
    as(hrB);
    expect(await actions.decideCorrectionBatch({ batchId, decision: "approve", note: "Confirmed from Jibble" })).toEqual({ ok: true, data: { done: 3, failed: [] } });
    for (const p of people) {
      const events = await rows<{ type: string; source: string }>(sql`select type, source from time.clock_events where employee_id = ${p.employeeId} order by occurred_at`);
      expect(events).toEqual([{ type: "clock_in", source: "admin_correction" }, { type: "clock_out", source: "admin_correction" }]);
      expect(await notes(p.user.id, "attendance.correction_approved")).toHaveLength(1);
    }
    expect((await queries.listCorrectionBatches()).some((b) => b.batchId === batchId)).toBe(false); // nothing left waiting
    expect(await actions.decideCorrectionBatch({ batchId, decision: "approve" })).toEqual({ ok: false, error: "Nothing in that batch is waiting." });
  });

  it("can be rejected with a reason, and a request that no longer fits is reported while the rest go through", async () => {
    const { people, batchId } = await batchOf("BatchRej", 2);
    as(hrB);
    expect(await actions.decideCorrectionBatch({ batchId, decision: "reject" })).toEqual({ ok: false, error: "Give a short reason so the people know why." });
    expect(await actions.decideCorrectionBatch({ batchId, decision: "reject", note: "Not needed" })).toEqual({ ok: true, data: { done: 2, failed: [] } });
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${people[0].employeeId}`)).toHaveLength(0);

    const second = await batchOf("BatchMixed", 2);
    // One person clocks in for real in between, so their correction no longer fits
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${second.people[0].employeeId}, 'clock_in', ${new Date(Date.now() - 2.5 * HOUR).toISOString()})`);
    as(hrB);
    const mixed = await actions.decideCorrectionBatch({ batchId: second.batchId, decision: "approve" });
    expect(mixed.ok && mixed.data.done).toBe(1);
    expect(mixed.ok && mixed.data.failed).toHaveLength(1);
  });
});
