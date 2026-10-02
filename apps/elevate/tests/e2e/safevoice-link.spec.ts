import { expect, test } from "@playwright/test";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase. Every signed-in person gets a plain link to the separate anonymous Safe Voice site.

test("an employee finds the anonymous Safe Voice link in the menu", async ({ browser }) => {
  test.setTimeout(120_000);
  const employee = await createEmployeeAccount("Vera", `Voice${Date.now()}`);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(page, employee);
  await page.goto("/dashboard");
  const link = page.getByRole("link", { name: /Report a concern/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toMatch(/^https?:\/\//);
  expect(await link.getAttribute("target")).toBe("_blank");
  expect(await link.getAttribute("rel")).toContain("noreferrer");
  // The staff-only cases page is not in the menu for an ordinary employee
  await expect(page.getByRole("link", { name: "Safe Voice cases" })).toHaveCount(0);
  if (process.env.SV_SHOT_DIR) await page.screenshot({ path: `${process.env.SV_SHOT_DIR}/employee-menu.png` });
});
