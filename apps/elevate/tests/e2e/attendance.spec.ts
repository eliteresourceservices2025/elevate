import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied.

test("an employee clocks in, takes a break and clocks out from the header", async ({ page }) => {
  // Each click is a server round trip on a shared dev server that may be compiling, so state changes get extra time.
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Clara", `Clock${stamp}`);
  await signInEnrollingMfa(page, employee);

  const clockIn = await hydrated(page.getByRole("button", { name: "Clock in" }));
  // The button is meant to be noticed: it is clearly bigger than a normal header button
  expect((await clockIn.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  expect((await clockIn.boundingBox())!.width).toBeGreaterThanOrEqual(130);
  await clockIn.click();
  await expect(page.getByText("Clocked in.")).toBeVisible(slow);
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "Clock in" })).toHaveCount(0, slow);

  // A break has a length to choose from, and counts down
  await page.getByRole("button", { name: "Break" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["15 minutes", "30 minutes", "1 hour", "No time limit"]);
  await page.getByRole("menuitem", { name: "15 minutes" }).click();
  await expect(page.getByText("Break left", { exact: true })).toBeVisible(slow);
  await expect(page.getByText(/^0:1[45]:\d{2}$/)).toBeVisible(slow); // about 15 minutes left
  await page.getByRole("button", { name: "End break" }).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
  // The header clock shows seconds, and the week already shows today's session while it is still running
  await expect(page.getByText(/^\d+:\d{2}:\d{2}$/)).toBeVisible(slow);
  await page.goto("/attendance");
  await expect(page.getByRole("region", { name: "This week" }).getByText("In progress").first()).toBeVisible(slow);
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);

  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByText("Clocked out.")).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible(slow);

  // A second clock-in the same day is its own record, not a replacement for the first
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
  await page.getByRole("button", { name: "Clock out" }).click();
  // Wait for the state itself, not the toast: the first clock-out's toast may still be on screen
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible(slow);

  await page.goto("/attendance");
  const week = page.getByRole("region", { name: "This week" });
  await expect(week.getByText("In progress")).toHaveCount(0, slow);
  await expect(week.getByRole("row").filter({ hasText: "Total" })).toBeVisible(slow);
  await expect(week.locator("tr[data-session]")).toHaveCount(2, slow);
  await expect(week.locator("tr[data-session]").first()).toContainText("of 15m"); // the first session shows its 15 minute break
});

test("an employee asks to fix a forgotten clock-out and their lead approves it", async ({ browser }) => {
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lena", `ClockLead${stamp}`, { roles: ["team_lead"] });
  const worker = await createEmployeeAccount("Wes", `Forgot${stamp}`, { managerId: lead.employeeId });

  // Wes clocked in 14 hours ago and never clocked out
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_in', now() - interval '14 hours')`;
  } finally {
    await sql.end();
  }

  const workerPage = await (await browser.newContext()).newPage();
  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(workerPage, worker);
  await signInEnrollingMfa(leadPage, lead);

  await expect(workerPage.getByRole("button", { name: "Clock out" })).toBeVisible(); // still shown as working

  // He says he stopped 6 hours ago (his zone is the company zone, Phoenix, until he sets another)
  const stoppedLocal = new Date(Date.now() - 6 * 3_600_000).toLocaleString("sv-SE", { timeZone: "America/Phoenix" }).slice(0, 16).replace(" ", "T");
  await workerPage.goto("/attendance");
  await waitForHydration(workerPage, "#cr-kind");
  await workerPage.getByLabel("I stopped working at").fill(stoppedLocal);
  await workerPage.getByLabel("Reason").fill("Closed my laptop and forgot");
  await workerPage.getByRole("button", { name: "Send for approval" }).click();
  await expect(workerPage.getByText("Correction sent for approval.")).toBeVisible();

  // His lead sees it and approves
  await leadPage.goto("/attendance?tab=corrections");
  const card = leadPage.getByRole("listitem").filter({ hasText: `Forgot${stamp}` });
  await expect(card).toContainText("Closed my laptop and forgot");
  await (await hydrated(card.getByRole("button", { name: "Approve" }))).click();
  await expect(leadPage.getByText("Correction approved.")).toBeVisible();

  // Wes is no longer clocked in
  await workerPage.goto("/dashboard");
  await expect(workerPage.getByRole("button", { name: "Clock in" })).toBeVisible();
  await expect(workerPage.getByRole("button", { name: "Clock out" })).toHaveCount(0);
});

test("a break that runs past its length shows a pop-up, is recorded as an overbreak and the lead is told", async ({ browser }) => {
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lia", `BreakLead${stamp}`, { roles: ["team_lead"] });
  const worker = await createEmployeeAccount("Bo", `Over${stamp}`, { managerId: lead.employeeId });

  // Bo clocked in an hour ago and started a 15 minute break 20 minutes ago
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_in', now() - interval '1 hour')`;
    await sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${worker.employeeId}, 'break_start', now() - interval '20 minutes', 15)`;
  } finally {
    await sql.end();
  }

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);

  const dialog = page.getByRole("alertdialog", { name: "Your break is up" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("15 minutes break");
  await expect(page.getByText("Over break by", { exact: true })).toBeVisible();
  await (await hydrated(dialog.getByRole("button", { name: "End break and get back to work" }))).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toHaveCount(0);

  // It is on the timesheet, and the lead was told
  await page.goto("/attendance");
  const week = page.getByRole("region", { name: "This week" });
  await expect(week.getByText(/\+\d+ min/).first()).toBeVisible({ timeout: 30_000 });
  await expect(week.locator("tr[data-session]").first()).toContainText("over)");

  const check = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [n] = await check<{ n: number }[]>`select count(*)::int as n from ops.notifications where kind = 'attendance.overbreak' and user_id = (select user_id from core.employees where id = ${lead.employeeId})`;
    expect(n.n).toBe(1);
  } finally {
    await check.end();
  }
});

test("an HR or Super Admin account without a people record can set one up and use the clock", async ({ page }) => {
  const stamp = Date.now();
  const hr = await createHrAccount(); // has the HR Admin role but no people record
  await signInEnrollingMfa(page, hr);

  // Instead of silently showing nothing, the header points to where it is fixed
  const setup = page.getByRole("link", { name: "Set up your time clock" });
  await expect(setup).toBeVisible();
  await setup.click();
  await page.waitForURL("**/attendance");
  await waitForHydration(page, "#sp-first");
  await page.getByLabel("Legal first name").fill("Hana");
  await page.getByLabel("Legal last name").fill(`Admin${stamp}`);
  await page.getByRole("button", { name: "Set up my profile" }).click();
  await expect(page.getByText("Your profile is set up.")).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible({ timeout: 30_000 });
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible({ timeout: 30_000 });
});
