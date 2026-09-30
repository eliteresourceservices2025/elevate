import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase (`supabase start`) with migrations applied (`pnpm db:migrate`).
// Creates a throwaway HR account and one fake person; both stay in the local database.
test("HR adds a person, saves an encrypted ID, and reveals it", async ({ page }) => {
  const account = await createHrAccount();
  await signInEnrollingMfa(page, account);

  const stamp = Date.now();
  const lastName = `E2e${stamp}`;

  // Add a person
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Erika");
  await page.getByLabel("Legal last name").fill(lastName);
  await page.getByLabel("Work email").fill(`erika.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: `Erika ${lastName}` })).toBeVisible();

  // Save a TIN: it is encrypted, so it shows masked
  await page.getByRole("link", { name: "Government IDs" }).click();
  await page.getByLabel("TIN").fill("123456789012");
  await page.getByRole("button", { name: "Save encrypted values" }).click();
  await expect(page.getByText("••••••••9012")).toBeVisible();

  // Reveal decrypts it on request
  await page.getByRole("button", { name: "Reveal TIN" }).click();
  await expect(page.getByText("123-456-789-012")).toBeVisible();

  // The history lists the change without the value
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("TIN updated")).toBeVisible();
  await expect(page.getByText("123-456-789-012")).toHaveCount(0);

  // And the directory finds the person
  await page.goto(`/people?q=${lastName}`);
  await expect(page.getByRole("link", { name: `Erika ${lastName}` })).toBeVisible();
});
