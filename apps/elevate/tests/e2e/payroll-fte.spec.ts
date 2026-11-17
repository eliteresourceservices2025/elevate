import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people only. Rates with an FTE count, an internal-team rate paid per FTE, the Set FTE table, and the run's Total FTE with a count typed for the run.
test("FTE on the rates and the run", async ({ browser }) => {
  test.setTimeout(400_000);
  mkdirSync("test-results/fte", { recursive: true });
  const stamp = Date.now().toString(36);
  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const people = {
    a: await createEmployeeAccount("Fte", `Aa${stamp}`),
    b: await createEmployeeAccount("Fte", `Bb${stamp}`),
    d: await createEmployeeAccount("Fte", `Dd${stamp}`),
    i: await createEmployeeAccount("Fte", `Ii${stamp}`),
  };
  const period = await pickFreePayrollPeriod();
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(a, admin);
  await signInEnrollingMfa(p, preparer);
  try {
    await a.goto("/settings/payroll-access");
    await a.locator("#payroll-access-filter").fill(preparer.email);
    await a.getByRole("row").filter({ hasText: preparer.email }).getByRole("combobox").selectOption({ label: "Preparer" });
    await expect(a.getByText("Payroll access updated.")).toBeVisible();

    const add = async (last: string, fill: (page: Page) => Promise<void>) => {
      await p.goto("/payroll/rates");
      await p.getByRole("button", { name: "Add contractor" }).click();
      await waitForHydration(p, "#add-person");
      await p.locator("#add-person").selectOption(await p.locator("#add-person option", { hasText: last }).getAttribute("value"));
      await fill(p);
      await p.getByRole("dialog").getByText("Pick another date").click();
      await p.locator("#add-from").fill(period.start);
      await p.getByRole("dialog").getByRole("button", { name: "Add contractor" }).click();
      await expect(p.getByText("Rate added.")).toBeVisible();
    };
    await add(`Aa${stamp}`, async (page) => {
      await page.locator("#add-monthly").fill("25,000.00");
      await page.locator("#add-fte").selectOption("1");
    });
    await add(`Bb${stamp}`, async (page) => {
      await page.locator("#add-monthly").fill("20,000.00");
      await page.locator("#add-fte").selectOption("0.5");
    });
    await add(`Dd${stamp}`, async (page) => {
      await page.locator("#add-monthly").fill("20,000.00"); // FTE left as Not set
    });
    await add(`Ii${stamp}`, async (page) => {
      await page.locator("#add-basis").selectOption("per_fte");
      await expect(page.locator("#add-monthly")).toHaveCount(0);
      await page.locator("#add-per-fte").fill("1,500.00");
      await page.screenshot({ path: "test-results/fte/add-per-fte.png" });
    });

    await p.goto("/payroll/rates");
    await p.getByLabel("Find a person, client or alias").fill(`${stamp}`);
    await p.screenshot({ path: "test-results/fte/rates.png" });
    const rowOf = (last: string) => p.getByRole("row").filter({ hasText: last });
    await expect(rowOf(`Aa${stamp}`)).toContainText("1");
    await expect(rowOf(`Dd${stamp}`)).toContainText("Not set");
    await expect(rowOf(`Ii${stamp}`)).toContainText("per FTE");

    // Set FTE: the Not set one gets 1.
    await p.getByRole("button", { name: "Set FTE" }).click();
    const dialog = p.getByRole("dialog");
    await dialog.getByRole("combobox", { name: new RegExp(`Dd${stamp}`) }).selectOption("1");
    await p.screenshot({ path: "test-results/fte/set-fte.png" });
    await dialog.getByRole("button", { name: /^Save FTE/ }).click();
    await expect(p.getByText(/FTE saved for 1 rate/)).toBeVisible();

    // The run for the period: every person's count, the total and the internal-team line.
    await p.goto("/payroll");
    await p.getByRole("button", { name: "New run" }).click();
    await waitForHydration(p, "#run-start");
    await p.locator("#run-start").fill(period.start);
    await p.locator("#run-end").fill(period.end);
    await p.getByRole("button", { name: "Create run" }).click();
    await p.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
    const totalFte = p.locator("dl").filter({ hasText: "Total FTE" });
    await expect(totalFte).toContainText("2.5"); // 1 + 0.5 + 1
    const internal = p.getByRole("row").filter({ hasText: `Ii${stamp}` });
    await expect(internal).toContainText("2.5 × 1,500.00");
    await expect(internal).toContainText("3,750.00");
    await p.screenshot({ path: "test-results/fte/run.png", fullPage: false });

    // FTE for this run: Bb typed as 1 for the run -> total 3 and the internal line follows.
    const line = p.getByRole("row").filter({ hasText: `Bb${stamp}` });
    await line.getByRole("button", { name: /^Actions for/ }).click();
    await p.getByRole("menuitem", { name: "Amounts" }).click();
    await waitForHydration(p, "form select");
    await p.getByLabel("What to enter").selectOption({ label: "FTE for this run" });
    await p.getByLabel("Amount", { exact: true }).fill("1");
    await p.screenshot({ path: "test-results/fte/amounts.png" });
    await p.getByRole("button", { name: "Save amount" }).click();
    await expect(p.getByText("Amount saved.").first()).toBeVisible();
    await expect(totalFte).toContainText("3");
    await expect(internal).toContainText("3 × 1,500.00");
    await expect(internal).toContainText("4,500.00");
    await expect(line).toContainText("set for this run");
  } finally {
    for (const w of Object.values(people)) await endPayLinesOf(w.employeeId);
  }
});
