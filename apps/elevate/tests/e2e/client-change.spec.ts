import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// HR moves a recorded clock-in from one client to the other. "Aaa" names stay within the first 1000 people of a well-used local database.
const SHOTS = process.env.SHOT_DIR;

test("HR changes the client of recorded time", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 45_000 };
  const stamp = String(Date.now()).slice(-6);
  const va = await createEmployeeAccount("Aaa", `Aaaclient${stamp}`);
  const names = [`Aaa North ${stamp}`, `Aaa South ${stamp}`];
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  const ids: string[] = [];
  const inAt = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3 * 3_600_000);
  try {
    for (const name of names) {
      const [c] = await sql<{ id: string }[]>`insert into core.clients (name, time_zone) values (${name}, 'America/Phoenix') returning id`;
      await sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${va.employeeId}, ${c.id}, current_date - 30)`;
      ids.push(c.id);
    }
    await sql`insert into time.clock_events (employee_id, type, occurred_at, client_id) values (${va.employeeId}, 'clock_in', ${inAt}, ${ids[1]})`;
    await sql`insert into time.clock_events (employee_id, type, occurred_at) values (${va.employeeId}, 'clock_out', ${new Date(inAt.getTime() + 3_600_000)})`;
  } finally {
    await sql.end();
  }

  const hr = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  const date = inAt.toLocaleDateString("sv-SE", { timeZone: "America/Phoenix" });
  await hr.goto(`/team-attendance?fix=${va.employeeId}&date=${date}`);
  const dialog = hr.getByRole("dialog");
  await expect(dialog.getByText(names[1])).toBeVisible(slow);
  await dialog.getByRole("button", { name: "Change client" }).click();
  await dialog.getByRole("combobox", { name: /New client for Clock in/ }).selectOption(ids[0]);
  await dialog.getByLabel("Why is the time being changed?").fill("North asked for this time");
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/c-change.png` });
  await dialog.getByRole("button", { name: "Save the change" }).click();
  await expect(hr.getByText("The time was changed. Their days are updated.")).toBeVisible(slow);

  const check = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const rows = await check`select client_id from time.v_clock_events where employee_id = ${va.employeeId} and type = 'clock_in'`;
    expect(rows.map((r) => r.client_id)).toEqual([ids[0]]);
  } finally {
    await check.end();
  }
});
