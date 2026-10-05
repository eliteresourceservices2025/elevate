import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. The menu and header stay put while the content scrolls, and the menu narrows to icons.

test("the menu and header stay fixed, and the menu can be narrowed to icons", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
  const page = await context.newPage();
  await signInEnrollingMfa(page, await createHrAccount());
  await page.goto("/people");

  // Only the content area scrolls: the page itself never does.
  const metrics = () =>
    page.evaluate(() => ({
      pageScroll: document.documentElement.scrollHeight - window.innerHeight,
      headerTop: document.querySelector("header")!.getBoundingClientRect().top,
      navTop: document.querySelector("#main-nav")!.getBoundingClientRect().top,
    }));
  const before = await metrics();
  expect(before.pageScroll).toBeLessThanOrEqual(1);
  await page.locator("#main").evaluate((el) => {
    const box = el.parentElement!;
    const filler = document.createElement("div");
    filler.style.height = "3000px";
    el.appendChild(filler);
    box.scrollTop = box.scrollHeight;
  });
  const after = await metrics();
  expect(after.pageScroll).toBeLessThanOrEqual(1);
  expect(after.headerTop).toBe(before.headerTop);
  expect(after.navTop).toBe(before.navTop);
  expect(await page.locator("#main").evaluate((el) => el.parentElement!.scrollTop)).toBeGreaterThan(0);

  // Narrow to icons: labels leave the screen, every icon link keeps its name, the choice survives a reload.
  const aside = page.locator("aside");
  await expect(aside).toBeVisible();
  await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBeGreaterThan(200);
  await waitForHydration(page, 'button[aria-label="Hide menu labels"]');
  await page.getByRole("button", { name: "Hide menu labels" }).click();
  await expect.poll(async () => (await aside.boundingBox())?.width ?? 999).toBeLessThan(80);
  const people = page.locator("#main-nav").getByRole("link", { name: "People" });
  await expect(people).toBeVisible();
  await expect(people).toHaveAttribute("title", "People");
  await expect(people.locator("svg")).toBeVisible();
  await page.reload();
  await expect(aside).toBeVisible();
  await expect.poll(async () => (await aside.boundingBox())?.width ?? 999).toBeLessThan(80);
  await waitForHydration(page, 'button[aria-label="Show menu labels"]');
  await page.getByRole("button", { name: "Show menu labels" }).click();
  await expect.poll(async () => (await aside.boundingBox())?.width ?? 999).toBeGreaterThan(200);
});
