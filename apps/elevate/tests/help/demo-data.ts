import { config } from "dotenv";
import postgres from "postgres";
import type { Page } from "@playwright/test";

config({ path: ".env.local" });

// Demo data for the screenshots, so list pages are not empty. All of it is invented (Filipino and US names, example.com addresses) and is
// only ever written to the LOCAL database. Safe to run again: each part checks whether it is already there.

function assertLocal() {
  for (const u of [process.env.DATABASE_URL_DIRECT, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    if (!u || !["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error("The screenshot tool only runs against the local Supabase.");
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday of last week (Phoenix has no daylight saving, so UTC-7 all year). */
function lastWeekMonday(now = new Date()): Date {
  const phoenix = new Date(now.getTime() - 7 * 3600_000);
  const day = (phoenix.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(phoenix.getUTCFullYear(), phoenix.getUTCMonth(), phoenix.getUTCDate() - day - 7));
  return monday;
}

const JOBS = [
  { title: "Virtual Assistant, Medical Billing", slug: "virtual-assistant-medical-billing", status: "open", description: "Support our US clinic clients with billing follow-up, scheduling and inbox care.\n\n- Reliable internet and a quiet workspace\n- Clear written English\n- Comfortable with careful, detail-heavy work", location: "Remote, Philippines" },
  { title: "Executive Assistant, Real Estate", slug: "executive-assistant-real-estate", status: "open", description: "Work with a busy real estate team: calendars, listings paperwork and client follow-up.\n\n- Strong organisation\n- Friendly phone and email manner", location: "Remote, Philippines" },
  { title: "Customer Support Virtual Assistant", slug: "customer-support-virtual-assistant", status: "draft", description: "Answer customer questions by chat and email for our retail clients.", location: "Remote, Philippines" },
];

const APPLICANTS: { name: string; stage: string; job: number }[] = [
  { name: "Katrina Dela Cruz", stage: "applied", job: 0 },
  { name: "Joseph Miller", stage: "applied", job: 0 },
  { name: "Andrea Bautista", stage: "applied", job: 0 },
  { name: "Mark Anthony Ramos", stage: "screening", job: 0 },
  { name: "Sarah Johnson", stage: "screening", job: 0 },
  { name: "Liza Mercado", stage: "interview", job: 0 },
  { name: "Paolo Navarro", stage: "interview", job: 0 },
  { name: "Grace Thompson", stage: "assessment", job: 0 },
  { name: "Carla Fernandez", stage: "offer", job: 0 },
  { name: "Noel Castillo", stage: "applied", job: 1 },
  { name: "Bianca Torres", stage: "screening", job: 1 },
  { name: "Ethan Walker", stage: "interview", job: 1 },
];

export async function seedDemoData(): Promise<void> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    // Jobs and applicants
    const jobIds: string[] = [];
    for (const job of JOBS) {
      const [known] = await sql<{ id: string }[]>`select id from talent.job_openings where slug = ${job.slug}`;
      if (known) {
        jobIds.push(known.id);
        continue;
      }
      const [row] = await sql<{ id: string }[]>`
        insert into talent.job_openings (title, slug, description, location, status, opened_at)
        values (${job.title}, ${job.slug}, ${job.description}, ${job.location}, ${job.status}, ${job.status === "open" ? new Date() : null})
        returning id`;
      jobIds.push(row.id);
    }
    for (const a of APPLICANTS) {
      const email = `${a.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;
      const [c] = await sql<{ id: string }[]>`
        insert into talent.candidates (email, full_name, country) values (${email}, ${a.name}, 'Philippines')
        on conflict do nothing returning id`;
      if (!c) continue; // already there from an earlier run
      await sql`insert into talent.applications (opening_id, candidate_id, stage) values (${jobIds[a.job]}, ${c.id}, ${a.stage})`;
    }

    // Last week's hours for eight people: mostly clean, a few with something to look at
    const people = await sql<{ id: string }[]>`
      select id from core.employees where status = 'active' and user_id is null and work_email like '%@example.com' order by work_email limit 8`;
    const monday = lastWeekMonday();
    for (const [i, person] of people.entries()) {
      for (let d = 0; d < 5; d++) {
        const day = new Date(monday.getTime() + d * 86_400_000);
        const date = iso(day);
        const late = i === 1 && d === 1 ? 25 : 0;
        const extra = i === 2 && d === 2 ? 90 : 0;
        const absent = i === 3 && d === 3;
        const early = i === 4 && d === 4 ? 40 : 0;
        const worked = absent ? 0 : 480 - 60 + extra - late - early;
        const flags = [late ? "late" : null, extra ? "extra_hours" : null, extra ? "unapproved_extra" : null, absent ? "absent" : null, early ? "left_early" : null].filter(Boolean) as string[];
        await sql`
          insert into time.attendance_days (employee_id, date, sessions, worked_minutes, break_minutes, first_in, last_out, flags, scheduled_minutes, late_minutes, early_leave_minutes, extra_minutes, approved_extra_minutes)
          values (${person.id}, ${date}, ${absent ? 0 : 1}, ${worked}, ${absent ? 0 : 60},
            ${absent ? null : new Date(`${date}T${String(15 + Math.floor(late / 60)).padStart(2, "0")}:${String(late % 60).padStart(2, "0")}:00Z`)},
            ${absent ? null : new Date(`${date}T${early ? "22:50" : "23:30"}:00Z`)},
            ${flags}, 480, ${late}, ${early}, ${extra}, 0)
          on conflict (employee_id, date) do nothing`;
      }
    }

    // A couple of requests waiting for HR, from people who have an account
    const requesters = await sql<{ id: string; user_id: string }[]>`
      select id, user_id from core.employees where user_id is not null and status = 'active' order by work_email limit 3`;
    const [prize] = await sql<{ id: string }[]>`select id from time.leave_types where slug = 'prize_day'`;
    const [client] = await sql<{ id: string }[]>`select id from core.clients order by name limit 1`;
    const nextMonday = new Date(monday.getTime() + 14 * 86_400_000);
    for (const [i, who] of requesters.entries()) {
      const [has] = await sql`select 1 from time.leave_requests where employee_id = ${who.id}`;
      if (has) continue;
      const start = iso(new Date(nextMonday.getTime() + i * 86_400_000));
      await sql`
        insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, days, status, filed_by, step_started_on, note)
        values (${who.id}, ${prize.id}, ${start}, ${start}, 1, 'pending_hr', ${who.user_id}, ${iso(new Date())}, 'Family event')`;
    }
    if (requesters[0] && client) {
      const [has] = await sql`select 1 from time.extra_hours_requests where employee_id = ${requesters[0].id}`;
      if (!has) {
        const start = new Date(`${iso(new Date(monday.getTime() + 15 * 86_400_000))}T23:30:00Z`);
        await sql`
          insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by)
          values (${requesters[0].id}, ${client.id}, 'va', 'pending_lead', ${start}, ${new Date(start.getTime() + 2 * 3600_000)}, 120, 'Dr. Lopez', 'The client asked us to finish the month-end billing', ${requesters[0].user_id})`;
      }
    }

    // Two support requests in the inbox
    const [asked] = await sql`select 1 from ops.support_requests limit 1`;
    if (!asked && requesters[0]) {
      const who = await sql<{ email: string }[]>`select email from core.users where id = ${requesters[0].user_id}`;
      await sql`
        insert into ops.support_requests (user_id, email, topic, subject, message, page)
        values (${requesters[0].user_id}, ${who[0].email}, 'time_clock', 'I forgot to clock out yesterday', 'I closed my laptop without clocking out. My shift ended at 5:00 PM Phoenix time.', '/attendance'),
               (${requesters[0].user_id}, ${who[0].email}, 'sign_in', 'New phone, cannot get my code', 'I changed phones and my old authenticator is gone.', null)`;
    }
    // Joy (the Employee account the screenshots use) gets a client, a schedule, prize days, a certificate, equipment and an announcement to read
    const [joy] = await sql<{ id: string; user_id: string }[]>`select id, user_id from core.employees where lower(work_email) = 'joy.villanueva@example.com'`;
    const [maria] = await sql<{ id: string }[]>`select id from core.users where lower(email) = 'maria.santos@example.com'`;
    if (joy && client) {
      const [assigned] = await sql`select 1 from core.client_assignments where employee_id = ${joy.id}`;
      if (!assigned) await sql`insert into core.client_assignments (employee_id, client_id, start_date, hours_per_week) values (${joy.id}, ${client.id}, ${iso(new Date(Date.now() - 90 * 86_400_000))}, 40)`;
      const [shift] = await sql`select 1 from time.schedules where employee_id = ${joy.id}`;
      if (!shift) await sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${joy.id}, ${iso(new Date(Date.now() - 60 * 86_400_000))}, '08:00', '17:00', ${[1, 2, 3, 4, 5]}, 60, 'America/Phoenix')`;
      const [awarded] = await sql`select 1 from time.leave_ledger where employee_id = ${joy.id}`;
      if (!awarded && prize) await sql`insert into time.leave_ledger (employee_id, leave_type_id, entry_type, days, reason, effective_on, expires_on, created_by) values (${joy.id}, ${prize.id}, 'award', 2, 'Team game winner', ${iso(new Date(Date.now() - 10 * 86_400_000))}, ${iso(new Date(Date.now() + 170 * 86_400_000))}, ${maria?.id ?? null})`;
      const [cert] = await sql`select 1 from talent.credentials where employee_id = ${joy.id}`;
      if (!cert) await sql`insert into talent.credentials (employee_id, name, issued_on, expires_on, source, created_by) values (${joy.id}, 'HIPAA awareness', ${iso(new Date(Date.now() - 200 * 86_400_000))}, ${iso(new Date(Date.now() + 165 * 86_400_000))}, 'manual', ${maria?.id ?? null})`;
    }
    if (joy && maria) {
      const [item] = await sql`select 1 from talent.assets where tag = 'ERS-LT-0001'`;
      if (!item) {
        const [laptop] = await sql<{ id: string }[]>`insert into talent.assets (tag, name, category, serial_number, status, created_by) values ('ERS-LT-0001', 'Dell Latitude 5440', 'laptop', 'SN-DEMO-0001', 'assigned', ${maria.id}) returning id`;
        await sql`insert into talent.assets (tag, name, category, serial_number, status, created_by) values ('ERS-HS-0001', 'Logitech H390 headset', 'headset', 'SN-DEMO-0002', 'in_stock', ${maria.id})`;
        await sql`insert into talent.asset_assignments (asset_id, employee_id, condition_out, assigned_by) values (${laptop.id}, ${joy.id}, 'good', ${maria.id})`;
      }
    }
    // An announcement made by SQL has no recipients, so remove one an earlier run left; the screen makes it properly (startDemoCases)
    await sql`
      delete from docs.announcements a
      where a.title = 'Welcome to ELEVATE'
        and not exists (select 1 from docs.announcement_recipients r where r.announcement_id = a.id)`;

  } finally {
    await sql.end();
  }
}

/** Starts onboarding for two people and an offboarding for one, by using the real screens (so the checklists are built the normal way). */
export async function startDemoCases(page: Page): Promise<void> {
  await page.goto("/onboarding");
  const open = await page.getByText("Nothing here yet.").count();
  if (open > 0) {
    await page.getByRole("button", { name: "Start onboarding", exact: true }).first().click();
    await page.getByLabel("Search people").fill("a");
    const boxes = page.getByRole("list", { name: "People to choose from" }).getByRole("checkbox");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    // People already added have their own start date; use today's date so the demo checklists are not all late
    const own = page.getByRole("checkbox", { name: /own start date/ });
    if (await own.count()) await own.uncheck();
    await page.locator("#on-start").fill(iso(new Date()));
    await page.getByRole("button", { name: /^Start onboarding for 2 people/ }).click();
    await page.getByText(/Onboarding started/).first().waitFor({ timeout: 30_000 });
  }

  // Joy's own checklist, so the person's view of Onboarding has something in it
  await page.goto("/onboarding");
  if ((await page.getByText("Villanueva").count()) === 0) {
    await page.getByRole("button", { name: "Start onboarding", exact: true }).first().click();
    await page.getByLabel("Search people").fill("Villanueva");
    await page.getByRole("list", { name: "People to choose from" }).getByRole("checkbox").first().check();
    const own = page.getByRole("checkbox", { name: /own start date/ });
    if (await own.count()) await own.uncheck();
    await page.locator("#on-start").fill(iso(new Date()));
    await page.getByRole("dialog").getByRole("button", { name: "Start onboarding", exact: true }).click();
    // One person: the page goes straight to their case
    await page.waitForURL(/\/onboarding\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  }

  // An announcement everyone has to acknowledge (made on the screen so every person is asked)
  await page.goto("/announcements");
  if ((await page.getByText("Welcome to ELEVATE").count()) === 0) {
    await page.goto("/announcements/new");
    await page.getByLabel("Title").fill("Welcome to ELEVATE");
    await page.getByLabel("Message").fill("ELEVATE is where you clock in, ask for time off and see your documents. Please read this note and confirm below.");
    await page.getByLabel("Require acknowledgment").check();
    await page.getByRole("button", { name: "Post announcement" }).click();
    await page.getByText("Announcement posted.").first().waitFor({ timeout: 30_000 });
  }

  // A review template, so Launch a cycle shows its form
  await page.goto("/reviews/templates");
  if ((await page.getByText("Quarterly check-in").count()) === 0) {
    await page.getByLabel("Template name").first().fill("Quarterly check-in");
    await page.getByLabel("Section").first().fill("The work");
    await page.getByLabel("Question 1").first().fill("How did the work go this quarter?");
    await page.getByRole("button", { name: "Save template" }).first().click();
    await page.getByText("Template saved.").first().waitFor({ timeout: 30_000 });
  }

  // One offer template, so Make an offer shows the form
  await page.goto("/recruiting/offer-templates");
  if ((await page.getByText("None yet.").count()) > 0) {
    await page.getByLabel("Template name").fill("Standard contractor offer");
    await page.getByRole("button", { name: "Create template" }).click();
    await page.getByText("Template created.").first().waitFor({ timeout: 30_000 });
  }

  await page.goto("/offboarding");
  const none = await page.getByText("Nothing here yet.").count();
  if (none > 0) {
    await page.getByRole("button", { name: "Start an offboarding" }).first().click();
    await page.getByLabel("Search people").fill("Migs");
    await page.getByRole("list", { name: "People to choose from" }).getByRole("checkbox").first().check();
    await page.getByLabel("Last working day").fill(iso(new Date(Date.now() + 10 * 86_400_000)));
    page.once("dialog", (d) => d.accept()); // asks to confirm before starting
    await page.getByRole("button", { name: /^Start offboarding/ }).click();
    // One person: the page goes straight to their case
    await page.waitForURL(/\/offboarding\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  }
}
