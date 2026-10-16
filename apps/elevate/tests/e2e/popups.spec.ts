import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. HR queues two announcements as sign-in pop-ups (one needs acknowledgment, one
// does not); a new employee sees them one at a time before the page, acknowledges the first, closes the second, and then the quick
// tour starts. The queue tab lets HR change the order.

async function postAndQueue(page: Page, title: string, requireAck: boolean) {
  await page.goto("/announcements/new");
  await waitForHydration(page, "#an-title");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Message").fill("Please read this before you start.");
  if (requireAck) await page.getByLabel("Require acknowledgment").check();
  await page.getByRole("button", { name: "Post announcement" }).click();
  await page.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  await (await hydrated(page.getByRole("button", { name: "Show as a pop-up" }))).click();
  await page.getByLabel("Show this as a pop-up when people sign in").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Queued as a pop-up.")).toBeVisible({ timeout: 30_000 });
}

test("queued announcements pop up after sign-in, in order, before the quick tour", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Pop", `Up${stamp}`, { tour: true });
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  const mustAck = `Read me first ${stamp}`;
  const closable = `For your information ${stamp}`;
  await postAndQueue(hr, mustAck, true);
  await postAndQueue(hr, closable, false);

  // The queue shows both, in the order they were queued
  await hr.goto("/announcements?tab=popups");
  const items = hr.getByRole("region", { name: "Pop-up queue" }).getByRole("listitem");
  await expect(items.filter({ hasText: mustAck })).toBeVisible({ timeout: 30_000 });
  await expect(items.filter({ hasText: closable })).toBeVisible();

  // The employee signs in: the first pop-up comes before anything else and cannot be closed
  const emp = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await signInEnrollingMfa(emp, employee);
  const popup = emp.getByRole("dialog").filter({ hasText: mustAck });
  await expect(popup).toBeVisible({ timeout: 30_000 });
  await expect(popup).toContainText("1 of 2");
  await expect(popup.getByRole("button", { name: "Close", exact: true })).toHaveCount(0); // no way out but acknowledging
  await emp.keyboard.press("Escape");
  await expect(popup).toBeVisible();
  await expect(emp.getByRole("dialog", { name: "Welcome to ELEVATE" })).toHaveCount(0); // the tour waits

  await (await hydrated(popup.getByRole("button", { name: "I acknowledge" }))).click();
  const second = emp.getByRole("dialog").filter({ hasText: closable });
  await expect(second).toBeVisible({ timeout: 30_000 });
  await second.getByRole("button", { name: "Close", exact: true }).first().click();

  // Both are done: the quick tour starts
  await expect(emp.getByRole("dialog", { name: "Welcome to ELEVATE" })).toBeVisible({ timeout: 20_000 });
  await emp.getByRole("dialog").getByRole("button", { name: "Skip" }).click();

  // They do not come back
  await emp.reload();
  await waitForHydration(emp, '[data-tour="account"]');
  await emp.waitForTimeout(2000);
  await expect(emp.getByRole("dialog").filter({ hasText: mustAck })).toHaveCount(0);
  await expect(emp.getByRole("dialog").filter({ hasText: closable })).toHaveCount(0);
});
