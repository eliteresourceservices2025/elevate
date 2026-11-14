import { expect, test, type Page } from "@playwright/test";
import { anotherPayRunId, createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, restorePaySettings, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people and amounts only. The run is made in a random past period that is
// free in the local database; the settings are put back and the pay line is ended at the end, so the database stays usable.

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

async function saveSettings(page: Page, from: string, extraRegular: string) {
  await page.getByRole("button", { name: "Change settings" }).click();
  await waitForHydration(page, "#set-from");
  await page.locator("#set-from").fill(from);
  await page.locator("#set-extraRegular").fill(extraRegular);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("payroll: levels, rate, run, review, approval, payment, contractor payment statement and history", async ({ browser }) => {
  test.setTimeout(420_000);
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();

  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const approver = await createEmployeeAccount("Ari", `Approver${stamp}`);
  const worker = await createEmployeeAccount("Wanda", `Worker${stamp}`);
  const alias = `E2E alias ${stamp}`;

  const page = async () => (await (await browser.newContext({ acceptDownloads: true })).newPage());
  const adminPage = await page();
  const prepPage = await page();
  const apprPage = await page();
  const workPage = await page();
  await signInEnrollingMfa(adminPage, admin);
  await signInEnrollingMfa(prepPage, preparer);
  await signInEnrollingMfa(apprPage, approver);
  await signInEnrollingMfa(workPage, worker);

  let settingsTouched = false;
  try {
    // A Super Admin with no level sees no Payroll menu item, and /payroll is a not-found page.
    await expect(adminPage.locator('a[href="/payroll"]')).toHaveCount(0);
    expect((await adminPage.goto("/payroll"))?.status()).toBe(404);
    expect((await adminPage.goto("/payroll/rates"))?.status()).toBe(404);
    // The person without any level cannot open the payroll pages either, and has no access list.
    expect((await workPage.goto("/payroll"))?.status()).toBe(404);
    expect((await workPage.goto("/settings/payroll-access"))?.status()).toBe(404);

    // The Super Admin chooses a Preparer and an Approver.
    await setLevel(adminPage, preparer.email, "Preparer");
    await setLevel(adminPage, approver.email, "Approver");
    // ...and still sees no Payroll menu item afterwards.
    await adminPage.goto("/dashboard");
    await expect(adminPage.locator('a[href="/payroll"]')).toHaveCount(0);

    // The Preparer sets the pay settings: the overtime (OT) rate from the period start, and the old values back from a few days later.
    await prepPage.goto("/payroll/settings");
    await prepPage.getByRole("button", { name: "Change settings" }).click();
    await waitForHydration(prepPage, "#set-extraRegular");
    const original = await prepPage.locator("#set-extraRegular").inputValue();
    await prepPage.keyboard.press("Escape");
    await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    settingsTouched = true; // from here on, the finally block puts the old settings back if the test stops early
    await saveSettings(prepPage, period.start, "125");
    await saveSettings(prepPage, period.later, original);

    // ...then a pay line for the worker, starting on the first day of the period.
    await prepPage.goto("/payroll/rates");
    await prepPage.getByRole("button", { name: "Add pay line" }).click();
    await waitForHydration(prepPage, "#add-person");
    const option = prepPage.locator("#add-person option", { hasText: `Wanda Worker${stamp}` });
    await prepPage.locator("#add-person").selectOption(await option.getAttribute("value"));
    await prepPage.locator("#add-alias").fill(alias);
    await prepPage.locator("#add-monthly").fill("25,000.00");
    await prepPage.locator("#add-from").fill(period.start);
    await prepPage.getByRole("dialog").getByRole("button", { name: "Add pay line" }).click();
    await expect(prepPage.getByText("Pay line added.")).toBeVisible();
    await expect(prepPage.getByRole("row").filter({ hasText: alias })).toBeVisible();

    // The Preparer creates the run for the period.
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

    // An overtime (OT) item, entered twice so the history has an old and a new value.
    for (const minutes of ["60", "120"]) {
      await line.getByRole("button", { name: /^Actions for/ }).click();
      await prepPage.getByRole("menuitem", { name: "Amounts" }).click();
      await waitForHydration(prepPage, "form select");
      await prepPage.getByLabel("What to enter").selectOption({ label: "Overtime (OT), regular day" });
      await prepPage.getByLabel("Hours or minutes").selectOption("m"); // overtime defaults to hours; this flow types minutes
      await prepPage.getByLabel("Amount", { exact: true }).fill(minutes);
      await prepPage.getByRole("button", { name: "Save amount" }).click();
      await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
      await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    }

    // A named allowance (itemized: it appears on the statement under its own name), then the line is checked.
    await line.getByRole("button", { name: /^Actions for/ }).click();
    await prepPage.getByRole("menuitem", { name: "Amounts" }).click();
    await waitForHydration(prepPage, "form select");
    await prepPage.getByLabel("What to enter").selectOption({ label: "Allowance" });
    await prepPage.getByLabel(/^Name of this allowance/).fill("Health allowance");
    await prepPage.getByLabel("Amount", { exact: true }).fill("500");
    await prepPage.getByRole("button", { name: "Save amount" }).click();
    await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
    await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    await prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` }).getByRole("button", { name: /^Actions for/ }).click();
    await prepPage.getByRole("menuitem", { name: "Mark as checked" }).click();
    await expect(prepPage.getByText("Line checked.")).toBeVisible();

    // Sent for review.
    const send = prepPage.getByRole("button", { name: "Send for review" });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(prepPage.getByText("Sent for review. The Approvers have been told.")).toBeVisible();
    await expect(prepPage.getByText("This run is waiting for approval.")).toBeVisible();

    // The Approver approves.
    await apprPage.goto(`/payroll/${runId}`);
    const approve = apprPage.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(apprPage.getByText("Run approved.").first()).toBeVisible();

    // The Preparer downloads the Remitly list and marks the person paid.
    await prepPage.goto(`/payroll/${runId}`);
    const [download] = await Promise.all([prepPage.waitForEvent("download"), prepPage.getByRole("button", { name: "Download Remitly list" }).click()]);
    const csvPath = await download.path();
    const csv = (await import("node:fs")).readFileSync(csvPath, "utf8");
    expect(csv).toContain(`Wanda Worker${stamp}`);
    expect(csv).toContain(alias);
    expect(csv).toMatch(/Person,Alias,Pesos/);
    expect(csv).not.toMatch(/Dollars/);
    // The figures, worked out here from the inputs (25,000.00 a month, divisor 11, 8 hours a day, 120 overtime minutes at 125%, a 500.00 allowance), not copied from the page.
    const half = (n: bigint, d: bigint) => (2n * n + d) / (2n * d); // divide, rounding half up
    const monthly = 2_500_000n; // centavos
    const pesos = monthly / 2n + half(monthly * 120n * 125n, 22n * 8n * 60n * 100n) + 50_000n;
    const fmt = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
    const row = csv.split(String.fromCharCode(10)).map((l) => l.trim()).find((l) => l.includes(`Wanda Worker${stamp}`))!;
    expect(row.split(",")[2]).toBe(fmt(pesos)); // Person, Alias, Pesos, then the bank cells (blank: this worker has no payout details)

    await prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` }).last().getByRole("button", { name: "Mark paid" }).click();
    await waitForHydration(prepPage, `#ref-${worker.employeeId}`);
    await prepPage.locator(`#ref-${worker.employeeId}`).fill(`E2E-REF-${stamp}`);
    await prepPage.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click();
    await expect(prepPage.getByText("Payment recorded.")).toBeVisible();
    await expect(prepPage.getByText("Everyone on this run is paid.")).toBeVisible();

    // Paid is not released: the worker sees nothing yet. A Preparer can read the statements and may release them.
    await workPage.goto("/my-pay");
    await expect(workPage.getByText("No statements yet")).toBeVisible();
    await prepPage.goto("/payroll/statements?size=100");
    await prepPage.locator(`a[href="/payroll/statements/${runId}"]`).click();
    await expect(prepPage.getByRole("button", { name: "Release to everyone" })).toBeEnabled();

    // The Approver reads the worker's statement; it already shows who prepared and authorized the run and when, without anyone signing.
    await apprPage.goto(`/payroll/statements/${runId}`);
    await expect(apprPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` })).toBeVisible();
    await apprPage.getByRole("link", { name: `View: Wanda Worker${stamp}` }).click();
    await expect(apprPage.getByRole("heading", { level: 1, name: `Statement for Wanda Worker${stamp}` })).toBeVisible();
    await expect(apprPage.getByText("Health allowance")).toBeVisible();
    // The certification block names the Preparer and the approval date by itself. Who is shown under "Authorized by" depends on whether a signatory
    // is set (a database that has run other specs has one), so that line is checked in the integration tests, which control the signatory.
    const certification = apprPage.getByRole("region", { name: "Certification" });
    await expect(certification).toContainText(`Pia Preparer${stamp}`);
    await expect(certification).toContainText(new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" }));

    // The Preparer releases all of them with one button.
    await prepPage.goto(`/payroll/statements/${runId}`);
    await prepPage.getByRole("button", { name: "Release to everyone" }).click();
    await expect(prepPage.getByRole("alertdialog")).toContainText("Release 1 statement?");
    await prepPage.getByRole("button", { name: "Release now" }).click();
    await expect(prepPage.getByText("Released 1 statement.")).toBeVisible();
    await expect(prepPage.getByText("These statements have been released to the contractors.")).toBeVisible();

    // The worker opens My payment statements and downloads the contractor payment statement.
    await workPage.goto("/my-pay");
    const link = workPage.getByRole("link", { name: "Download PDF" });
    await expect(link).toHaveCount(1);
    const href = (await link.getAttribute("href"))!;
    expect(href).toBe(`/api/payroll/payslips/${runId}`);
    const slip = await workPage.context().request.get(href);
    expect(slip.status()).toBe(200);
    expect(slip.headers()["content-type"]).toContain("application/pdf");
    expect((await slip.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // The worker can also read the statement in the page. Whether it is signed depends on the settings of this database, so only the
    // signature block is checked, not who signed.
    const view = workPage.locator(`a[href="/my-pay/${runId}"]`);
    await expect(view).toHaveCount(1);
    await view.click();
    await expect(workPage).toHaveURL(new RegExp(`/my-pay/${runId}$`));
    await expect(workPage.getByRole("heading", { level: 1, name: /^Contractor Payment Statement \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/ })).toBeVisible();
    await expect(workPage.getByText("Total payable compensation").first()).toBeVisible();
    await expect(workPage.getByText("Health allowance")).toBeVisible();
    await expect(workPage.getByText("Authorized by")).toBeVisible();
    await expect(workPage.getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/payroll/payslips/${runId}`);

    // Only their own statement: another run id (a real one when the database has one) and a made-up one are both not found.
    const other = (await anotherPayRunId(runId)) ?? "00000000-0000-4000-8000-000000000000";
    for (const id of [other, "11111111-1111-4111-8111-111111111111"]) {
      expect((await workPage.context().request.get(`/api/payroll/payslips/${id}`)).status()).toBe(404);
      expect((await workPage.goto(`/my-pay/${id}`))?.status()).toBe(404);
    }
    expect((await workPage.goto(`/payroll/${runId}`))?.status()).toBe(404);

    // The Approver reads the change history and sees the item's old and new values.
    await apprPage.goto(`/payroll/history?run=${runId}`);
    const changed = apprPage
      .getByRole("row")
      .filter({ hasText: "Amount saved on a line" })
      .filter({ has: apprPage.locator("td", { hasText: /^1 h$/ }) })
      .filter({ has: apprPage.locator("td", { hasText: /^2 h$/ }) });
    await expect(changed).toHaveCount(1);
    await expect(changed.getByText("Overtime (OT), regular day")).toBeVisible();
    await expect(apprPage.getByRole("row").filter({ hasText: "Contractor payment statement downloaded" }).first()).toBeVisible();
  } finally {
    try {
      if (settingsTouched) await restorePaySettings(period.start, period.later);
    } finally {
      await endPayLinesOf(worker.employeeId);
    }
  }
});
