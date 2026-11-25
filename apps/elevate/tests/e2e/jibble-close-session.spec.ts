import { expect, test } from "@playwright/test";
import { formatInTimeZone } from "date-fns-tz";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied.
// A person on the Jibble clock whom ELEVATE still shows as clocked in (Jibble left an entry open) cannot be moved back by the plain
// button; HR closes the session at the time they stopped, with a reason, and moves them in one step.

test("HR closes a session Jibble left open and moves the person to the ELEVATE clock", async ({ page }) => {
  test.setTimeout(150_000);
  const hr = await createHrAccount();
  const stamp = Date.now().toString(36);
  const person = await createEmployeeAccount("Open", `Session${stamp}`);

  const startMs = Date.now() - 2 * 86_400_000;
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [u] = await sql<{ id: string }[]>`select id from core.users where lower(email) = ${hr.email.toLowerCase()}`;
    await sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by) values (${person.employeeId}, ${`e2e-${stamp}`}, 'manual')`;
    await sql`insert into time.clock_source (employee_id, source, set_by) values (${person.employeeId}, 'jibble', ${u.id})`;
    await sql`insert into time.clock_events (employee_id, type, occurred_at, source, jibble_entry_id) values (${person.employeeId}, 'clock_in', ${new Date(startMs)}, 'jibble', ${`e2e-entry-${stamp}`})`;
  } finally {
    await sql.end();
  }

  await signInEnrollingMfa(page, hr);
  await page.goto("/jibble");
  const row = page.getByRole("row", { name: new RegExp(`Session${stamp}`) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Jibble clock")).toBeVisible();
  await expect(row.getByText(/Clocked in since/)).toBeVisible();

  // The plain button explains what to do instead of a dead end.
  await row.getByRole("button", { name: "Use the ELEVATE clock" }).click();
  const refused = page.getByRole("dialog").filter({ hasText: "Close session and switch" });
  await expect(refused).toBeVisible();
  await refused.getByRole("button", { name: "I understand" }).click();
  await expect(refused).toBeHidden();

  // Close the session two hours after the clock-in (in their own zone, Phoenix) and switch.
  await row.getByRole("button", { name: "Close session and switch" }).click();
  const dialog = page.getByRole("dialog", { name: /Close Open Session.* open session/ });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/When did they stop/).fill(formatInTimeZone(new Date(startMs + 2 * 3_600_000), "America/Phoenix", "yyyy-MM-dd'T'HH:mm"));
  await dialog.getByLabel("Why is the session being closed?").fill("Left the Jibble timer running after the shift");
  await dialog.getByRole("button", { name: "Close the session and use the ELEVATE clock" }).click();

  const done = page.getByRole("dialog", { name: "Done" });
  await expect(done.getByText(/uses the ELEVATE clock now/)).toBeVisible();
  await done.getByRole("button", { name: "Close", exact: true }).last().click();

  await expect(row.getByText("ELEVATE clock")).toBeVisible();
  await expect(row.getByText(/Clocked in since/)).toHaveCount(0);

  const check = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const events = await check<{ type: string; source: string }[]>`select type, source from time.v_clock_events where employee_id = ${person.employeeId} order by occurred_at`;
    expect(events.map((e) => [e.type, e.source])).toEqual([["clock_in", "jibble"], ["clock_out", "admin_correction"]]);
  } finally {
    await check.end();
  }
});
