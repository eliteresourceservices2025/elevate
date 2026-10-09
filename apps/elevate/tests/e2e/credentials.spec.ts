import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. HR records a certificate, the person sees it, and the menu follows the roles.

test("HR adds a certificate, the person sees it, and a plain employee cannot manage them", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);
  const employee = await createEmployeeAccount("Cert", `Holder${stamp}`);
  const hrPage = await (await browser.newContext()).newPage();
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await signInEnrollingMfa(empPage, employee);

  const name = `HIPAA E2E ${stamp}`;
  const ends = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  await hrPage.goto("/credentials");
  await waitForHydration(hrPage, "#cred-person");
  await hrPage.getByLabel("Person").fill(`Holder${stamp}, Cert`);
  await hrPage.getByLabel("Certificate", { exact: true }).fill(name);
  await hrPage.getByLabel("Ends on").fill(ends);
  await hrPage.getByRole("button", { name: "Add certificate" }).click();
  await expect(hrPage.getByText("Certificate recorded.")).toBeVisible();
  const row = hrPage.getByRole("row").filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText("Expiring soon")).toBeVisible();

  await empPage.goto("/credentials");
  await expect(empPage.getByRole("row").filter({ hasText: name }).getByText("Expiring soon")).toBeVisible();
  await expect(empPage.getByRole("button", { name: "Add certificate" })).toHaveCount(0);
  await expect(empPage.getByRole("heading", { name: "Load from TalentHR" })).toHaveCount(0);

  // Remove it again so the shared local database stays tidy
  hrPage.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: /Remove/ }).click();
  await expect(hrPage.getByText("Certificate removed.")).toBeVisible();
  await expect(hrPage.getByRole("row").filter({ hasText: name })).toHaveCount(0);
});
