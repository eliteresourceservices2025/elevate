import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// HR ticks several people and starts onboarding, then offboarding, for all of them in one go.

test("HR starts onboarding and offboarding for several people at once", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  await createEmployeeAccount("Ana", `Bulk${stamp}`);
  await createEmployeeAccount("Ben", `Bulk${stamp}`);

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  await hr.goto("/onboarding");
  await waitForHydration(hr, "#on-search");
  await hr.getByLabel("Search people").fill(`Bulk${stamp}`);
  await hr.getByRole("button", { name: "Select all shown" }).click();
  await expect(hr.getByText("2 selected")).toBeVisible();
  await hr.getByRole("button", { name: "Start onboarding for 2 people" }).click();
  await expect(hr.getByText("2 of 2 started.")).toBeVisible(slow);

  await hr.goto("/offboarding/new");
  await waitForHydration(hr, "#off-search");
  await hr.getByLabel("Search people").fill(`Bulk${stamp}`);
  await hr.getByRole("button", { name: "Select all shown" }).click();
  hr.once("dialog", (d) => d.accept());
  await hr.getByRole("button", { name: "Start offboarding for 2 people" }).click();
  await expect(hr.getByText("2 of 2 started.")).toBeVisible(slow);
});
