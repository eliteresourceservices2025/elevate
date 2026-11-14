import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people only. The run is made in a random past period that is free in the
// local database and the pay line is ended at the end, so the database stays usable.

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

test("payroll: drag the run sheet sideways, mark a run as a test, archive it, repeat the cycle and restore it", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();

  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const worker = await createEmployeeAccount("Wanda", `Worker${stamp}`);
  const newPage = async () => (await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());
  const adminPage = await newPage();
  const p = await newPage();
  await signInEnrollingMfa(adminPage, admin);
  await signInEnrollingMfa(p, preparer);

  try {
    await setLevel(adminPage, preparer.email, "Preparer");

    // A pay line and a run.
    await p.goto("/payroll/rates");
    await p.getByRole("button", { name: "Add pay line" }).click();
    await waitForHydration(p, "#add-person");
    const option = p.locator("#add-person option", { hasText: `Wanda Worker${stamp}` });
    await p.locator("#add-person").selectOption(await option.getAttribute("value"));
    await p.locator("#add-monthly").fill("25,000.00");
    await p.locator("#add-from").fill(period.start);
    await p.getByRole("dialog").getByRole("button", { name: "Add pay line" }).click();
    await expect(p.getByText("Pay line added.")).toBeVisible();

    const createRun = async (testRun = false) => {
      await p.goto("/payroll");
      await p.getByRole("button", { name: "New run" }).click();
      await waitForHydration(p, "#run-start");
      await p.locator("#run-start").fill(period.start);
      await p.locator("#run-end").fill(period.end);
      if (testRun) await p.locator("#run-test").check();
      await p.getByRole("button", { name: "Create run" }).click();
      await p.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
      return p.url().split("/").pop()!;
    };
    const first = await createRun();
    const line = p.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` });
    await expect(line).toBeVisible();

    // ---- Drag the sheet sideways ----
    // The sheet shows a short set of columns first; every column is one tick away.
    await p.getByLabel("Show every column").check();
    const sheet = p.getByRole("region", { name: /Pay run sheet/ });
    await expect(sheet).toBeVisible();
    const scrollLeft = () => sheet.evaluate((el) => el.scrollLeft);
    expect(await sheet.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // the sheet is wider than the window
    expect(await scrollLeft()).toBe(0);
    const cell = line.getByRole("cell").nth(1); // the Client cell: plain text, not a link or a button
    const box = (await cell.boundingBox())!;
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, { steps: 8 });
    await p.mouse.move(box.x + box.width / 2 - 400, box.y + box.height / 2, { steps: 8 });
    await p.mouse.up();
    expect(await scrollLeft()).toBeGreaterThan(200); // dragging left moved the sheet to the right
    // A drag that ends over the Actions menu does not open it; a plain click still does.
    await expect(p.getByRole("menuitem")).toHaveCount(0);
    await line.getByRole("button", { name: /^Actions for/ }).click();
    await expect(p.getByRole("menuitem", { name: "Amounts" })).toBeVisible();
    await p.keyboard.press("Escape");
    // The sheet takes the keyboard too.
    await sheet.focus();
    const before = await scrollLeft();
    await p.keyboard.press("ArrowLeft");
    await p.keyboard.press("ArrowLeft");
    await expect.poll(scrollLeft).toBeLessThan(before); // the scroll may animate, so wait for it

    // ---- A second real run for the same period is refused, and says how to repeat the cycle ----
    await p.goto("/payroll");
    await p.getByRole("button", { name: "New run" }).click();
    await waitForHydration(p, "#run-start");
    await p.locator("#run-start").fill(period.start);
    await p.locator("#run-end").fill(period.end);
    await p.getByRole("button", { name: "Create run" }).click();
    await expect(p.getByText(/already a pay run.*mark that run as a test run/)).toBeVisible();
    await p.keyboard.press("Escape");

    // ---- Mark the first run as a test run ----
    await p.goto(`/payroll/${first}`);
    await p.getByRole("button", { name: "Run options" }).click();
    await p.getByRole("menuitem", { name: "Mark as a test run" }).click();
    await waitForHydration(p, "textarea");
    await p.getByLabel("Reason").fill("Practice cycle");
    await p.getByRole("button", { name: "Mark as a test run" }).last().click();
    await expect(p.getByText("Done.")).toBeVisible();
    await expect(p.getByText("Test run", { exact: true })).toBeVisible();
    await expect(p.getByText(/This is a test run\. It is kept apart/)).toBeVisible();

    // ---- Archive it: it leaves the list and its period is free for a real run ----
    await p.getByRole("button", { name: "Run options" }).click();
    await p.getByRole("menuitem", { name: "Archive this test run" }).click();
    await waitForHydration(p, "textarea");
    await p.getByLabel("Reason").fill("Practice cycle done");
    await p.getByRole("button", { name: "Archive this test run" }).last().click();
    await expect(p.getByText("Archived", { exact: true })).toBeVisible();
    await p.goto("/payroll");
    await expect(p.locator(`a[href="/payroll/${first}"]`).first()).toHaveCount(0);
    await expect(p.getByRole("link", { name: /^Archived \(\d+\)$/ })).toBeVisible();

    // The same cycle again, as a real run (this is what the archive is for).
    const second = await createRun();
    expect(second).not.toBe(first);

    // ---- The archived one is still there, and can be restored ----
    await p.goto("/payroll?archived=1&size=100");
    await expect(p.locator(`a[href="/payroll/${first}"]`).first()).toBeVisible();
    await p.locator(`a[href="/payroll/${first}"]`).first().click();
    await p.getByRole("button", { name: "Run options" }).click();
    await p.getByRole("menuitem", { name: "Restore this run" }).click();
    await expect(p.getByText("Run restored.")).toBeVisible();
    await p.goto("/payroll?size=100");
    await expect(p.locator(`a[href="/payroll/${first}"]`).first()).toBeVisible();
    // Both runs of the period are in the list: the restored test run is marked Test, the real one is not.
    await expect(p.getByRole("row").filter({ has: p.locator(`a[href="/payroll/${first}"]`).first() }).getByText("Test", { exact: true })).toBeVisible();
    await expect(p.getByRole("row").filter({ has: p.locator(`a[href="/payroll/${second}"]`).first() }).getByText("Test", { exact: true })).toHaveCount(0);

    // ---- Select one or many: archive the test run and the cancelled run, restore both, delete one by its row and one in bulk ----
    const rowOf = (id: string) => p.getByRole("row").filter({ has: p.locator(`a[href="/payroll/${id}"]`) });
    const tick = async (id: string) => {
      const box = rowOf(id).getByRole("checkbox");
      await expect(async () => {
        if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
        await expect(box).toHaveAttribute("aria-checked", "true", { timeout: 1000 });
      }).toPass({ timeout: 20_000 });
    };
    const apply = async (action: string, confirmLabel: RegExp, reason?: string) => {
      await p.getByLabel("Bulk actions", { exact: true }).selectOption({ label: action });
      await p.getByRole("button", { name: "Apply" }).click();
      if (reason) await p.getByLabel("Reason").fill(reason);
      await p.getByRole("dialog").getByRole("button", { name: confirmLabel }).click();
    };

    // Cancel the real run (a cancelled run can be archived without a test tag).
    await p.goto(`/payroll/${second}`);
    await p.getByRole("button", { name: "Cancel run" }).click();
    await p.getByLabel("Reason").fill("Wrong period");
    await p.getByRole("button", { name: "Cancel this run" }).click();
    await expect(p.getByText("Run cancelled.")).toBeVisible();

    // Tick both on the list and archive them with one reason.
    await p.goto("/payroll?size=100");
    await tick(first);
    await tick(second);
    await expect(p.getByText("2 runs selected")).toBeVisible();
    await apply("Archive", /^Archive 2 runs$/, "Clearing out");
    await expect(p.getByText(/^Archived 2 runs\./)).toBeVisible();

    // The Archived view is a link with a count, and both runs are listed in it.
    await p.goto("/payroll?view=archived&size=100");
    await expect(p.getByRole("link", { name: /^Archived \(\d+\)$/ })).toHaveAttribute("aria-current", "page");
    await expect(rowOf(first)).toBeVisible();
    await expect(rowOf(second)).toBeVisible();

    // Restore both in bulk, then archive them again.
    await tick(first);
    await tick(second);
    await apply("Restore", /^Restore 2 runs$/);
    await expect(p.getByText(/^Restored 2 runs\./)).toBeVisible();
    await p.goto("/payroll?size=100");
    await expect(rowOf(first)).toBeVisible();
    await tick(first);
    await tick(second);
    await apply("Archive", /^Archive 2 runs$/, "Clearing out again");
    await expect(p.getByText(/^Archived 2 runs\./)).toBeVisible();

    // Delete the cancelled run from its own row action (one item), the test run in bulk (the other ticked item).
    await p.goto("/payroll?view=archived&size=100");
    await rowOf(second).getByRole("button", { name: "Delete for good" }).click();
    await expect(p.getByRole("dialog")).toContainText("This cannot be undone");
    await p.getByRole("dialog").getByRole("button", { name: /^Delete 1 run$/ }).click();
    await expect(p.getByText(/^Deleted 1 run\./)).toBeVisible();
    await expect(rowOf(second)).toHaveCount(0);
    await expect(rowOf(first)).toBeVisible();
    await tick(first);
    await apply("Delete for good", /^Delete 1 run$/);
    await expect(p.getByText(/^Deleted 1 run\./)).toBeVisible();
    await p.goto("/payroll?view=archived&size=100");
    await expect(rowOf(first)).toHaveCount(0);
  } finally {
    await endPayLinesOf(worker.employeeId);
  }
});
