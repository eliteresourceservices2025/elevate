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

  // Nothing but the content box and the menu list may ever scroll. A screen-reader-only field (the checkboxes and radio buttons our
  // component library draws) is absolutely positioned against the shell, so far down a long page it makes the shell itself scrollable;
  // focusing it then made the browser scroll the shell, which pushed the header and the top of the menu out of sight until a refresh.
  const stuck = await page.evaluate(() => {
    const shell = document.querySelector("[data-app-shell]") as HTMLElement;
    const column = document.querySelector("header")!.parentElement as HTMLElement;
    const menu = document.querySelector("#main-nav")!.parentElement as HTMLElement;
    const field = document.createElement("input");
    field.className = "sr-only";
    field.setAttribute("aria-label", "hidden field far down the page");
    document.querySelector("#main")!.appendChild(field);
    field.focus();
    for (const el of [shell, column, menu]) el.scrollTop = 150;
    return { shell: shell.scrollTop, column: column.scrollTop, menu: menu.scrollTop, headerTop: document.querySelector("header")!.getBoundingClientRect().top, logoTop: menu.getBoundingClientRect().top };
  });
  expect(stuck).toEqual({ shell: 0, column: 0, menu: 0, headerTop: 0, logoTop: 0 });

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
