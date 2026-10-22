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
