import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. The dashboard adapts to a person's roles; the search follows their access.

test("a person with two roles gets both views and the buttons for each", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  const account = await createEmployeeAccount("Dual", `Roles${Date.now().toString(36)}`, { roles: ["super_admin", "team_lead"] });
  await signInEnrollingMfa(page, account);

  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening)|Working late/ })).toContainText("Dual");
  const views = page.getByRole("navigation", { name: "Dashboard view" });
  await expect(views.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  await expect(views.getByRole("link", { name: "My team" })).toBeVisible();
  await expect(views.getByRole("link", { name: "My work" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Key numbers" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add person" })).toBeVisible();

  // The team view leads with the lead's own buttons; the choice survives a reload.
  await views.getByRole("link", { name: "My team" }).click();
  await expect(views.getByRole("link", { name: "My team" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Review hours" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add person" })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(views.getByRole("link", { name: "My team" })).toHaveAttribute("aria-current", "page");
});

test("a plain employee sees one view, no HR buttons, and no manager numbers", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Plain", `Worker${Date.now().toString(36)}`));

  await expect(page.getByRole("navigation", { name: "Dashboard view" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Request time off" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add person" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Key numbers" })).toHaveCount(0);
});

test("search finds pages and people with Ctrl+K, and an employee never gets applicants", async ({ browser }) => {
  test.setTimeout(150_000);
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  await waitForHydration(hr, 'button[aria-label="Search"]');
  await hr.keyboard.press("Control+k");
  const box = hr.getByRole("combobox", { name: "Search" });
  await expect(box).toBeFocused();
  await box.fill("org ch");
  await expect(hr.getByRole("option", { name: /Org chart/ })).toBeVisible({ timeout: 15_000 });
  await box.fill("Abear");
  await expect(hr.getByRole("group", { name: "People" }).getByRole("option").first()).toBeVisible({ timeout: 15_000 });
  await hr.keyboard.press("Enter");
  await hr.waitForURL(/\/people\//);

  const emp = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(emp, await createEmployeeAccount("Finder", `Search${Date.now().toString(36)}`));
  await waitForHydration(emp, 'button[aria-label="Search"]');
  await emp.keyboard.press("Control+k");
  await emp.getByRole("combobox", { name: "Search" }).fill("a");
  await expect(emp.getByText("Type at least two letters.")).toBeVisible();
  await emp.getByRole("combobox", { name: "Search" }).fill("Abear");
  await expect(emp.getByRole("group", { name: "People" }).getByRole("option").first()).toBeVisible({ timeout: 15_000 });
  await expect(emp.getByRole("group", { name: "Applicants" })).toHaveCount(0);
  await expect(emp.getByRole("group", { name: "Equipment" })).toHaveCount(0);
});
