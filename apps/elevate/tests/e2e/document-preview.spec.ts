import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";
import { makeDocxFromBodyXml } from "../helpers/resume-files";

// Needs the local Supabase with migrations applied and the buckets created (pnpm storage:setup). Uses the REAL storage service.
// Word documents (and PDFs and pictures) are read inside the page: no download needed.

const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const heading = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

test("HR reads a Word document on a person's Documents tab and a Word resume on the applicant page, without downloading", async ({ page }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  await signInEnrollingMfa(page, await createHrAccount());

  // A person with a Word document in their Documents
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Dana");
  await page.getByLabel("Legal last name").fill(`Preview${stamp}`);
  await page.getByLabel("Work email").fill(`dana.preview.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Documents" }).click();
  await waitForHydration(page, "#up-file");
  await page.getByLabel("Document type").selectOption({ label: "Contract" });
  await page.getByLabel("Title").fill("Service agreement");
  await page.locator("#up-file").setInputFiles({ name: "agreement.docx", mimeType: docxMime, buffer: Buffer.from(makeDocxFromBodyXml(heading("Contractor agreement") + para("Payment is monthly.") + para('<script>alert("x")</script>'))) });
  await page.getByLabel("This file contains no client or patient information.").check();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByText("Document saved.")).toBeVisible(slow);

  const row = page.getByRole("row", { name: /Service agreement/ });
  await row.getByRole("button", { name: "View Service agreement" }).click();
  const frame = page.frameLocator('iframe[title="Service agreement"]');
  await expect(frame.getByRole("heading", { name: "Contractor agreement" })).toBeVisible(slow);
  await expect(frame.getByText("Payment is monthly.")).toBeVisible();
  await expect(frame.getByText('<script>alert("x")</script>')).toBeVisible(); // typed markup is shown as text, never run
  await page.getByRole("dialog", { name: "Service agreement" }).getByRole("button", { name: "Close" }).click();
  await expect(page.locator('iframe[title="Service agreement"]')).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Download Service agreement" })).toBeVisible(); // the download is still there

  // A job, and an applicant whose resume is a Word file
  await page.goto("/recruiting/new");
  await waitForHydration(page, "#op-title");
  await page.getByLabel("Job title").fill(`E2E Preview ${stamp}`);
  await page.getByLabel(/^Description/).fill("Support our clients with scheduling, inbox care and light data entry.");
  await page.getByRole("button", { name: "Create job (draft)" }).click();
  await page.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const openingId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Publish job" }).click();
  await expect(page.getByText("Open", { exact: true }).first()).toBeVisible(slow);
  const name = `Wes Word${stamp}`;
  const res = await page.request.post("/api/careers/apply", {
    multipart: {
      openingId,
      fullName: name,
      email: `wes.word${stamp}@example.com`,
      consent: "on",
      website: "",
      resume: { name: "cv.docx", mimeType: docxMime, buffer: Buffer.from(makeDocxFromBodyXml(heading("Wes Word") + para("Virtual assistant for medical billing."))) },
    },
  });
  expect(res.ok()).toBe(true);

  await page.goto(`/recruiting/applicants?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForURL(/\/recruiting\/applications\//, slow);
  await page.getByRole("button", { name: "View resume" }).click();
  const resume = page.frameLocator('iframe[title="Resume"]');
  await expect(resume.getByText("Virtual assistant for medical billing.")).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "Download resume" })).toBeVisible();
});
