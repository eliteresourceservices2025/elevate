import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people only. A run of 12 people (one starts part-way through the cutoff) in a
// random past period that is free in the local database; the pay lines are ended at the end. Checks the checklist by kind of problem, the
// plain flag with its date and "Use N days", the filter chips, and "Go to this line" on the same page, on another page, and on a phone.

const SHOTS = "test-results/checklist";

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

test("payroll: the checklist, plain flags, filter chips and Go to this line", async ({ browser }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();
  const startsOn = addDays(period.start, 5); // the first person starts part-way through the cutoff

  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const workers: Awaited<ReturnType<typeof createEmployeeAccount>>[] = [];
  for (let i = 0; i < 12; i++) workers.push(await createEmployeeAccount(`Wnn${String.fromCharCode(97 + i)}`, `Test${stamp}`));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  const a = await adminCtx.newPage();
  await signInEnrollingMfa(a, admin);
  await signInEnrollingMfa(p, preparer);

  try {
    await setLevel(a, preparer.email, "Preparer");

    // Twelve pay lines; the first starts part-way through the cutoff.
    for (let i = 0; i < workers.length; i++) {
      await p.goto("/payroll/rates");
      await p.getByRole("button", { name: "Add contractor" }).click();
      await waitForHydration(p, "#add-person");
      const option = p.locator("#add-person option", { hasText: `Wnn${String.fromCharCode(97 + i)} Test${stamp}` });
      await p.locator("#add-person").selectOption(await option.getAttribute("value"));
      await p.locator("#add-monthly").fill("25,000.00");
      await p.getByRole("dialog").getByText("Pick another date").click();
      await p.locator("#add-from").fill(i === 0 ? startsOn : period.start);
      await p.getByRole("dialog").getByRole("button", { name: "Add contractor" }).click();
      await expect(p.getByText("Rate added.")).toBeVisible();
      await expect(p.getByRole("dialog")).toHaveCount(0);
    }

    // The run.
    await p.goto("/payroll");
    await p.getByRole("button", { name: "New run" }).click();
    await waitForHydration(p, "#run-start");
    await p.locator("#run-start").fill(period.start);
    await p.locator("#run-end").fill(period.end);
    await p.getByRole("button", { name: "Create run" }).click();
    await p.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
    const runId = p.url().split("/").pop()!;

    // ---- The checklist is by kind of problem, with a plain meaning and a count ----
    const checklist = p.getByRole("list", { name: "What to fix" });
    await expect(checklist).toBeVisible();
    const payout = checklist.locator('[data-issue="no_payout_details"]');
    await expect(payout.getByRole("heading", { name: "No payout details" })).toBeVisible();
    await expect(payout.getByText("12 people")).toBeVisible();
    const part = checklist.locator('[data-issue="new_or_leaving"]');
    await expect(part.getByRole("heading", { name: "Paid for part of the cutoff" })).toBeVisible();
    await expect(part.getByText("1 person")).toBeVisible();
    await expect(p.getByRole("list", { name: "Where this run is" })).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/1-checklist-desktop.png` });

    // ---- The flag says the real date, explains itself in plain words, and fixes it with one button ----
    const starter = p.locator('tr[id^="row-"]').filter({ hasText: `Wnna Test${stamp}` });
    const pill = starter.getByRole("button", { name: /^Starts \d+ \w+\. Why is this flagged\?$/ });
    await expect(pill).toBeVisible();
    await pill.click();
    const dialog = p.getByRole("dialog");
    await expect(dialog.getByText(/pay line starts on .* but this cutoff began on/)).toBeVisible();
    await expect(dialog.getByText(/pays a full cutoff unless you tell it how many days/)).toBeVisible();
    await p.screenshot({ path: `${SHOTS}/2-flag-explained.png` });
    const useDays = dialog.getByRole("button", { name: /^Use \d+ days?$/ });
    await expect(useDays).toBeVisible();
    await useDays.click();
    await expect(p.getByText("Days saved. The line needs a new check.")).toBeVisible();
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await starter.getByRole("button", { name: /^Starts .*Why is this flagged\?$/ }).click();
    await expect(p.getByRole("dialog").getByText(/Days entered:/)).toBeVisible();
    await p.keyboard.press("Escape");

    // ---- Show who: the sheet shows only those people, and the chips say so ----
    await p.goto(`/payroll/${runId}`);
    await p.locator('[data-issue="new_or_leaving"]').getByRole("link", { name: "Show who" }).click();
    await p.waitForURL(/focus=new_or_leaving/);
    await expect(p.locator('tr[id^="row-"]')).toHaveCount(1);
    await expect(p.getByRole("status").filter({ hasText: "Showing 1 of 12 lines" })).toBeVisible();
    await p.getByRole("navigation", { name: "Filter the sheet" }).getByRole("link", { name: /^All/ }).click();
    await expect(p.locator('tr[id^="row-"]')).toHaveCount(12);

    // ---- Go to this line: on the same page, on another page, and on a phone ----
    await p.goto(`/payroll/${runId}?size=10`);
    const rowsOnPage = await p.locator('tr[id^="row-"]').evaluateAll((els) => els.map((e) => e.id.replace("row-", "")));
    expect(rowsOnPage).toHaveLength(10);
    await p.getByText(/^See every note by person/).click();
    const cards = p.locator("[data-readiness-person]");
    await expect(cards).toHaveCount(12);

    // A line on this page: the link scrolls to its row (and flashes it) without leaving the page.
    const same = cards.filter({ hasText: `Wnnj Test${stamp}` });
    await same.getByRole("link", { name: "Go to this line" }).click();
    const sameRow = p.locator('tr[id^="row-"]').filter({ hasText: `Wnnj Test${stamp}` });
    await expect(sameRow).toBeInViewport();
    await expect(sameRow).toHaveAttribute("data-flash", "");

    // A line on the other page: the link opens page 2 and lands on the row.
    const names = await cards.locator("h3").allTextContents();
    let other = "";
    for (const n of names) {
      if ((await p.locator('tr[id^="row-"]').filter({ hasText: n }).count()) === 0) {
        other = n;
        break;
      }
    }
    expect(other, "a person on page 2").not.toBe("");
    await cards.filter({ hasText: other }).getByRole("link", { name: "Go to this line" }).click();
    await p.waitForURL(/page=2/);
    const otherRow = p.locator('tr[id^="row-"]').filter({ hasText: other });
    await expect(otherRow).toBeInViewport();
    await expect(otherRow).toHaveAttribute("data-flash", "");

    // On a phone the cards are showing and the table is hidden: the link finds the visible one.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`/payroll/${runId}?size=10`);
    await p.getByText(/^See every note by person/).click();
    await p.locator("[data-readiness-person]").filter({ hasText: `Wnnj Test${stamp}` }).getByRole("link", { name: "Go to this line" }).click();
    const phoneCard = p.locator('li[id^="card-"]').filter({ hasText: `Wnnj Test${stamp}` });
    await expect(phoneCard).toBeInViewport();
    await expect(phoneCard).toHaveAttribute("data-flash", "");
    await p.screenshot({ path: `${SHOTS}/3-go-to-line-phone.png` });
  } finally {
    for (const w of workers) await endPayLinesOf(w.employeeId);
  }
});
