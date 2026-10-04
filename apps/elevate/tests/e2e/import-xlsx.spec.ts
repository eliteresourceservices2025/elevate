import writeXlsxFile from "write-excel-file/node";
import { expect, test } from "@playwright/test";
import { fakeCompany, TALENTHR_HEADERS } from "../fixtures/talenthr-export";
import { createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. The same invented export as the CSV test, uploaded as an Excel file.

test("HR uploads the export as an Excel file and sees the same preview", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 45_000 };
  const tag = `e2exl${Date.now().toString(36)}`;
  const people = fakeCompany(tag);
  const data = [TALENTHR_HEADERS.map((h) => ({ value: h, type: String })), ...people.map((p) => TALENTHR_HEADERS.map((h) => ({ value: p[h] ?? null, type: String })))];
  const bytes = await writeXlsxFile(data as never).toBuffer();

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/settings/import");
  await hr.locator("#import-file").setInputFiles({ name: "talenthr-export.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(bytes) });
  await hr.getByRole("button", { name: "Read the file" }).click();
  await expect(hr.getByText(/5 rows, 45 columns/)).toBeVisible(slow);
  await hr.getByRole("button", { name: "Check the file" }).click();
  await hr.waitForURL(/\/settings\/import\/[0-9a-f-]{36}$/, slow);
  await expect(hr.getByText("Nothing has been created yet.")).toBeVisible(slow);
  await expect(hr.getByText(`${tag}.person3@example.com`)).toBeVisible();
  await hr.getByRole("button", { name: "Discard" }).click();
  await expect(hr.getByText(/Discarded/)).toBeVisible(slow);
});
