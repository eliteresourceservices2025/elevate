import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to ELEVATE" })).toBeVisible();
});

test("dashboard shell lists every module", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["People", "Time off", "Recruiting", "Safe Voice cases", "Settings"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
});
