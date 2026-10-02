import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied.
// HR registers an item and hands it to a person; the person sees it under "My assets"; HR opens the analytics dashboard.

test("HR registers and assigns an item, the person sees it, and the analytics dashboard loads", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const tag = `E2E-${String(stamp).slice(-8)}`;
  const person = await createEmployeeAccount("Ari", `Assets${stamp}`);

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  await hr.goto("/assets");
  await waitForHydration(hr, "#asset-tag");
  await hr.getByLabel("Asset tag").fill(tag);
  await hr.getByLabel("Name", { exact: true }).fill(`E2E laptop ${stamp}`);
  await hr.getByRole("button", { name: "Register item" }).click();
  await hr.waitForURL(new RegExp(`/assets/${tag}$`, "i"), slow);

  await waitForHydration(hr, "#assign-person");
  const value = await hr.locator("#assign-person option", { hasText: `Assets${stamp}` }).getAttribute("value");
  await hr.getByLabel("Person").selectOption(value!);
  await hr.getByRole("button", { name: /^Hand over/ }).click();
  await expect(hr.getByText(/Assigned/i).first()).toBeVisible(slow);

  const personPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(personPage, person);
  await personPage.goto("/assets");
  await expect(personPage.getByRole("link", { name: new RegExp(tag, "i") }).first()).toBeVisible(slow);

  await hr.goto("/analytics");
  await expect(hr.getByRole("heading", { name: "Analytics" })).toBeVisible(slow);
  await expect(hr.getByText(/Numbers as of|No numbers yet/)).toBeVisible(slow);
  await expect(hr.getByRole("button", { name: "Show" })).toBeVisible();
});
