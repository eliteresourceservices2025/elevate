import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// HR changes one day for a person with two clients (one asks for the whole day, the other says not to work), undoes it, and marks a day
// off for a person with no fixed schedule. The names start with "Aaa" so they are within the first 1000 people of a well-used local database.
const SHOTS = process.env.SHOT_DIR;

test("HR changes one day, undoes it, and sets a day off", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 40_000 };
  const stamp = String(Date.now()).slice(-6);
  const va = await createEmployeeAccount("Dee", `Aaaday${stamp}`);
  const free = await createEmployeeAccount("Fia", `Aaafree${stamp}`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  const names = [`Aaa North ${stamp}`, `Aaa South ${stamp}`];
  try {
    for (const [i, name] of names.entries()) {
      const [c] = await sql<{ id: string }[]>`insert into core.clients (name, time_zone) values (${name}, 'America/New_York') returning id`;
      await sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${va.employeeId}, ${c.id}, current_date - 30)`;
      await sql`insert into time.schedules (employee_id, client_id, allotted_minutes_per_day, effective_from, start_time, end_time, weekdays, break_minutes, zone)
        values (${va.employeeId}, ${c.id}, 240, current_date - 10, ${i === 0 ? "09:00" : "13:00"}, ${i === 0 ? "13:00" : "17:00"}, array[1,2,3,4,5,6,7]::smallint[], 0, 'America/New_York')`;
    }
  } finally {
    await sql.end();
  }

  const hr = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto(`/schedules/${va.employeeId}`);
  await hr.waitForLoadState("networkidle");
  await hr.getByRole("button", { name: "Change a day" }).click();
  const dialog = hr.getByRole("dialog");
  await dialog.getByLabel(`Whole day for ${names[0]}, others off`).check();
  await dialog.getByLabel("Why is this day different?").fill("North asked for the whole day");
  await expect(dialog.getByText(/Total 8 h \(usual 8 h\)/)).toBeVisible();
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/p2-change.png` });
  await dialog.getByRole("button", { name: "Save day" }).click();
  const changed = hr.getByRole("region", { name: "Changed days" });
  await expect(changed).toContainText(`${names[1]}: off`, slow);
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/p2-week.png`, fullPage: true });
  await changed.getByRole("button", { name: "Undo" }).click();
  await expect(hr.getByRole("region", { name: "Changed days" })).toHaveCount(0, slow);

  await hr.goto(`/schedules/${free.employeeId}`);
  await hr.waitForLoadState("networkidle");
  const strip = hr.getByRole("list", { name: "Hours this week" });
  await strip.getByRole("button").last().click();
  await hr.getByRole("button", { name: "Day off" }).click();
  await hr.getByRole("button", { name: "Save changes" }).click();
  await expect(hr.getByText("Hours saved.")).toBeVisible(slow);
  await expect(strip).toContainText("Off");
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/p2-hours.png` });

  await hr.goto("/schedules");
  await hr.waitForLoadState("networkidle");
  await hr.getByLabel("Find a person or team").fill(`Aaafree${stamp}`);
  await hr.getByLabel(/^Select Fia/).check();
  await hr.getByRole("button", { name: "Set schedule for 1", exact: true }).click();
  await hr.getByRole("dialog").getByLabel("Hours per day only (no fixed schedule)").check();
  await hr.getByRole("dialog").getByLabel("Hours a day").fill("4");
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/p2-range.png` });
  await hr.getByRole("dialog").getByRole("button", { name: "Save hours for 1 person" }).click();
  // Nothing is replaced or skipped (only a weekend day was set before), so it saves without asking.
  await expect(hr.getByText("Hours saved for 1 of 1 person.")).toBeVisible(slow);
});
