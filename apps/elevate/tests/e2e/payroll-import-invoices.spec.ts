import { expect, test, type Page } from "@playwright/test";
import { excelSerial, jibbleDay, jibbleMemberSheet, workbook } from "../helpers/jibble-workbook";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people and hours only (never a real Jibble file). The run is made in a random
// past period that is free in the local database, and the pay line is ended at the end so the database stays usable.

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test("payroll: fill a draft run from a Jibble timesheet, take a person off and put them back; invoice pages follow the role", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();

  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const worker = await createEmployeeAccount("Wanda", `Worker${stamp}`);
  const outsider = await createEmployeeAccount("Olga", `Outsider${stamp}`);
  const newPage = async () => (await (await browser.newContext()).newPage());
  const adminPage = await newPage();
  const prepPage = await newPage();
  const outPage = await newPage();
  await signInEnrollingMfa(adminPage, admin);
  await signInEnrollingMfa(prepPage, preparer);
  await signInEnrollingMfa(outPage, outsider);

  try {
    await setLevel(adminPage, preparer.email, "Preparer");

    // A pay line for the worker and a run for the period.
    await prepPage.goto("/payroll/rates");
    await prepPage.getByRole("button", { name: "Add contractor" }).click();
    await waitForHydration(prepPage, "#add-person");
    const option = prepPage.locator("#add-person option", { hasText: `Wanda Worker${stamp}` });
    await prepPage.locator("#add-person").selectOption(await option.getAttribute("value"));
    await prepPage.locator("#add-monthly").fill("25,000.00");
    await prepPage.getByRole("dialog").getByText("Pick another date").click();
    await prepPage.locator("#add-from").fill(period.start);
    await prepPage.getByRole("dialog").getByRole("button", { name: "Add contractor" }).click();
    await expect(prepPage.getByText("Rate added.")).toBeVisible();

    await prepPage.goto("/payroll");
    await prepPage.getByRole("button", { name: "New run" }).click();
    await waitForHydration(prepPage, "#run-start");
    await prepPage.locator("#run-start").fill(period.start);
    await prepPage.locator("#run-end").fill(period.end);
    await prepPage.getByRole("button", { name: "Create run" }).click();
    await prepPage.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
    const runId = prepPage.url().split("/").pop()!;
    const line = prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` });
    await expect(line).toBeVisible();

    // Take the person off the draft run, see the list below the worksheet, put them back.
    await line.getByRole("button", { name: /^Actions for/ }).click();
    await prepPage.getByRole("menuitem", { name: "Remove from this run" }).click();
    await waitForHydration(prepPage, "textarea");
    await prepPage.getByLabel("Reason").fill("Not paid this cutoff");
    await prepPage.getByRole("button", { name: "Take off this run" }).click();
    await expect(prepPage.getByText(`Wanda Worker${stamp} taken off the run.`)).toBeVisible();
    await expect(prepPage.getByRole("region", { name: "People taken off this run" })).toBeVisible();
    await prepPage.getByRole("button", { name: "Put back" }).click();
    await expect(prepPage.getByText(`Wanda Worker${stamp} is back on the run.`)).toBeVisible();
    await expect(prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` })).toBeVisible();

    // A made-up Jibble file: two days inside the period (8 h 06 m and 9 h 30 m with 1 h 30 m overtime).
    const code = `W${stamp}`.toUpperCase();
    const sheet = workbook([
      { name: "Team Summary", rows: [["Custom Timesheets"]] },
      jibbleMemberSheet(`Wanda Worker${stamp}`, code, [
        jibbleDay(excelSerial(addDays(period.start, 1)), "8h 06m"),
        jibbleDay(excelSerial(addDays(period.start, 2)), "9h 30m", { dailyOt: "1h 30m" }),
      ]),
    ]);
    await prepPage.getByRole("button", { name: "Fill or update this run" }).click();
    await expect(prepPage.getByRole("menuitem")).toHaveCount(3);
    await prepPage.getByRole("menuitem", { name: /Import Jibble timesheet/ }).click();
    await prepPage.waitForURL(`**/payroll/${runId}/import`);
    await expect(prepPage.getByRole("heading", { level: 1, name: "Import a Jibble timesheet" })).toBeVisible();
    await prepPage.locator("#jibble-file").setInputFiles({ name: "timesheet.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: sheet });
    await prepPage.getByRole("button", { name: "Read the file" }).click();
    await expect(prepPage.getByText("Read 1 people from the timesheet.")).toBeVisible();

    // The preview matches the member by name and shows the totals; nothing is written until "Fill the run".
    const previewRow = prepPage.getByRole("row").filter({ hasText: code });
    await expect(previewRow).toBeVisible();
    await expect(previewRow.getByText("17.6")).toBeVisible(); // 8 h 06 m + 9 h 30 m = 17 h 36 m = 17.6 hours
    await expect(previewRow.getByText("1 h 30 min")).toBeVisible();
    await prepPage.getByRole("button", { name: "Fill the run" }).click();
    await expect(prepPage.getByText(/Filled 1 pay lines with \d+ suggested amounts/)).toBeVisible();
    await prepPage.waitForURL(`**/payroll/${runId}`);

    // The suggestions sit on the line, and one button confirms them all.
    await expect(prepPage.getByRole("button", { name: /Confirm all/ })).toBeVisible();

    // Nobody without a payroll level opens the import page, and a person with no invoice rights cannot open the invoice pages.
    expect((await outPage.goto(`/payroll/${runId}/import`))?.status()).toBe(404);
    expect((await outPage.goto("/invoices"))?.status()).toBe(404);
    expect((await outPage.goto("/invoices/rates"))?.status()).toBe(404);
    await outPage.goto("/dashboard");
    await expect(outPage.locator('a[href="/invoices"]')).toHaveCount(0);

    // A Super Admin (no payroll level) has the Invoices menu item and both pages, and no Payroll item.
    await adminPage.goto("/dashboard");
    await expect(adminPage.locator('a[href="/invoices"]').first()).toHaveCount(1);
    await expect(adminPage.locator('a[href="/payroll"]')).toHaveCount(0);
    expect((await adminPage.goto("/invoices"))?.status()).toBe(200);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
    expect((await adminPage.goto("/invoices/rates"))?.status()).toBe(200);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Billing rates" })).toBeVisible();
  } finally {
    await endPayLinesOf(worker.employeeId);
  }
});
