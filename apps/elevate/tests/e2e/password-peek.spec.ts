import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

// The password boxes have a button that shows what was typed. Hidden by default; nothing is sent anywhere.

test("sign-in and sign-up password boxes can be shown and hidden", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/login");
  await waitForHydration(page, "#password");
  const password = page.locator("#password");
  await password.fill("a-typed-passphrase");
  await expect(password).toHaveAttribute("type", "password");

  const show = page.getByRole("button", { name: "Show password" });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await show.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("a-typed-passphrase");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  // Sign-up has two boxes, each with its own button.
  await page.goto("/signup");
  await waitForHydration(page, "#password");
  await expect(page.getByRole("button", { name: "Show password" })).toHaveCount(2);
  await page.locator("#confirmPassword").fill("another-passphrase");
  await page.getByRole("button", { name: "Show password" }).nth(1).click();
  await expect(page.locator("#confirmPassword")).toHaveAttribute("type", "text");
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
});
