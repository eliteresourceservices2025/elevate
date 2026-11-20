import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people only. Walks every payroll and invoice page on a phone (390 x 844, touch,
// like an iPhone) and a tablet (820 x 1180, touch), as a Preparer who is also an Executive (so the Invoices pages open too). Each page must
// fit the screen without a sideways page scroll, menus and dialogs must stay on screen, and a screenshot of each is saved to
// test-results/mobile for a person to look at. This is Chromium emulating the device: it can't prove Safari, but it catches layout.

const SHOTS = "test-results/mobile";

type Device = { name: string; viewport: { width: number; height: number }; userAgent: string; scale: number; /** A laptop in the dark theme (no touch, not a phone). */ dark?: boolean };

const DEVICES: readonly Device[] = [
  { name: "phone", viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", scale: 3 },
  { name: "tablet", viewport: { width: 820, height: 1180 }, userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", scale: 2 },
  { name: "laptop-dark", viewport: { width: 1366, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", scale: 1, dark: true },
];

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

/** The elements that stick out past the screen's right edge and are not inside a box that scrolls on its own (for a readable failure). */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const limit = window.innerWidth;
    const scrolls = (el: Element | null) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const o = getComputedStyle(n).overflowX;
        if ((o === "auto" || o === "scroll") && n !== document.documentElement) return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= limit + 1 || scrolls(el)) continue;
      out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(r.right)}`);
      if (out.length >= 5) break;
    }
    return out;
  });

async function fits(page: Page, label: string) {
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sideways, `${label}: the page scrolls sideways by ${sideways}px. ${(await overflowing(page)).join(" | ")}`).toBeLessThanOrEqual(1);
}

/** Something that opened (a menu or a dialog) must sit inside the screen. */
async function onScreen(page: Page, locator: ReturnType<Page["locator"]>, label: string) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `${label} has no box`).not.toBeNull();
  expect(box!.x, `${label} sticks out on the left`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} sticks out on the right`).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y, `${label} starts above the screen`).toBeGreaterThanOrEqual(-1);
}

async function open(browser: Browser, device: Device) {
  const context = await browser.newContext({ viewport: device.viewport, userAgent: device.userAgent, deviceScaleFactor: device.scale, isMobile: !device.dark, hasTouch: !device.dark, ...(device.dark ? { colorScheme: "dark" as const } : {}) });
  return context.newPage();
}

test("payroll and invoices work on a phone and a tablet", async ({ browser }) => {
  test.setTimeout(540_000);
  mkdirSync(SHOTS, { recursive: true });
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();

  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const approver = await createEmployeeAccount("Ari", `Approver${stamp}`);
  const worker = await createEmployeeAccount("Wanda", `Worker${stamp}`);
  const setup = await createEmployeeAccount("Sue", `Setup${stamp}`); // makes the data on a desktop, so the phone and tablet accounts sign in for the first time on their own device
  const phoneUser = await createEmployeeAccount("Pia", `Phone${stamp}`, { roles: ["executive"] });
  const tabletUser = await createEmployeeAccount("Tia", `Tablet${stamp}`, { roles: ["executive"] });
  const laptopUser = await createEmployeeAccount("Lia", `Laptop${stamp}`, { roles: ["executive"] });

  const desktop = async () => (await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage());
  const adminPage = await desktop();
  const approverPage = await desktop();
  await signInEnrollingMfa(adminPage, admin);
  await signInEnrollingMfa(approverPage, approver);

  try {
    await setLevel(adminPage, setup.email, "Preparer");
    await setLevel(adminPage, phoneUser.email, "Preparer");
    await setLevel(adminPage, tabletUser.email, "Preparer");
    await setLevel(adminPage, laptopUser.email, "Preparer");
    await setLevel(adminPage, approver.email, "Approver");

    // Data, made on a desktop: a pay line, a draft run, and a test run that is approved (so there are statements to open).
    const prep = await desktop();
    await signInEnrollingMfa(prep, { ...setup });
    await prep.goto("/payroll/rates");
    await prep.getByRole("button", { name: "Add contractor" }).click();
    await waitForHydration(prep, "#add-person");
    const option = prep.locator("#add-person option", { hasText: `Wanda Worker${stamp}` });
    await prep.locator("#add-person").selectOption(await option.getAttribute("value"));
    await prep.locator("#add-monthly").fill("25,000.00");
    await prep.getByRole("dialog").getByText("Pick another date").click();
    await prep.locator("#add-from").fill(period.start);
    await prep.getByRole("dialog").getByRole("button", { name: "Add contractor" }).click();
    await expect(prep.getByText("Rate added.")).toBeVisible();

    const createRun = async (testRun: boolean) => {
      await prep.goto("/payroll");
      await prep.getByRole("button", { name: "New run" }).click();
      await waitForHydration(prep, "#run-start");
      await prep.locator("#run-start").fill(period.start);
      await prep.locator("#run-end").fill(period.end);
      if (testRun) await prep.locator("#run-test").check();
      await prep.getByRole("button", { name: "Create run" }).click();
      await prep.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
      return prep.url().split("/").pop()!;
    };
    const approvedRun = await createRun(true); // a test run, so nothing real is ever made
    await prep.getByRole("row").filter({ hasText: `Wanda Worker${stamp}` }).getByRole("button", { name: /^Actions for/ }).click();
    await prep.getByRole("menuitem", { name: "Mark as checked" }).click();
    await expect(prep.getByText("Line checked.")).toBeVisible();
    await prep.getByRole("button", { name: "Send for review" }).click();
    await expect(prep.getByText("This run is waiting for approval.")).toBeVisible();
    await approverPage.goto(`/payroll/${approvedRun}`);
    await approverPage.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(approverPage.getByText("Run approved.").first()).toBeVisible();
    const draftRun = await createRun(true); // a second test run, left as a draft for the run sheet and its menus

    const failures: string[] = [];
    for (const device of DEVICES) {
      const page = await open(browser, device);
      await signInEnrollingMfa(page, { ...(device.name === "phone" ? phoneUser : device.name === "tablet" ? tabletUser : laptopUser) });
      const pages: { path: string; name: string; heading: RegExp }[] = [
        { path: "/dashboard", name: "dashboard", heading: /./ },
        { path: "/payroll", name: "runs", heading: /^Payroll$/ },
        { path: "/payroll?view=action", name: "runs-needs-you", heading: /^Payroll$/ },
        { path: "/payroll?view=archived", name: "runs-archived", heading: /^Payroll$/ },
        { path: `/payroll/${draftRun}`, name: "run-sheet-draft", heading: /^Pay run / },
        { path: `/payroll/${approvedRun}`, name: "run-sheet-approved", heading: /^Pay run / },
        { path: `/payroll/${draftRun}/import`, name: "import", heading: /^Import a Jibble timesheet$/ },
        { path: "/payroll/rates", name: "rates", heading: /./ },
        { path: "/payroll/statements", name: "statements", heading: /^Contractor payment statements$/ },
        { path: `/payroll/statements/${approvedRun}`, name: "statements-run", heading: /Contractor payment statements/ },
        { path: "/payroll/history", name: "history", heading: /./ },
        { path: "/payroll/settings", name: "settings", heading: /./ },
        { path: "/invoices", name: "invoices", heading: /^Invoices$/ },
        { path: "/invoices?show=all", name: "invoices-all", heading: /^Invoices$/ },
        { path: "/invoices?show=void", name: "invoices-void", heading: /^Invoices$/ },
        { path: "/invoices/rates", name: "billing-rates", heading: /^Billing rates$/ },
      ];
      for (const p of pages) {
        const label = `${device.name} ${p.name}`;
        try {
          const res = await page.goto(p.path);
          expect(res?.status(), `${label}: status`).toBe(200);
          await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(p.heading);
          await page.waitForLoadState("networkidle").catch(() => {});
          await fits(page, label);
          await page.screenshot({ path: `${SHOTS}/${device.name}-${p.name}.png`, fullPage: false });
        } catch (error) {
          failures.push(`${label}: ${(error as Error).message.split("\n")[0]}`);
        }
      }

      // The one statement on a screen, and what opens on the run sheet and the lists.
      const steps: { label: string; run: () => Promise<void> }[] = [
        {
          label: `${device.name} one statement`,
          run: async () => {
            await page.goto(`/payroll/statements/${approvedRun}`);
            await page.getByRole("link", { name: `View: Wanda Worker${stamp}` }).click();
            await expect(page.getByRole("heading", { level: 1, name: `Statement for Wanda Worker${stamp}` })).toBeVisible();
            await fits(page, `${device.name} one statement`);
            await page.screenshot({ path: `${SHOTS}/${device.name}-statement.png` });
          },
        },
        {
          label: `${device.name} run sheet menus`,
          run: async () => {
            await page.goto(`/payroll/${draftRun}`);
            await page.getByRole("button", { name: "Fill or update this run" }).click();
            await onScreen(page, page.getByRole("menu"), "the fill menu");
            await page.screenshot({ path: `${SHOTS}/${device.name}-fill-menu.png` });
            await page.keyboard.press("Escape");
            await expect(page.getByRole("menu")).toHaveCount(0); // the first menu is gone before the next opens
            await page.getByRole("button", { name: /^Actions for/ }).first().click();
            await onScreen(page, page.getByRole("menu"), "the row menu");
            await page.screenshot({ path: `${SHOTS}/${device.name}-row-menu.png` });
            await page.getByRole("menuitem", { name: "Amounts" }).click();
            await onScreen(page, page.getByRole("dialog"), "the Amounts window");
            await expect(page.getByRole("dialog").getByLabel("What to enter")).toBeVisible();
            await fits(page, `${device.name} amounts dialog`);
            await page.screenshot({ path: `${SHOTS}/${device.name}-amounts.png` });
            await page.keyboard.press("Escape");
          },
        },
        {
          label: `${device.name} readiness screen and pay line cards`,
          run: async () => {
            await page.goto(`/payroll/${draftRun}`);
            await expect(page.getByRole("region", { name: "Run readiness" })).toBeVisible();
            if (device.name === "phone") {
              // A compact card per person: name, net, status; it opens to every figure; Actions stays beside it.
              const card = page.locator(`li[data-line="Wanda Worker${stamp}"]`);
              await expect(card).toBeVisible();
              await expect(card.getByText("Net", { exact: true })).toBeVisible();
              await expect(card.getByRole("button", { name: /^Actions for/ })).toBeVisible();
              await expect(card.getByText("Gross", { exact: true })).toBeHidden();
              await card.locator("summary").click();
              await expect(card.getByText("Gross", { exact: true })).toBeVisible();
              await fits(page, "phone pay line card open");
              await page.screenshot({ path: `${SHOTS}/phone-pay-line-card.png` });
            } else {
              await expect(page.getByLabel("Show every column")).toBeVisible();
            }
            await page.screenshot({ path: `${SHOTS}/${device.name}-readiness.png` });
          },
        },
        {
          label: `${device.name} new run window`,
          run: async () => {
            await page.goto("/payroll");
            await page.getByRole("button", { name: "New run" }).click();
            await waitForHydration(page, "#run-start");
            await onScreen(page, page.getByRole("dialog"), "the New run window");
            await page.screenshot({ path: `${SHOTS}/${device.name}-new-run.png` });
            await page.keyboard.press("Escape");
          },
        },
        {
          label: `${device.name} field descriptions open on a tap`,
          run: async () => {
            await page.goto("/payroll/settings");
            await page.getByRole("button", { name: "Change settings" }).click();
            const dialog = page.getByRole("dialog");
            await dialog.locator('[data-hint-for="Starts on"]').click();
            const tip = page.getByText(/first day these settings apply/);
            await expect(tip).toBeVisible();
            await onScreen(page, tip, "the Starts on description");
            await page.screenshot({ path: `${SHOTS}/${device.name}-field-hint.png` });
            await page.keyboard.press("Escape");
            await expect(tip).toHaveCount(0);
            await page.keyboard.press("Escape");
            await page.goto("/payroll/rates");
            await page.getByRole("button", { name: "Add contractor" }).click();
            await expect(page.getByRole("dialog").getByLabel("Regular day (%)")).toBeVisible();
            await onScreen(page, page.getByRole("dialog"), "the Add pay line window");
            await page.screenshot({ path: `${SHOTS}/${device.name}-add-pay-line.png` });
            await page.keyboard.press("Escape");
          },
        },
        {
          label: `${device.name} new invoice and rate windows`,
          run: async () => {
            await page.goto("/invoices");
            await page.getByRole("button", { name: "New invoice" }).click();
            await onScreen(page, page.getByRole("dialog"), "the New invoice window");
            await page.keyboard.press("Escape");
            await page.goto("/invoices/rates");
            await page.getByRole("button", { name: "Add a rate for a person" }).click();
            await onScreen(page, page.getByRole("dialog"), "the person rate window");
            await page.screenshot({ path: `${SHOTS}/${device.name}-person-rate.png` });
            await page.keyboard.press("Escape");
          },
        },
      ];
      for (const s of steps) {
        try {
          await s.run();
        } catch (error) {
          failures.push(`${s.label}: ${(error as Error).message.split("\n")[0]}`);
        }
      }
      // Tap targets: the main buttons on the run page should be big enough for a finger (at least 32 px; the guideline is 44).
      await page.goto(`/payroll/${draftRun}`);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("main button, main a[role='button'], main a.inline-flex")]
          .map((el) => ({ text: (el.textContent ?? "").trim().slice(0, 30), h: el.getBoundingClientRect().height }))
          .filter((b) => b.h > 0 && b.h < 32),
      );
      if (small.length > 0 && !device.dark) failures.push(`${device.name}: buttons under 32px tall: ${small.map((b) => `${b.text} (${Math.round(b.h)})`).join(", ")}`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  } finally {
    await endPayLinesOf(worker.employeeId);
  }
});
