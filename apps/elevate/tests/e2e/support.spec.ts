import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Contact support: from the account menu, with the page the person was on offered; HR sees it in the inbox and marks it handled.

test("a person asks for help from the account menu and HR handles it", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const person = await createEmployeeAccount("Sam", `Help${stamp}`);
  const hr = await createHrAccount();

  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await signInEnrollingMfa(page, person);
  await page.goto("/attendance");
  await waitForHydration(page, '[data-tour="account"]');
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Contact support" }).click();
  await page.waitForURL(/\/support\?from=%2Fattendance/, slow);
  await waitForHydration(page, "#sp-subject");

  await expect(page.getByLabel(/Include the page I was on \(\/attendance\)/)).toBeChecked();
  await page.getByLabel("What is it about?").selectOption("time_clock");
  await page.getByLabel("Short title").fill(`Clock problem ${stamp}`);
  await page.getByLabel("What happened?").fill("I clocked in this morning but the page showed an error and I am not sure it saved.");
  await page.getByRole("button", { name: "Send to support" }).click();
  await expect(page.getByRole("heading", { name: "We got your request" })).toBeVisible(slow);
  await expect(page.getByText(`Clock problem ${stamp}`)).toBeVisible(slow);

  // HR sees it in the inbox and marks it handled.
  const hrPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto("/support");
  const item = hrPage.getByRole("listitem").filter({ hasText: `Clock problem ${stamp}` });
  await expect(item).toBeVisible(slow);
  await item.getByRole("button", { name: "Mark as handled" }).click();
  await expect(hrPage.getByText("Marked as handled.")).toBeVisible(slow);
});
