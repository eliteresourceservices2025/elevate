import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. HR opens the go-live checklist and ticks a manual step.

test("HR sees the go-live checklist and ticks a step", async ({ browser }) => {
  test.setTimeout(120_000);
  const slow = { timeout: 30_000 };
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/settings/go-live");
  await expect(hr.getByRole("heading", { name: "Go-live checklist" })).toBeVisible(slow);
  await expect(hr.getByText("Production settings are in place")).toBeVisible();
  const row = hr.locator("li", { hasText: "Domain and DNS" });
  await row.getByRole("button", { name: /Mark done|Undo/ }).click();
  await expect(hr.getByText(/Marked as (not )?done\./)).toBeVisible(slow);
  await hr.reload();
  await expect(hr.locator("li", { hasText: "Domain and DNS" }).getByText(/^(Done|To do)$/)).toBeVisible(slow);
});
