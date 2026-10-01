import { readFileSync } from "node:fs";
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
  // The end-of-day box is optional: skipping it is always fine
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible(slow);

  // A second clock-in the same day is its own record, not a replacement for the first
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
  await page.getByRole("button", { name: "Clock out" }).click();
  // Wait for the state itself, not the toast: the first clock-out's toast may still be on screen
  await page.getByRole("button", { name: "Skip" }).click();
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

// A real 1x1 PNG, so the screenshot is a genuine image
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const phoenix = (agoMs: number) => new Date(Date.now() - agoMs).toLocaleString("sv-SE", { timeZone: "America/Phoenix" }).replace(" ", "T").slice(0, 16);

test("the clock pauses when the connection drops, and an end-of-day note can be written after clocking out", async ({ page, context }) => {
  const slow = { timeout: 30_000 };
  const employee = await createEmployeeAccount("Nora", `Offline${Date.now()}`);
  await signInEnrollingMfa(page, employee);
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);

  // No connection: the person is told, the buttons wait, and nothing is recorded
  await context.setOffline(true);
  await expect(page.getByText("Offline: clock paused")).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "Clock out" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText("Offline: clock paused")).toHaveCount(0, slow);
  await expect(page.getByRole("button", { name: "Clock out" })).toBeEnabled();

  // Clock out, then wrap up the day
  await page.getByRole("button", { name: "Clock out" }).click();
  const dialog = page.getByRole("dialog", { name: "Wrap up your day" });
  await expect(dialog).toBeVisible(slow);
  await dialog.getByRole("button", { name: "Use template" }).click();
  await expect(dialog.getByLabel("End-of-day note")).toHaveValue(/Done today:/);
  await dialog.getByLabel("End-of-day note").fill("Done today:\n- Cleared the shared inbox");
  await dialog.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note saved.")).toBeVisible(slow);
  await expect(dialog).toHaveCount(0);

  await page.goto("/attendance");
  await expect(page.getByText("Cleared the shared inbox")).toBeVisible(slow);
});

test("welcome back after a long gap: the person can ask their lead to clock them out at the last time they were seen", async ({ browser }) => {
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Wanda", `WbLead${stamp}`, { roles: ["team_lead"] });
  const worker = await createEmployeeAccount("Wes", `Wb${stamp}`, { managerId: lead.employeeId });
  // Wes clocked in 3 hours ago and was last seen 2 hours ago, then the laptop restarted
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_in', now() - interval '3 hours')`;
    await sql`insert into time.clock_presence (employee_id, last_seen_at) values (${worker.employeeId}, now() - interval '2 hours')`;
  } finally {
    await sql.end();
  }

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);
  const dialog = page.getByRole("alertdialog", { name: "Welcome back" });
  await expect(dialog).toBeVisible(slow);
  await expect(dialog).toContainText("Are you still working?");

  await dialog.getByRole("button", { name: "No, I stopped earlier" }).click();
  // Prefilled with the last time seen (2 hours ago), allowing for the minute that passes while the test runs
  const prefilled = await dialog.getByLabel("I stopped working at").inputValue();
  const asMs = (v: string) => Date.parse(`${v}:00Z`);
  expect(Math.abs(asMs(prefilled) - asMs(phoenix(2 * 3_600_000)))).toBeLessThanOrEqual(3 * 60_000);
  await dialog.getByLabel("What happened?").selectOption("device_problem");
  await dialog.getByRole("button", { name: "Ask my lead to clock me out" }).click();
  await expect(page.getByText(/Waiting for approval of your clock-out/)).toBeVisible(slow);
  await expect(dialog).toHaveCount(0);

  // The lead sees it in the queue, with the cause
  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/attendance?tab=corrections");
  await expect(leadPage.getByText("My device restarted or failed.", { exact: true })).toBeVisible(slow);

  // Changing their mind: cancel the request and keep working
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "Clock out" })).toBeVisible(slow);
});

test("a time claim with a screenshot is reviewed by the lead, who can open the proof and approve", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lena", `ClaimLead${stamp}`, { roles: ["team_lead"] });
  const worker = await createEmployeeAccount("Cal", `Claim${stamp}`, { managerId: lead.employeeId });

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);
  await page.goto("/attendance");
  await waitForHydration(page, "#cr-kind");
  await page.getByLabel("What do you need to add?").selectOption("session");
  await page.getByLabel("Why?").selectOption("forgot");
  await page.getByLabel("I started at").fill(phoenix(4 * 3_600_000));
  await page.getByLabel("I stopped at").fill(phoenix(2 * 3_600_000));
  await page.getByLabel("Reason").fill("I started work but forgot to clock in");
  // A claim that adds a clock-in cannot be sent without proof
  await expect(page.getByRole("button", { name: "Send for approval" })).toBeDisabled();
  await expect(page.getByText("Never include client or patient information.").first()).toBeVisible();
  await page.getByLabel(/Screenshots as proof/).setInputFiles({ name: "history.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Correction sent for approval.")).toBeVisible(slow);

  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/attendance?tab=corrections");
  await expect(leadPage.getByText("I started work but forgot to clock in")).toBeVisible(slow);
  await expect(leadPage.getByRole("button", { name: "View screenshot 1" })).toBeVisible();
  await (await hydrated(leadPage.getByRole("button", { name: "Approve" }))).click();
  await expect(leadPage.getByText("Correction approved.")).toBeVisible(slow);

  // The approved time is on the worker's timesheet as a finished session
  await page.goto("/attendance");
  await expect(page.locator("tr[data-session]")).toHaveCount(1, slow);
});

test("HR sees the Jibble tab and the per-team switch, and nobody else gets the tab", async ({ browser }) => {
  const slow = { timeout: 30_000 };
  const hr = await createHrAccount();
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/jibble");
  await expect(hrPage.getByRole("heading", { name: "Jibble", exact: true })).toBeVisible(slow);
  await expect(hrPage.getByText("ELEVATE is the time clock and the only source of hours.")).toBeVisible();
  await expect(hrPage.getByRole("button", { name: "Test connection" })).toBeVisible();
  await expect(hrPage.getByRole("heading", { name: /^People/ })).toBeVisible();

  const employee = await createEmployeeAccount("Jo", `NoJibble${Date.now()}`);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, employee);
  await page.goto("/jibble");
  await expect(page.getByRole("link", { name: "Jibble" })).toHaveCount(0);
  await expect(page.getByText("Test connection")).toHaveCount(0);
});

test("HR sets a schedule and the employee sees it in both time zones", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Sam", `Shift${stamp}`);
  const hr = await createHrAccount();

  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/schedules");
  await waitForHydration(hrPage, "#sc-filter");
  await hrPage.getByLabel("Find a person or team").fill(`Shift${stamp}`);
  await hrPage.getByLabel(/^Select Sam/).check();
  await hrPage.getByLabel("Shift starts").fill("21:00");
  await hrPage.getByLabel("Shift ends").fill("05:00");
  await hrPage.getByLabel("Time zone").fill("Asia/Manila");
  await hrPage.getByRole("button", { name: "Set schedule for 1 person" }).click();
  await expect(hrPage.getByText("Schedule set for 1 person.")).toBeVisible(slow);
  await expect(hrPage.getByText("Mon to Fri, 9:00 PM - 5:00 AM (Asia/Manila)").first()).toBeVisible(slow);

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, employee);
  await page.goto("/attendance");
  await expect(page.getByRole("region", { name: "My schedule" })).toContainText("Mon to Fri, 9:00 PM - 5:00 AM (Asia/Manila)", slow);
  await expect(page.getByRole("region", { name: "My schedule" })).toContainText("9:00 PM - 5:00 AM in Manila");
  await expect(page.getByRole("columnheader", { name: "Shift" })).toBeVisible();
  await expect(page.getByText("Rest day").first()).toBeVisible();
});

async function withClient(employeeId: string) {
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [c] = await sql<{ id: string }[]>`insert into core.clients (name, time_zone) values (${`E2E Client ${Date.now()}`}, 'America/New_York') returning id`;
    await sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${c.id}, current_date - 30)`;
  } finally {
    await sql.end();
  }
}

test("a VA asks for extra hours with the client's approval and the lead approves", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lia", `XhLead${stamp}`, { roles: ["team_lead"] });
  const va = await createEmployeeAccount("Vic", `Xh${stamp}`, { managerId: lead.employeeId });
  await withClient(va.employeeId);

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, va);
  await page.goto("/extra-hours");
  await waitForHydration(page, "#eh-client");
  await page.getByLabel("From").fill(phoenix(-3 * 3_600_000));
  await page.getByLabel("Until").fill(phoenix(-5 * 3_600_000));
  await page.getByLabel("Who at the client approved it?").fill("Dana Reyes");
  await page.getByLabel("Reason").fill("Client needs the month-end report");
  // A request cannot be sent without the client's approval attached
  await expect(page.getByRole("button", { name: "Send for approval" })).toBeDisabled();
  await expect(page.getByText("Never include client or patient information.")).toBeVisible();
  await page.getByLabel(/Screenshot of the client's approval/).setInputFiles({ name: "approval.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText(/Sent to your lead/)).toBeVisible(slow);
  await expect(page.getByText("Waiting for approval")).toBeVisible(slow);

  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/extra-hours");
  await expect(leadPage.getByText("Client needs the month-end report")).toBeVisible(slow);
  await expect(leadPage.getByRole("button", { name: "View screenshot 1" })).toBeVisible();
  await (await hydrated(leadPage.getByRole("button", { name: "Approve" }))).click();
  await expect(leadPage.getByText("Approved.", { exact: true })).toBeVisible(slow);

  await page.reload();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible(slow);
});

test("past the end of the shift the header asks whether they are working extra hours", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const worker = await createEmployeeAccount("Shea", `Shift${Date.now()}`);
  const hhmm = (agoMs: number) => new Date(Date.now() - agoMs).toLocaleTimeString("en-GB", { timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit", hour12: false });
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    // A shift that began 6 hours ago and ended 2 hours ago (Phoenix time), with the person still clocked in since it began
    await sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${worker.employeeId}, current_date - 5, ${hhmm(6 * 3_600_000)}, ${hhmm(2 * 3_600_000)}, array[1,2,3,4,5,6,7]::smallint[], 0, 'America/Phoenix')`;
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_in', now() - interval '6 hours')`;
  } finally {
    await sql.end();
  }
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);
  const dialog = page.getByRole("alertdialog", { name: "Your shift has ended" });
  await expect(dialog).toBeVisible(slow);
  await expect(dialog).toContainText("Your shift ended at");
  await dialog.getByRole("link", { name: "Ask for extra hours" }).click();
  await page.waitForURL("**/extra-hours");
  await expect(dialog).toHaveCount(0);
});

test("a lead approves a finished week and HR downloads the approved hours", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lara", `HrsLead${stamp}`, { roles: ["team_lead"] });
  const worker = await createEmployeeAccount("Will", `Hrs${stamp}`, { managerId: lead.employeeId });
  const hr = await createHrAccount();

  // Last week's Monday and Tuesday: two normal 7 hour days (9 to 5 with a lunch hour) on a schedule that covers only those days
  const phxDate = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Phoenix" });
  const mondayOf = (d: string) => {
    const dt = new Date(`${d}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const monday = mondayOf(phxDate(-7));
  const tuesday = new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${worker.employeeId}, ${monday}::date - 20, '09:00', '17:00', array[1,2]::smallint[], 60, 'America/Phoenix')`;
    for (const d of [monday, tuesday]) {
      for (const [type, time] of [["clock_in", "09:00"], ["break_start", "12:00"], ["break_end", "13:00"], ["clock_out", "17:00"]]) {
        await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, ${type}, timezone('America/Phoenix', ${d}::date + ${time}::time))`;
      }
      // What the nightly rebuild would have written for that day
      await sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, break_minutes, scheduled_minutes, first_in, last_out)
        values (${worker.employeeId}, ${d}::date, 1, 420, 60, 420, timezone('America/Phoenix', ${d}::date + time '09:00'), timezone('America/Phoenix', ${d}::date + time '17:00'))`;
    }
  } finally {
    await sql.end();
  }

  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/hours-review");
  await expect(leadPage.getByText(`Will Hrs${stamp}`)).toBeVisible(slow);
  await expect(leadPage.getByText("Not approved").first()).toBeVisible();
  await (await hydrated(leadPage.getByRole("button", { name: "Approve week" }))).click();
  await expect(leadPage.getByText(/Approved 2 days for/)).toBeVisible(slow);
  await expect(leadPage.getByText("Approved", { exact: true }).first()).toBeVisible(slow);

  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/attendance?tab=export");
  await waitForHydration(hrPage, "#pp-kind");
  await hrPage.getByLabel("Pay periods", { exact: true }).selectOption("weekly");
  await hrPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(hrPage.getByText("Pay periods saved.")).toBeVisible(slow);
  await hrPage.reload();
  await waitForHydration(hrPage, "#ex-period");
  await hrPage.getByLabel("Pay period", { exact: true }).selectOption(monday);
  const [download] = await Promise.all([hrPage.waitForEvent("download"), hrPage.getByRole("button", { name: "Download daily detail (CSV)" }).click()]);
  expect(download.suggestedFilename()).toContain(`hours-daily-${monday}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Playwright's own download path
  const csv = readFileSync((await download.path())!, "utf8");
  expect(csv).toContain(`Will Hrs${stamp}`);
  expect(csv).toContain("Approved");
  // This person's two approved days (the local database may hold other people approved by earlier runs)
  expect(csv.split("\r\n").filter((line) => line.includes(`Will Hrs${stamp}`))).toHaveLength(2);

  // Put the pay periods back so the next run starts from the default
  const reset = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await reset`update time.hours_settings set pay_period_kind = 'semi_monthly' where id = 1`;
  } finally {
    await reset.end();
  }
});

test("HR sees the Health tab and the bulk corrections panel, and a lead sees neither", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const hr = await createHrAccount();
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/attendance?tab=health");
  await expect(hrPage.getByRole("heading", { name: "Scheduled jobs" })).toBeVisible(slow);
  await expect(hrPage.getByText("Sending clock calls to Jibble")).toBeVisible();
  await expect(hrPage.getByRole("heading", { name: "Jibble", exact: true })).toBeVisible();

  await hrPage.goto("/attendance?tab=corrections");
  await waitForHydration(hrPage, "#bc-csv");
  await expect(hrPage.getByRole("heading", { name: "File many corrections from a spreadsheet" })).toBeVisible(slow);
  await expect(hrPage.getByRole("button", { name: "File the batch" })).toBeDisabled();
  await hrPage.getByLabel("Spreadsheet (paste the CSV text, or choose a file)").fill("email,type,time\nnobody.here@example.com,clock_in,2026-10-05 09:00");
  await hrPage.getByLabel("Reason (everyone is told)").fill("Test of the bulk panel");
  await hrPage.getByRole("button", { name: "File the batch" }).click();
  await expect(hrPage.getByText("No active person has that email.")).toBeVisible(slow);

  const lead = await createEmployeeAccount("Lola", `NoHealth${Date.now()}`, { roles: ["team_lead"] });
  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/attendance?tab=health");
  await expect(leadPage.getByRole("link", { name: "Health" })).toHaveCount(0);
  await expect(leadPage.getByText("Scheduled jobs")).toHaveCount(0);
  await leadPage.goto("/attendance?tab=corrections");
  await expect(leadPage.getByText("File many corrections from a spreadsheet")).toHaveCount(0);
});

test("the Schedules menu item opens its own page and stays highlighted; the employee sees their own schedule there", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.getByRole("link", { name: "Schedules", exact: true }).click();
  await hrPage.waitForURL("**/schedules", slow);
  await expect(hrPage.getByRole("heading", { name: "Set a schedule" })).toBeVisible(slow);
  await expect(hrPage.getByRole("link", { name: "Schedules", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(hrPage.getByRole("link", { name: "Attendance", exact: true })).not.toHaveAttribute("aria-current", "page");

  const worker = await createEmployeeAccount("Sia", `Sched${Date.now()}`);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);
  await page.getByRole("link", { name: "Schedules", exact: true }).click();
  await page.waitForURL("**/schedules", slow);
  await expect(page.getByRole("region", { name: "My schedule" })).toContainText("no schedule yet", slow);
  await expect(page.getByRole("heading", { name: "Set a schedule" })).toHaveCount(0); // only HR sets them
  await expect(page.getByText("Not built yet")).toHaveCount(0);
});

test("My profile stays My profile: its own address and menu highlight, not the People list", async ({ page }) => {
  const slow = { timeout: 30_000 };
  const worker = await createEmployeeAccount("Pia", `Prof${Date.now()}`);
  await signInEnrollingMfa(page, worker);
  await page.getByRole("link", { name: "My profile", exact: true }).click();
  await page.waitForURL("**/people/me", slow);
  await expect(page.getByRole("link", { name: "My profile", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "People", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /Pia Prof/ })).toBeVisible(slow);
  await expect(page.getByRole("link", { name: "← People" })).toHaveCount(0);

  // Its tabs keep the address too
  await page.getByRole("link", { name: "Emergency" }).click();
  await page.waitForURL("**/people/me?tab=emergency", slow);
  await expect(page.getByRole("link", { name: "My profile", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Team attendance, Hours review, Extra hours and Jibble are their own menu items; the menu only offers what the role can open", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  for (const [name, path, heading] of [
    ["Team attendance", "/team-attendance", "Team attendance"],
    ["Hours review", "/hours-review", "Hours review"],
    ["Extra hours", "/extra-hours", "Extra hours"],
    ["Jibble", "/jibble", "Jibble"],
  ] as const) {
    await hrPage.getByRole("link", { name, exact: true }).click();
    await hrPage.waitForURL(`**${path}`, slow);
    await expect(hrPage.getByRole("heading", { name: heading, exact: true })).toBeVisible(slow);
    await expect(hrPage.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(hrPage.getByRole("link", { name: "Attendance", exact: true })).not.toHaveAttribute("aria-current", "page");
  }
  // Old addresses still land on the right page
  await hrPage.goto("/attendance?tab=team");
  await hrPage.waitForURL("**/team-attendance", slow);

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Ria", `Menu${Date.now()}`));
  await expect(page.getByRole("link", { name: "Extra hours", exact: true })).toBeVisible(slow);
  for (const name of ["Team attendance", "Hours review", "Jibble"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
});

test("long lists show one page at a time: Schedules pages through everyone and keeps the selection", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.goto("/schedules");
  await waitForHydration(hrPage, "#sc-filter");
  const rows = hrPage.locator("section[aria-label='Schedules'] tbody tr");
  await expect(rows.first()).toBeVisible(slow);
  expect(await rows.count()).toBeLessThanOrEqual(25);
  const pager = hrPage.getByRole("navigation", { name: "Pages" });
  await expect(pager).toContainText("Page 1 of");
  const first = await rows.first().innerText();
  await hrPage.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pager).toContainText("Page 2 of");
  expect(await rows.first().innerText()).not.toBe(first);
  // Selecting on page 2 survives going back
  await rows.first().getByRole("checkbox").check();
  await hrPage.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(hrPage.getByRole("button", { name: /Set schedule for 1 person/ })).toBeVisible();
});
