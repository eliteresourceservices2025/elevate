import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

// HR completes an onboarding that is stuck on tasks nobody ticked, with a reason.

test("HR completes an onboarding anyway with a reason", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  await createEmployeeAccount("Janus", `Stuck${stamp}`);
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  // Start an onboarding for the person (the single choice opens its case)
  await hr.goto("/onboarding");
  await (await hydrated(hr.getByRole("button", { name: "Start onboarding", exact: true }))).click();
  await hr.getByLabel("Search people").fill(`Stuck${stamp}`);
  await hr.getByRole("checkbox", { name: new RegExp(`Stuck${stamp}`) }).check();
  await hr.getByRole("button", { name: "Start onboarding", exact: true }).last().click();
  await hr.waitForURL(/\/onboarding\/[0-9a-f-]{36}$/, slow);

  // Required tasks are open: the plain button is off, "Complete anyway" asks for a reason
  await expect(hr.getByRole("button", { name: "Complete onboarding" })).toBeDisabled();
  await (await hydrated(hr.getByRole("button", { name: "Complete anyway" }))).click();
  await expect(hr.getByText("Still open (these will be closed as skipped):")).toBeVisible();
  const submit = hr.getByRole("dialog").getByRole("button", { name: "Complete onboarding" });
  await expect(submit).toBeDisabled();
  await hr.getByLabel("Why are you completing it?").fill("She forgot to tick the second task");
  await submit.click();
  await expect(hr.getByText("Onboarding complete. The person is now active.")).toBeVisible(slow);

  // Done: no completion buttons any more, and the open tasks show as skipped
  await expect(hr.getByRole("button", { name: "Complete anyway" })).toHaveCount(0);
  await expect(hr.getByText("Skipped").first()).toBeVisible(slow);
});
