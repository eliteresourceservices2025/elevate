import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied (0090 adds the Unsorted types) and the buckets created (pnpm storage:setup).

const PDF = (label: string) => Buffer.from(`%PDF-1.4\n%${label}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`);

test("HR uploads several files at once, they land as Unsorted, and each is categorized afterwards", async ({ page }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  await signInEnrollingMfa(page, await createHrAccount());

  const stamp = Date.now();
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Bulk");
  await page.getByLabel("Legal last name").fill(`Files${stamp}`);
  await page.getByLabel("Work email").fill(`bulk.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Documents" }).click();
  await waitForHydration(page, "#up-file");

  // Files chosen together; one is not allowed and says why without stopping the others
  await page.getByLabel("Choose files to upload").setInputFiles([
    { name: "nbi_scan.pdf", mimeType: "application/pdf", buffer: PDF("one") },
    { name: "id_front.pdf", mimeType: "application/pdf", buffer: PDF("two") },
    { name: "macro.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") },
  ]);
  await expect(page.getByText("Only PDF", { exact: false }).first()).toBeVisible(slow);
  await page.getByLabel("These files contain no client or patient information.").check();
  await page.getByRole("button", { name: "Upload 2 files" }).click();
  await expect(page.getByText("2 saved.")).toBeVisible(slow);

  // Both are in the list as Unsorted, with the file name as the starting title
  const row = page.getByRole("row", { name: /nbi scan/ });
  await expect(row.getByText("Unsorted")).toBeVisible(slow);
  await expect(page.getByRole("row", { name: /id front/ }).getByText("Unsorted")).toBeVisible();

  // Categorize one: a type that needs an expiry date asks for it
  await row.getByRole("button", { name: "Set type" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Document type").selectOption({ label: "NBI clearance" });
  await dialog.getByLabel("Title").fill("NBI clearance 2026");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Enter the expiry date for this type of document.")).toBeVisible(slow);
  const future = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  await dialog.getByLabel("Expiry date").fill(future);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Type saved.")).toBeVisible(slow);
  await expect(page.getByRole("row", { name: /NBI clearance 2026/ }).getByText("NBI clearance").first()).toBeVisible(slow);
});

test("HR deletes a job ad that nobody applied to", async ({ page }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  await signInEnrollingMfa(page, await createHrAccount());
  const title = `E2E Delete VA ${Date.now()}`;

  await page.goto("/recruiting/new");
  await waitForHydration(page, "#op-title");
  await page.getByLabel("Job title").fill(title);
  await page.getByLabel(/^Description/).fill("Support our clients with scheduling and inbox care. This is a throwaway job for a test.");
  await page.getByRole("button", { name: "Create job (draft)" }).click();
  await page.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete job" }).click();
  await expect(page.getByText("Job deleted.")).toBeVisible(slow);
  await page.waitForURL("**/recruiting", slow);
  await expect(page.getByText(title)).toHaveCount(0);
});
