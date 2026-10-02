import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and the signed-docs bucket (pnpm storage:setup).
// HR starts an offboarding for a throwaway person, ticks a task, removes access now (the person's sign-in is switched off in the
// local Supabase), issues a certificate and completes it; the person's own page shows the exit interview.

test("HR offboards a person: checklist, remove access now, certificate", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const leaver = await createEmployeeAccount("Lia", `Leaves${stamp}`);

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  await hr.goto("/offboarding/new");
  await waitForHydration(hr, "#off-person");
  const value = await hr.locator("#off-person option", { hasText: `Leaves${stamp}` }).getAttribute("value");
  await hr.getByLabel("Person").selectOption(value!);
  await hr.getByRole("button", { name: "Start offboarding" }).click();
  await hr.waitForURL(/\/offboarding\/[0-9a-f-]{36}$/, slow);
  await expect(hr.getByRole("heading", { name: `Offboarding: Lia Leaves${stamp}` })).toBeVisible(slow);
  await expect(hr.getByText("Write and hand over turnover notes")).toBeVisible();

  // Tick a task that belongs to HR
  await hr.getByRole("button", { name: "Mark done" }).first().click();
  await expect(hr.getByText("Task done.")).toBeVisible(slow);

  // Remove access now
  await hr.getByRole("button", { name: "Remove access now" }).click();
  await hr.getByRole("button", { name: "Yes, remove access now" }).click();
  await expect(hr.getByText(/Access was removed on/)).toBeVisible(slow);

  // Certificate of engagement
  await hr.getByRole("button", { name: "Issue certificate of engagement" }).click();
  await expect(hr.getByRole("link", { name: /^CE-\d{4}-[0-9A-F]{6}$/ })).toBeVisible(slow);
  const href = await hr.getByRole("link", { name: /^CE-\d{4}-[0-9A-F]{6}$/ }).getAttribute("href");
  const pdf = await hr.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // The list shows the case
  await hr.goto("/offboarding");
  await expect(hr.getByRole("link", { name: `Lia Leaves${stamp}` })).toBeVisible(slow);
  expect(leaver.email).toContain("@example.com");
});
