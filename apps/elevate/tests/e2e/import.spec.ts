import { expect, test } from "@playwright/test";
import { fakeCompany, toCsv } from "../fixtures/talenthr-export";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. Uses an invented TalentHR-style file; a real export is never used in tests.
// HR uploads, reads the default column choices, previews, commits, and opens the reconciliation. An ordinary employee cannot open it.

test("HR imports a TalentHR export: upload, preview, commit, reconcile", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 45_000 };
  const tag = `e2eimp${Date.now().toString(36)}`;
  const csv = toCsv(fakeCompany(tag));

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/settings/import");
  await expect(hr.getByRole("heading", { name: "Import from TalentHR" })).toBeVisible(slow);

  await hr.locator("#import-file").setInputFiles({ name: "talenthr-export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await hr.getByRole("button", { name: "Read the file" }).click();
  await expect(hr.getByText(/5 rows, 45 columns/)).toBeVisible(slow);
  // The sensitive free-text column is not imported unless HR chooses so
  await expect(hr.getByLabel("custom_fields:Compensation and Benefits")).toHaveValue("ignore");
  await hr.getByRole("button", { name: "Check the file" }).click();

  await hr.waitForURL(/\/settings\/import\/[0-9a-f-]{36}$/, slow);
  await expect(hr.getByText("Nothing has been created yet.")).toBeVisible(slow);
  await expect(hr.getByText(`${tag}.person3@example.com`)).toBeVisible();

  await hr.getByRole("button", { name: "Commit this import" }).click();
  await hr.getByRole("button", { name: "Yes, commit now" }).click();
  await expect(hr.getByText(/Committed: 5 created/)).toBeVisible(slow);
  await expect(hr.getByText("All counts match")).toBeVisible(slow);

  const pdf = await hr.request.get(hr.url().replace("/settings/import/", "/api/imports/") + "/reconciliation");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  // The people are in the directory
  await hr.goto(`/people?q=${tag}`);
  await expect(hr.getByText(`Test3 Person3`).first()).toBeVisible(slow);

  // An ordinary employee cannot open the import
  const employee = await createEmployeeAccount("Emi", `NoImport${Date.now()}`);
  const other = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(other, employee);
  const response = await other.goto("/settings/import");
  expect(response?.status()).toBe(404);
});
