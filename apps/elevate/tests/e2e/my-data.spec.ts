import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. An employee opens My data, downloads it as JSON and PDF,
// and asks HR to correct something; HR sees the request.
test("an employee sees and downloads their data and sends a data rights request to HR", async ({ browser }) => {
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Dina", `Data${stamp}`);
  const hr = await createHrAccount();

  const empPage = await (await browser.newContext()).newPage();
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(empPage, employee);
  await signInEnrollingMfa(hrPage, hr);

  await empPage.goto("/my-data");
  await expect(empPage.getByRole("heading", { level: 1, name: "My data" })).toBeVisible();
  const profile = empPage.getByRole("region", { name: "Profile" });
  await expect(profile.getByText(`Dina Data${stamp}`)).toBeVisible();
  await expect(empPage.getByRole("region", { name: "Government IDs, bank and pay" }).getByText("Not on file").first()).toBeVisible();

  // JSON download
  const [jsonDownload] = await Promise.all([empPage.waitForEvent("download"), empPage.getByRole("button", { name: "Download JSON" }).click()]);
  expect(jsonDownload.suggestedFilename()).toMatch(/^my-elevate-data-\d{4}-\d{2}-\d{2}\.json$/);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path Playwright gives for its own download
  const json = JSON.parse(fs.readFileSync((await jsonDownload.path())!, "utf8"));
  expect(json.profile.legalLastName).toBe(`Data${stamp}`);
  expect(json.account.email).toBe(employee.email);

  // PDF download
  const [pdfDownload] = await Promise.all([empPage.waitForEvent("download"), empPage.getByRole("button", { name: "Download PDF" }).click()]);
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path Playwright gives for its own download
  expect(fs.readFileSync((await pdfDownload.path())!).subarray(0, 5).toString()).toBe("%PDF-");

  // Ask HR to correct something
  await empPage.getByLabel("Tell HR what to do").fill("Please correct the spelling of my last name.");
  await empPage.getByRole("button", { name: "Send request" }).click();
  await expect(empPage.getByText("Your request was sent to HR.")).toBeVisible();
  await expect(empPage.getByText("You have a request waiting for HR.")).toBeVisible();

  // HR sees it in the change request queue with the details
  await hrPage.goto("/people/requests");
  const card = hrPage.getByRole("listitem").filter({ hasText: `Data${stamp}` });
  await expect(card.getByText("Data rights request")).toBeVisible();
  await expect(card.getByText("Please correct the spelling of my last name.")).toBeVisible();
});
