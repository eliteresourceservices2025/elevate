import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

// HR changes someone's recorded time from Team attendance: picks the person and the day, removes the wrongly recorded clock-out, adds the
// right one, and gives a reason. The removed event stays on the record, marked as removed.

const phoenix = (agoMs: number) => new Date(Date.now() - agoMs).toLocaleString("sv-SE", { timeZone: "America/Phoenix" }).slice(0, 16).replace(" ", "T");

test("HR removes a wrong clock-out and adds the right one", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const worker = await createEmployeeAccount("Edit", `Hours${stamp}`);

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_in', now() - interval '6 hours'), (${worker.employeeId}, 'clock_out', now() - interval '1 hour')`;
  } finally {
    await sql.end();
  }

  const hr = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/team-attendance");
  await (await hydrated(hr.getByRole("button", { name: "Change someone's time" }))).click();

  await hr.getByLabel("Find a person").fill(`Hours${stamp}`);
  const first = await hr.locator("#eh-person option", { hasText: `Hours${stamp}` }).getAttribute("value");
  await hr.getByLabel("Person", { exact: true }).selectOption(first!);
  await hr.getByRole("button", { name: "Show this day" }).click();
  await expect(hr.getByText("Recorded events (America/Phoenix)")).toBeVisible(slow);
  await expect(hr.getByText(/Clock out ·/)).toBeVisible();

  // Nothing can be saved until something changes and there is a reason
  const save = hr.getByRole("button", { name: "Save the change" });
  await expect(save).toBeDisabled();
  await hr.getByLabel(/^Remove Clock out/).check();
  await hr.getByRole("button", { name: "Add an event" }).click();
  await hr.getByLabel("Type").selectOption("clock_out");
  await hr.getByLabel(/^When \(America\/Phoenix\)/).fill(phoenix(2 * 3_600_000));
  await expect(save).toBeDisabled(); // still no reason
  await hr.getByLabel("Why is the time being changed?").fill("He stopped at four hours; the clock-out was recorded late");
  await save.click();
  await expect(hr.getByText("The time was changed. Their days are updated.")).toBeVisible(slow);

  // The record: the wrong clock-out is still there, marked as removed; the right one counts
  await hr.getByRole("button", { name: "Change someone's time" }).click();
  await hr.getByLabel("Find a person").fill(`Hours${stamp}`);
  const value = await hr.locator("#eh-person option", { hasText: `Hours${stamp}` }).getAttribute("value");
  await hr.getByLabel("Person", { exact: true }).selectOption(value!);
  await hr.getByRole("button", { name: "Show this day" }).click();
  const recorded = hr.getByRole("region", { name: "Recorded events" });
  await expect(recorded.getByText("Removed", { exact: true })).toBeVisible(slow);
  await expect(recorded.getByText("Corrected", { exact: true })).toBeVisible();
});
