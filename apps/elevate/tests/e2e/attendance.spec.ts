import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, hydrated, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied.

test("an employee clocks in, takes a break and clocks out from the header", async ({ page }) => {
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Clara", `Clock${stamp}`);
  await signInEnrollingMfa(page, employee);

  await (await hydrated(page.getByRole("button", { name: "Clock in" }))).click();
  await expect(page.getByText("Clocked in.")).toBeVisible();
  await expect(page.getByText("Working", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock in" })).toHaveCount(0);

  await page.getByRole("button", { name: "Break" }).click();
  await expect(page.getByText("On break", { exact: true })).toBeVisible();
  // A second window cannot clock in again while this one is on a break
  await page.getByRole("button", { name: "End break" }).click();
  await expect(page.getByText("Working", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clock out" }).click();
  await expect(page.getByText("Clocked out.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Clock in" })).toBeVisible();

  // The week shows today with the finished session
  await page.goto("/attendance");
  const week = page.getByRole("region", { name: "This week" });
  await expect(week.getByText("Still clocked in")).toHaveCount(0);
  await expect(week.getByRole("row").filter({ hasText: "Total" })).toBeVisible();
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
