import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. Uses an invented attendance sheet: HR uploads it, reads the preview (one person
// matched, one unknown that needs a person), applies the matched row, and the assignment and schedule exist. An ordinary employee
// cannot open the page.

const mmddyy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;

test("HR imports schedules and clients from an attendance sheet: upload, preview, apply", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 45_000 };
  const stamp = Date.now();
  const last = `Import${stamp}`;
  const clientName = `E2E Sheet Client ${stamp}`;

  const person = await createEmployeeAccount("Sched", last);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  let clientId = "";
  try {
    const [c] = await sql<{ id: string }[]>`insert into core.clients (name) values (${clientName}) returning id`;
    clientId = c.id;
  } finally {
    await sql.end();
  }

  const day = new Date(Date.now() - 2 * 86_400_000);
  const csv = [
    `${mmddyy(day)},,,,,,,,`,
    "Monday,Name,Client,Schedule,In,Lunch,Back,Out,Total Hours",
    `,Sched ${last},${clientName},8:00 am - 5:00 pm AZ,7:55 AM,,,5:02 PM,-3.20`,
    `,Nobody ${last},${clientName},8:00 am - 5:00 pm AZ,7:58 AM,,,5:00 PM,8.00`,
  ].join("\n");

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/settings/import-schedules");
  await expect(hr.getByRole("heading", { name: "Import schedules and clients" })).toBeVisible(slow);

  await hr.locator("#sheet-file").setInputFiles({ name: "attendance.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await hr.getByRole("button", { name: "Read the sheet" }).click();
  await hr.waitForURL(/\/settings\/import-schedules\/[0-9a-f-]{36}$/, slow);

  // Preview: the matched person would change, the unknown one needs a person
  await expect(hr.getByText(/Nothing has been changed|Review before applying/).first()).toBeVisible(slow);
  await expect(hr.getByRole("button", { name: /Would change: 1/ })).toBeVisible(slow);
  await expect(hr.getByText(`Sched ${last}`).first()).toBeVisible();
  await hr.getByRole("button", { name: /Needs a person: 1/ }).click();
  await expect(hr.getByText(`Nobody ${last}`)).toBeVisible();
  await hr.getByRole("button", { name: /Would change: 1/ }).click();

  // Apply the matched row
  hr.once("dialog", (d) => void d.accept());
  await hr.getByRole("button", { name: /Apply 1 change/ }).click();
  await expect(hr.getByText("The import was applied.")).toBeVisible(slow);

  const check = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const assignment = await check<{ hours_per_week: string }[]>`select hours_per_week::text from core.client_assignments where employee_id = ${person.employeeId} and client_id = ${clientId} and end_date is null`;
    expect(assignment).toHaveLength(1);
    expect(assignment[0].hours_per_week).toBe("40.0");
    const schedule = await check<{ start_time: string; zone: string }[]>`select start_time, zone from time.schedules where employee_id = ${person.employeeId} and effective_to is null`;
    expect(schedule).toEqual([{ start_time: "08:00", zone: "America/Phoenix" }]);
  } finally {
    await check.end();
  }

  // An ordinary employee cannot open the import
  const employee = await createEmployeeAccount("Emi", `NoSheet${stamp}`);
  const other = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(other, employee);
  const response = await other.goto("/settings/import-schedules");
  expect(response?.status()).toBe(404);
});
