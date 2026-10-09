import { expect, test } from "@playwright/test";
import { createEmployeeAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. The quick tour starts by itself for a new account, can be skipped or finished, and
// can be replayed from Settings and from the account menu.

test("the quick tour starts for a new account, walks through, stops starting by itself, and can be replayed", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Tour", `Taker${Date.now().toString(36)}`, { tour: true }));

  const tour = page.getByRole("dialog", { name: "Welcome to ELEVATE" });
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await expect(tour).toContainText("Step 1 of");
  await tour.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("dialog", { name: "The menu" })).toBeVisible();

  // Walk to the end with Next; the last step offers Done.
  const title = page.locator("#tour-title");
  for (let i = 0; i < 12; i++) {
    const next = page.getByRole("dialog").getByRole("button", { name: "Next" });
    if ((await next.count()) === 0) break;
    const before = await title.textContent();
    await next.click({ timeout: 8_000 });
    await expect(title).not.toHaveText(before!); // wait for the next step to be in place before pressing again
  }
  await expect(page.getByRole("dialog", { name: "You are all set" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Finished: a reload does not start it again.
  await page.reload();
  await waitForHydration(page, '[data-tour="account"]');
  await page.waitForTimeout(2500);
  await expect(page.getByRole("dialog", { name: "Welcome to ELEVATE" })).toHaveCount(0);

  // Replay from Settings, skip with Escape
  await page.goto("/settings");
  await page.getByRole("link", { name: /Quick tour/ }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to ELEVATE" })).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/dashboard$/); // the ?tour=1 marker is taken off the address
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Replay from the account menu
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Quick tour" }).click();
  await expect(page.getByRole("dialog", { name: "Welcome to ELEVATE" })).toBeVisible();
});

test("on a phone the tour points at the menu button and docks to the bottom", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Phone", `Tour${Date.now().toString(36)}`, { tour: true }));
  const tour = page.getByRole("dialog", { name: "Welcome to ELEVATE" });
  await expect(tour).toBeVisible({ timeout: 15_000 });
  await tour.getByRole("button", { name: "Start" }).click();
  const menu = page.getByRole("dialog", { name: "The menu" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.y + box!.height).toBeGreaterThan(700); // docked near the bottom edge
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
