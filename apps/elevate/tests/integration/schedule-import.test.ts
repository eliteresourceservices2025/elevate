import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { digest, mappingSchema, parseTimesheet, planRows } from "../../scripts/schedule-import-core";
import { reconcile } from "../../scripts/schedule-import-service";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const target = { host: "local-test-host", name: new URL(process.env.DATABASE_URL!).pathname.slice(1), projectRef: "localtest" };
const day = (offset: number) => {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const source = "Invented and not from the real timesheet";
let hr: string;

beforeAll(async () => {
  hr = `hr-${randomUUID()}@example.com`;
  const actorId = randomUUID();
  await sql`INSERT INTO core.users (id, email) VALUES (${actorId}, ${hr})`;
  await sql`INSERT INTO core.user_roles (user_id, role_slug) VALUES (${actorId}, 'hr_admin')`;
});
afterAll(() => sql.end());

async function mapping(label: string, offset: number) {
  const name = `Invented ${label}`, clientName = `Invented clinic ${label}`;
  const email = `${randomUUID()}@example.com`;
  const [person] = await sql<{ id: string }[]>`INSERT INTO core.employees (legal_first_name, legal_last_name, work_email, status)
    VALUES ('Invented', ${label}, ${email}, 'active') RETURNING id`;
  const [client] = await sql<{ id: string }[]>`INSERT INTO core.clients (name, time_zone)
    VALUES (${clientName}, 'America/New_York') RETURNING id`;
  const date = day(offset), scheduleText = "9:00am to 5:00pm ET";
  const observations = parseTimesheet(`${date.slice(5, 7)}/${date.slice(8)}/${date.slice(2, 4)},Monday\n,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours\n,${name},${clientName},${scheduleText},,,,,8`);
  const entries = mappingSchema.parse({ entries: [{ name, client: clientName, employeeId: person.id, employeeWorkEmail: email,
    clientId: client.id, clientName,
    assignmentStartDate: date, scheduleText, shift: { effectiveFrom: date, startTime: "09:00", endTime: "17:00",
      zone: "America/New_York", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60 }, hoursPerWeek: null }] });
  return { personId: person.id, entries: planRows(observations, entries), sourceDigest: digest(source + label) };
}

describe("reviewed schedule import in a disposable database", () => {
  it("previews without writes, applies atomically with history/audit, and recognizes exact state", async () => {
    const plan = await mapping("One" + randomUUID(), 0);
    const preview = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest);
    expect(preview).toMatchObject({ assignments: 1, schedules: 1, unchanged: 0 });
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(0);
    expect(await sql`SELECT id FROM time.schedules WHERE employee_id = ${plan.personId}`).toHaveLength(0);
    const applied = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest, preview.digest);
    expect(applied).toEqual(preview);
    expect(await sql`SELECT id FROM core.employment_history WHERE employee_id = ${plan.personId}`).toHaveLength(1);
    const audit = await sql<{ action: string; actor_email: string; after: Record<string, unknown> }[]>`
      SELECT action, actor_email, after FROM ops.audit_log WHERE target_id = ${plan.personId} ORDER BY id`;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ action: "assignment.create", actor_email: hr,
      after: { clientId: plan.entries[0].clientId, startDate: plan.entries[0].assignmentStartDate } });
    expect(audit[1]).toMatchObject({ action: "schedule.assign", actor_email: hr,
      after: { effectiveFrom: plan.entries[0].shift.effectiveFrom } });
    const again = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest);
    expect(again).toMatchObject({ assignments: 0, schedules: 0, unchanged: 1 });
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest, preview.digest)).rejects.toThrow();
    expect(await sql`SELECT action FROM ops.audit_log WHERE target_id = ${plan.personId}`).toHaveLength(2);
  });

  it("rejects historical dates, bad actor, changed target and mismatched digest without writing", async () => {
    const plan = await mapping("Old" + randomUUID(), -8);
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest)).rejects.toThrow();
    await expect(reconcile(sql, { entries: plan.entries }, "unknown@example.com", day(-9), target, plan.sourceDigest)).rejects.toThrow();
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-9), { ...target, name: "wrong" }, plan.sourceDigest)).rejects.toThrow();
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-9), target, plan.sourceDigest, "0".repeat(64))).rejects.toThrow();
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(0);
  });

  it("binds the reviewed digest to the approved project and host", async () => {
    const plan = await mapping("Target" + randomUUID(), 0);
    const preview = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest);
    for (const changed of [{ ...target, projectRef: "otherproject" }, { ...target, host: "other-pooler.example" }]) {
      await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), changed, plan.sourceDigest, preview.digest)).rejects.toThrow();
    }
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(0);
  });

  it("refuses another client's overlapping assignment", async () => {
    const plan = await mapping("OtherClient" + randomUUID(), 0);
    const [other] = await sql<{ id: string }[]>`INSERT INTO core.clients (name, time_zone)
      VALUES (${"Invented other " + randomUUID()}, 'America/New_York') RETURNING id`;
    await sql`INSERT INTO core.client_assignments (employee_id, client_id, start_date)
      VALUES (${plan.personId}, ${other.id}, ${day(-1)})`;
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest)).rejects.toThrow(/Other client assignments/);
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(1);
  });

  it("refuses a schedule that would leave existing attendance stale", async () => {
    const plan = await mapping("Attendance" + randomUUID(), -6);
    await sql`INSERT INTO time.attendance_days (employee_id, date, sessions, flags)
      VALUES (${plan.personId}, ${day(-5)}, 1, ARRAY[]::text[])`;
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest)).rejects.toThrow(/attendance/);
    expect(await sql`SELECT id FROM time.schedules WHERE employee_id = ${plan.personId}`).toHaveLength(0);
  });

  it("refuses existing clock events before attendance has been rebuilt", async () => {
    const plan = await mapping("Clocked" + randomUUID(), -1);
    await sql`INSERT INTO time.clock_events (employee_id, type, occurred_at)
      VALUES (${plan.personId}, 'clock_in', now() - interval '1 hour')`;
    await expect(reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest)).rejects.toThrow(/attendance/);
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(0);
  });

  it("refuses swapped identities and a changed client after preview", async () => {
    const first = await mapping("IdentityA" + randomUUID(), 0);
    const second = await mapping("IdentityB" + randomUUID(), 0);
    const swapped = { ...first.entries[0], employeeId: second.personId };
    await expect(reconcile(sql, { entries: [swapped] }, hr, day(-7), target, first.sourceDigest)).rejects.toThrow();
    const preview = await reconcile(sql, { entries: first.entries }, hr, day(-7), target, first.sourceDigest);
    await sql`UPDATE core.clients SET name = 'Renamed invented client' WHERE id = ${first.entries[0].clientId}`;
    await expect(reconcile(sql, { entries: first.entries }, hr, day(-7), target, first.sourceDigest, preview.digest)).rejects.toThrow();
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${first.personId}`).toHaveLength(0);
  });

  it("adds only the missing half of a prior partial import", async () => {
    const plan = await mapping("Partial" + randomUUID(), 0);
    const [entry] = plan.entries;
    await sql`INSERT INTO core.client_assignments (employee_id, client_id, start_date, hours_per_week)
      VALUES (${entry.employeeId}, ${entry.clientId}, ${entry.assignmentStartDate}, ${entry.hoursPerWeek})`;
    const preview = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest);
    expect(preview).toMatchObject({ assignments: 0, schedules: 1 });
    await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest, preview.digest);
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(1);
    expect(await sql`SELECT id FROM time.schedules WHERE employee_id = ${plan.personId}`).toHaveLength(1);
  });

  it("allows at most one apply when two runners use the same preview", async () => {
    const plan = await mapping("Concurrent" + randomUUID(), 0);
    const preview = await reconcile(sql, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest);
    const second = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
    try {
      const results = await Promise.allSettled([sql, second].map((connection) =>
        reconcile(connection, { entries: plan.entries }, hr, day(-7), target, plan.sourceDigest, preview.digest)));
      expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${plan.personId}`).toHaveLength(1);
      expect(await sql`SELECT id FROM time.schedules WHERE employee_id = ${plan.personId}`).toHaveLength(1);
    } finally {
      await second.end();
    }
  });

  it("rolls back all employees when one has conflicting assignment history", async () => {
    const first = await mapping("A" + randomUUID(), 0);
    const second = await mapping("B" + randomUUID(), 0);
    const [row] = second.entries;
    await sql`INSERT INTO core.client_assignments (employee_id, client_id, start_date)
      VALUES (${row.employeeId}, ${row.clientId}, ${day(-1)})`;
    await expect(reconcile(sql, { entries: [...first.entries, ...second.entries] }, hr, day(-7), target, digest(source))).rejects.toThrow();
    expect(await sql`SELECT id FROM core.client_assignments WHERE employee_id = ${first.personId}`).toHaveLength(0);
  });
});
