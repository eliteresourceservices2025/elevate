import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, endPayLinesOf, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people only. The Rates tab without date boxes: add a contractor (the cutoff being
// prepared is chosen for you), update the rate, stop paying, remove a rate that was added by mistake, and the notice that points to
// "Update rate" instead of an error when the same job is added twice.

const SHOTS = "test-results/rates";

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

test("payroll rates: add a contractor, update the rate, stop paying, remove a mistake", async ({ browser }) => {
  test.setTimeout(300_000);
  mkdirSync(SHOTS, { recursive: true });
  const stamp = Date.now().toString(36);
  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const ann = await createEmployeeAccount("Rate", `Ann${stamp}`);
  const bob = await createEmployeeAccount("Rate", `Bob${stamp}`);

  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage();
  const p = await ctx.newPage();
  await signInEnrollingMfa(a, admin);
  await signInEnrollingMfa(p, preparer);

  const rowOf = (last: string) => p.getByRole("row").filter({ hasText: last });
  const add = async (last: string, rate: string) => {
    await p.goto("/payroll/rates");
    await p.getByRole("button", { name: "Add contractor" }).click();
    await waitForHydration(p, "#add-person");
    const option = p.locator("#add-person option", { hasText: last });
    await p.locator("#add-person").selectOption(await option.getAttribute("value"));
    await p.locator("#add-monthly").fill(rate);
    return p.getByRole("dialog");
  };

  try {
    await setLevel(a, preparer.email, "Preparer");

    // ---- Add: the cutoff being prepared is already chosen, and there is no date box in the way ----
    let dialog = await add(`Ann${stamp}`, "25,000.00");
    await expect(dialog.getByRole("radio", { name: /\(being prepared\)/ })).toBeChecked();
    await expect(dialog.getByLabel("Starts on")).toHaveCount(0);
    await p.screenshot({ path: `${SHOTS}/1-add-contractor.png` });
    await dialog.getByRole("button", { name: "Add contractor" }).click();
    await expect(p.getByText("Rate added.")).toBeVisible();
    await expect(rowOf(`Ann${stamp}`)).toContainText("25,000.00");

    // ---- The same job twice: a notice that points to Update rate, and the button is off (no server error) ----
    dialog = await add(`Ann${stamp}`, "26,000.00");
    await expect(dialog.getByText(/already has a rate for/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Add contractor" })).toBeDisabled();
    await p.keyboard.press("Escape");

    // ---- Update rate ----
    await p.goto("/payroll/rates");
    await rowOf(`Ann${stamp}`).getByRole("button", { name: "Update rate" }).click();
    dialog = p.getByRole("dialog");
    await expect(dialog.getByText(/Current rate: .*25,000.00/)).toBeVisible();
    await dialog.getByLabel("New monthly rate (pesos)").fill("27,500.00");
    await expect(dialog.getByRole("radio", { name: /\(being prepared\)/ })).toBeChecked();
    await p.screenshot({ path: `${SHOTS}/2-update-rate.png` });
    await dialog.getByRole("button", { name: "Update rate" }).click();
    await expect(p.getByText("Rate updated.")).toBeVisible();
    await expect(rowOf(`Ann${stamp}`)).toContainText("27,500.00");
    await expect(rowOf(`Ann${stamp}`)).not.toContainText("25,000.00");

    // ---- Stop paying ----
    await rowOf(`Ann${stamp}`).getByRole("button", { name: /^More for/ }).click();
    await p.getByRole("menuitem", { name: "Stop paying" }).click();
    dialog = p.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: /\(being prepared\)/ })).toBeChecked();
    await p.screenshot({ path: `${SHOTS}/3-stop-paying.png` });
    await dialog.getByRole("button", { name: "Stop paying" }).click();
    await expect(p.getByText(/Stopped\./)).toBeVisible();
    await p.goto("/payroll/rates?ended=1");
    await expect(rowOf(`Ann${stamp}`)).toContainText(/Stop(s|ped) after/);

    // ---- Remove a rate added by mistake: it disappears from the list ----
    dialog = await add(`Bob${stamp}`, "30,000.00");
    await dialog.getByRole("button", { name: "Add contractor" }).click();
    await expect(p.getByText("Rate added.")).toBeVisible();
    await expect(rowOf(`Bob${stamp}`)).toHaveCount(1);
    await rowOf(`Bob${stamp}`).getByRole("button", { name: /^More for/ }).click();
    await p.getByRole("menuitem", { name: /^Remove/ }).click();
    await p.getByRole("dialog").getByRole("button", { name: "Remove this rate" }).click();
    await expect(p.getByText("Rate removed.")).toBeVisible();
    await expect(rowOf(`Bob${stamp}`)).toHaveCount(0);
    await p.goto("/payroll/rates?ended=1");
    await expect(rowOf(`Bob${stamp}`)).toHaveCount(0);

    // ---- A phone: the same actions, in cards ----
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto("/payroll/rates");
    await expect(p.getByRole("button", { name: "Add contractor" })).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/4-phone.png` });
  } finally {
    for (const w of [ann, bob]) await endPayLinesOf(w.employeeId);
  }
});
