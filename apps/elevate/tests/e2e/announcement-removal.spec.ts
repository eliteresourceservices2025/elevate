import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa, waitForHydration } from "./helpers";

// HR deletes an announcement nobody acknowledged (the button is gone once someone has), and archives a published policy.

test("HR deletes an unacknowledged announcement and archives a published policy", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const reader = await createEmployeeAccount("Del", `Reader${stamp}`);
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  // An announcement with nobody having acknowledged it: Delete is offered and works
  const title = `Posted by mistake ${stamp}`;
  await hr.goto("/announcements/new");
  await waitForHydration(hr, "#an-title");
  await hr.getByLabel("Title").fill(title);
  await hr.getByLabel("Message").fill("Oops.");
  await hr.getByLabel("Require acknowledgment").check();
  await hr.getByRole("button", { name: "Post announcement" }).click();
  await hr.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  const url = hr.url();
  await expect(hr.getByRole("button", { name: "Delete", exact: true })).toBeVisible();

  // Once the reader acknowledges it, Delete is no longer offered (archive only)
  const rp = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(rp, reader);
  await rp.goto(url);
  await (await hydrated(rp.getByRole("button", { name: "I have read and understand" }))).click();
  await expect(rp.getByText("Your acknowledgment is recorded.")).toBeVisible(slow);
  await hr.reload();
  await expect(hr.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await expect(hr.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);

  // A second one nobody acknowledged: delete it
  const second = `Also a mistake ${stamp}`;
  await hr.goto("/announcements/new");
  await waitForHydration(hr, "#an-title");
  await hr.getByLabel("Title").fill(second);
  await hr.getByLabel("Message").fill("Oops again.");
  await hr.getByRole("button", { name: "Post announcement" }).click();
  await hr.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  hr.once("dialog", (d) => void d.accept());
  await (await hydrated(hr.getByRole("button", { name: "Delete", exact: true }))).click();
  await hr.waitForURL(/\/announcements$/, slow);
  await expect(hr.getByText("Announcement deleted.")).toBeVisible();
  await expect(hr.getByRole("link", { name: new RegExp(second) })).toHaveCount(0);

  // A published policy can be archived
  const policy = `Retired policy ${stamp}`;
  await hr.goto("/announcements?tab=policies");
  await (await hydrated(hr.getByRole("button", { name: "Add a policy" }))).click();
  await hr.getByLabel("Policy title").fill(policy);
  await hr.getByLabel("Text", { exact: true }).fill("Old rules.");
  await hr.getByRole("button", { name: "Create draft" }).click();
  await hr.waitForURL(/\/announcements\/policies\/[0-9a-f-]{36}$/);
  hr.once("dialog", (d) => void d.accept());
  await (await hydrated(hr.getByRole("button", { name: "Publish version 1" }))).click();
  await expect(hr.getByRole("button", { name: "Archive policy" })).toBeVisible(slow);
  hr.once("dialog", (d) => void d.accept());
  await (await hydrated(hr.getByRole("button", { name: "Archive policy" }))).click();
  await hr.waitForURL(/tab=policies/, slow);
  await expect(hr.getByText("Policy archived.")).toBeVisible();
  await expect(hr.getByRole("link", { name: new RegExp(policy) })).toHaveCount(0);
});
