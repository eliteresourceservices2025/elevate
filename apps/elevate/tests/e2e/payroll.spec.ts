import { expect, test, type Page } from "@playwright/test";
import { anotherPayRunId, createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

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

test("payroll: levels, rate, run, review, approval, payment, payslip and history", async ({ browser }) => {
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

    // The Preparer sets the pay settings: the extra-hours rate from the period start, and the old values back from a few days later.
    await prepPage.goto("/payroll/settings");
    await prepPage.getByRole("button", { name: "Change settings" }).click();
    await waitForHydration(prepPage, "#set-extraRegular");
    const original = await prepPage.locator("#set-extraRegular").inputValue();
    await prepPage.keyboard.press("Escape");
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

    // An extra-hours item, entered twice so the history has an old and a new value.
    for (const minutes of ["60", "120"]) {
      await line.getByRole("button", { name: "Amounts" }).click();
      await waitForHydration(prepPage, "form select");
      await prepPage.getByLabel("What to enter").selectOption({ label: "Extra hours, regular day" });
      await prepPage.getByLabel("Amount", { exact: true }).fill(minutes);
      await prepPage.getByRole("button", { name: "Save amount" }).click();
      await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
      await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    }

    // The dollar rate, then the line is checked.
    await prepPage.getByRole("button", { name: /Dollar rate/ }).click();
    await waitForHydration(prepPage, "#usd-rate");
    await prepPage.locator("#usd-rate").fill("58.50");
    await prepPage.getByRole("button", { name: "Save rate" }).click();
    await expect(prepPage.getByText("Dollar rate saved.")).toBeVisible();
    await prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` }).getByRole("button", { name: "Mark as checked" }).click();
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
    expect(csv).toMatch(/Person,Alias,Pesos,Dollars/);

    await prepPage.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` }).last().getByRole("button", { name: "Mark paid" }).click();
    await waitForHydration(prepPage, `#ref-${worker.employeeId}`);
    await prepPage.locator(`#ref-${worker.employeeId}`).fill(`E2E-REF-${stamp}`);
    await prepPage.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click();
    await expect(prepPage.getByText("Payment recorded.")).toBeVisible();
    await expect(prepPage.getByText("Everyone on this run is paid.")).toBeVisible();

    // The worker opens My pay and downloads the payslip.
    await workPage.goto("/my-pay");
    const link = workPage.getByRole("link", { name: "Download PDF" });
    await expect(link).toHaveCount(1);
    const href = (await link.getAttribute("href"))!;
    expect(href).toBe(`/api/payroll/payslips/${runId}`);
    const slip = await workPage.context().request.get(href);
    expect(slip.status()).toBe(200);
    expect(slip.headers()["content-type"]).toContain("application/pdf");
    expect((await slip.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Only their own payslip: another run id (a real one when the database has one) and a made-up one are both not found.
    const other = (await anotherPayRunId(runId)) ?? "00000000-0000-4000-8000-000000000000";
    for (const id of [other, "11111111-1111-4111-8111-111111111111"]) {
      expect((await workPage.context().request.get(`/api/payroll/payslips/${id}`)).status()).toBe(404);
    }
    expect((await workPage.goto(`/payroll/${runId}`))?.status()).toBe(404);

    // The Approver reads the change history and sees the item's old and new values.
    await apprPage.goto(`/payroll/history?run=${runId}`);
    const changed = apprPage
      .getByRole("row")
      .filter({ hasText: "Amount saved on a line" })
      .filter({ has: apprPage.locator("td", { hasText: /^60$/ }) })
      .filter({ has: apprPage.locator("td", { hasText: /^120$/ }) });
    await expect(changed).toHaveCount(1);
    await expect(changed.getByText("Extra hours, regular day")).toBeVisible();
    await expect(apprPage.getByRole("row").filter({ hasText: "Payslip downloaded" }).first()).toBeVisible();
  } finally {
    await endPayLinesOf(worker.employeeId);
  }
});
