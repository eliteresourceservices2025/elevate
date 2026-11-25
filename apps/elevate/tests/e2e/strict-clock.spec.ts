import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, hydrated, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. The "stops by itself" step calls the host's backstop route, so start the dev server
// with CRON_SECRET set and give the same value to this run (the step is skipped when it is missing).
// Strict time rules (2026-11-24): after the shift ends the clock refuses a clock-in, approved extra hours or make-up hours let the person
// work their window, and the clock stops by itself when that window ends.

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// A value for a datetime-local box in Phoenix time, `offsetMs` from now (negative = in the future).
const phoenix = (agoMs: number) => new Date(Date.now() - agoMs).toLocaleString("sv-SE", { timeZone: "America/Phoenix" }).replace(" ", "T").slice(0, 16);
const hhmm = (agoMs: number) => new Date(Date.now() - agoMs).toLocaleTimeString("en-GB", { timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit", hour12: false });
const phoenixHour = () => Number(new Date().toLocaleString("en-GB", { timeZone: "America/Phoenix", hour: "2-digit", hour12: false }));
const slow = { timeout: 30_000 };

async function withClient(employeeId: string) {
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [c] = await sql<{ id: string }[]>`insert into core.clients (name, time_zone) values (${`E2E Client ${Date.now()}`}, 'America/New_York') returning id`;
    await sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${c.id}, current_date - 30)`;
  } finally {
    await sql.end();
  }
}

/** Every day of the week 9-to-5 style, but the shift ended an hour ago (start four hours before that): the person is past their hours now. */
async function shiftEndedAnHourAgo(employeeId: string) {
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${employeeId}, current_date - 5, ${hhmm(5 * 3_600_000)}, ${hhmm(1 * 3_600_000)}, array[1,2,3,4,5,6,7]::smallint[], 0, 'America/Phoenix')`;
  } finally {
    await sql.end();
  }
}

test.beforeEach(() => {
  // The shift is built from the time of day, so it would wrap past midnight in the first hours of the Phoenix day.
  test.skip(phoenixHour() < 5, "The shift would cross midnight Phoenix time.");
});

test("after the shift the clock refuses; approved extra hours let the VA work; the clock stops by itself when they end", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lia", `StrictLead${stamp}`, { roles: ["team_lead"] });
  const va = await createEmployeeAccount("Vic", `Strict${stamp}`, { managerId: lead.employeeId });
  await withClient(va.employeeId);
  await shiftEndedAnHourAgo(va.employeeId);

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, va);

  // 1. The shift is over: the clock will not start
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  const refusal = page.getByRole("dialog", { name: "Something needs attention" });
  await expect(refusal).toContainText("You have no hours left for today. If you need to work, ask your lead for extra hours or make-up hours first.");
  await refusal.getByRole("button", { name: "I understand" }).click();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible(); // still clocked out

  // 2. The VA asks for extra hours (a window that is open now), the lead approves
  await page.goto("/extra-hours");
  await waitForHydration(page, "#eh-client");
  await page.getByLabel("From").fill(phoenix(0));
  await page.getByLabel("Until").fill(phoenix(-2 * 3_600_000));
  await page.getByLabel("Who at the client approved it?").fill("Dana Reyes");
  await page.getByLabel("Reason").fill("Client needs the month-end report");
  await page.getByLabel(/Screenshot of the client's approval/).setInputFiles({ name: "approval.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText(/Sent to your lead/)).toBeVisible(slow);

  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/extra-hours");
  await expect(leadPage.getByText("Client needs the month-end report")).toBeVisible(slow);
  await (await hydrated(leadPage.getByRole("button", { name: "Approve" }))).click();
  await expect(leadPage.getByText("Approved.", { exact: true })).toBeVisible(slow);

  // 3. With the approval the clock starts
  await page.goto("/dashboard");
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Clocked in.")).toBeVisible(slow);
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);

  // 4. The approved window ends (moved into the past here): the sweep clocks the person out, stamped when the window ended
  const secret = process.env.CRON_SECRET;
  test.skip(!secret, "Set CRON_SECRET on the dev server and for this run to test the automatic stop.");
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`update time.extra_hours_requests set window_start = now() - interval '30 minutes', window_end = now() - interval '1 minute'
      where employee_id = ${va.employeeId} and status = 'approved'`;
    const sweep = await page.request.get("/api/cron/backstop", { headers: { authorization: `Bearer ${secret}` } });
    expect(sweep.ok()).toBe(true);
    expect((await sweep.json()).autoStop.stopped).toBeGreaterThanOrEqual(1);

    const [stop] = await sql<{ source: string; type: string }[]>`select source, type from time.clock_events where employee_id = ${va.employeeId} order by occurred_at desc, created_at desc limit 1`;
    expect(stop).toEqual({ source: "auto_stop", type: "clock_out" });
  } finally {
    await sql.end();
  }

  await page.reload();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible(slow);
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("Your clock stopped automatically")).toBeVisible(slow);
});

test("make-up hours: a VA asks to make up a missed day, the lead approves, and the clock lets them work the window", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lara", `MkLead${stamp}`, { roles: ["team_lead"] });
  const va = await createEmployeeAccount("Mina", `Mk${stamp}`, { managerId: lead.employeeId });
  await withClient(va.employeeId);
  await shiftEndedAnHourAgo(va.employeeId); // scheduled every day, nothing worked: yesterday is a missed day

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, va);

  // The shift is over, so the clock refuses until make-up hours are approved
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByRole("dialog", { name: "Something needs attention" })).toContainText("make-up hours first");

  await page.goto("/make-up-hours");
  await waitForHydration(page, "#mk-day");
  await expect(page.getByLabel("The day you are making up for").locator("option").first()).toContainText("left to make up");
  await page.getByLabel("The day you are making up for").selectOption({ index: 0 });
  await page.getByLabel("Starts").fill(phoenix(0));
  await page.getByLabel("Ends").fill(phoenix(-2 * 3_600_000));
  await page.getByLabel("Why were you away?").fill("Sick day, making it up tonight");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent for approval.")).toBeVisible(slow);

  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/make-up-hours");
  await expect(leadPage.getByText("Waiting for your decision")).toBeVisible(slow);
  await (await hydrated(leadPage.getByRole("button", { name: "Approve" }))).click();
  await expect(leadPage.getByText("Approved.", { exact: true })).toBeVisible(slow);

  await page.goto("/dashboard");
  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Clocked in.")).toBeVisible(slow);
  await expect(page.getByText("Working", { exact: true })).toBeVisible(slow);
});
