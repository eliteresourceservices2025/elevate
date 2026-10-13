import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for the work anniversary reminders: who hears, once per year, never for people who left.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { runAnniversaryReminders } = await import("@/modules/people/anniversary-jobs");

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function makeUser(label: string, roles: RoleSlug[]) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq(label)}@example.com`})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return id;
}
async function person(label: string, o: { startDate: string; managerId?: string; status?: string; userId?: string | null }) {
  const userId = o.userId === undefined ? await makeUser(label, ["employee"]) : o.userId;
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${label}, ${uniq(label)}, ${`${uniq(label)}@example.com`}, ${o.status ?? "active"}, ${userId}, ${o.managerId ?? null}, ${o.startDate}::date) returning id`);
  return { id: e.id, userId };
}
const noticesFor = (userId: string) => rows<{ title: string; body: string; link: string }>(sql`select title, body, link from ops.notifications where user_id = ${userId} and kind = 'anniversary.upcoming'`);

const TODAY = "2031-06-10"; // far from any other test's dates
let hr: string;
let recruiter: string;
let superAdmin: string;
let executive: string;
beforeAll(async () => {
  hr = await makeUser("annhr", ["hr_admin", "employee"]);
  recruiter = await makeUser("annrec", ["recruiter", "employee"]);
  superAdmin = await makeUser("annsa", ["super_admin", "employee"]);
  executive = await makeUser("annexe", ["executive", "employee"]);
});

describe("work anniversary reminders", () => {
  it("tells Super Admin, HR, recruiters and the person's team leads seven days ahead, once, and not executives", async () => {
    const leadUser = await makeUser("annlead", ["team_lead", "employee"]);
    const [exec] = [await person("AnnExec", { startDate: "2020-01-01", userId: executive })];
    const lead = await person("AnnLead", { startDate: "2020-01-01", userId: leadUser, managerId: exec.id });
    const va = await person("AnnVa", { startDate: "2029-06-17", managerId: lead.id }); // 2 years on 2031-06-17 = 7 days away

    const run = await runAnniversaryReminders(TODAY);
    expect(run.due).toBeGreaterThanOrEqual(1);

    for (const user of [hr, recruiter, superAdmin, leadUser]) {
      const notes = await noticesFor(user);
      expect(notes.some((n) => n.body.includes("2 years on Jun 17"))).toBe(true);
    }
    expect(await noticesFor(executive)).toHaveLength(0); // an executive manager is not on the list
    expect(await rows(sql`select 1 from core.anniversary_notices where employee_id = ${va.id} and year = 2031`)).toHaveLength(1);

    // A second run on the same day, or the next day, sends nothing more for the same anniversary.
    const before = (await noticesFor(hr)).length;
    await runAnniversaryReminders(TODAY);
    await runAnniversaryReminders("2031-06-11");
    expect((await noticesFor(hr)).length).toBe(before);
  });

  it("skips people who have left, first-year starters, people too far off, and people with no start date", async () => {
    const left = await person("AnnLeft", { startDate: "2028-07-01", status: "separated" });
    const fresh = await person("AnnFresh", { startDate: "2031-06-16" }); // starts "this year": not an anniversary
    const far = await person("AnnFar", { startDate: "2028-06-25" }); // 15 days away
    const none = await person("AnnNone", { startDate: "2028-07-02" });
    await db.execute(sql`update core.employees set start_date = null where id = ${none.id}`);
    await db.execute(sql`update core.employees set start_date = '2028-06-16' where id = ${left.id}`); // would be due, but they left

    await runAnniversaryReminders(TODAY);
    for (const p of [left, fresh, far, none]) {
      expect(await rows(sql`select 1 from core.anniversary_notices where employee_id = ${p.id}`)).toHaveLength(0);
    }
  });

  it("makes up a missed day, but never sends on the day itself", async () => {
    const va = await person("AnnLate", { startDate: "2027-06-14" }); // 4 years? no: 2031-06-14 is 4 years; due from 2031-06-07
    await runAnniversaryReminders("2031-06-13"); // the day before
    expect(await rows(sql`select 1 from core.anniversary_notices where employee_id = ${va.id}`)).toHaveLength(1);

    const same = await person("AnnSameDay", { startDate: "2027-06-20" });
    await runAnniversaryReminders("2031-06-20"); // the day itself
    expect(await rows(sql`select 1 from core.anniversary_notices where employee_id = ${same.id}`)).toHaveLength(0);
  });
});
