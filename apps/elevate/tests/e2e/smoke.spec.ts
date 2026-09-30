import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to ELEVATE" })).toBeVisible();
});

test("app pages send a signed-out visitor to sign in", async ({ page }) => {
  for (const path of ["/dashboard", "/people", "/settings/roles"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});
