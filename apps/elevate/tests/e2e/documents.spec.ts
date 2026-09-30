import fs from "node:fs";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied and the buckets created (pnpm storage:setup).
// Uses the REAL storage service: the file goes browser -> private bucket -> checked by the server -> signed download.
test("HR uploads a document, downloads it, and a disguised file is refused", async ({ page }) => {
  const account = await createHrAccount();
  await signInEnrollingMfa(page, account);

  // A person to attach documents to
  const stamp = Date.now();
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Dana");
  await page.getByLabel("Legal last name").fill(`Docs${stamp}`);
  await page.getByLabel("Work email").fill(`dana.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);

  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Documents" }).click();
  await expect(page.getByText("Do not upload client records or patient information.")).toBeVisible();

  const pdf = Buffer.from("%PDF-1.4\n%fake e2e document\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
  const fill = async (title: string, file: { name: string; mimeType: string; buffer: Buffer }) => {
    await page.getByLabel("Document type").selectOption({ label: "Contract" });
    await page.getByLabel("Title").fill(title);
    await page.locator("#up-file").setInputFiles(file);
    await page.getByLabel("This file contains no client or patient information.").check();
    await page.getByRole("button", { name: "Upload" }).click();
  };

  // A real PDF is accepted, saved as verified (HR uploaded it), and downloads byte for byte
  await fill("Signed contract", { name: "../contract.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByText("Document saved.")).toBeVisible();
  const row = page.getByRole("row", { name: /Signed contract/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Verified")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "Download Signed contract" }).click()]);
  expect(download.suggestedFilename()).toBe("contract.pdf"); // the path was stripped
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path Playwright gives for its own download
  const saved = fs.readFileSync((await download.path())!);
  expect(saved.equals(pdf)).toBe(true);

  // A program disguised as a PDF is refused by the server and leaves nothing behind
  await fill("Sneaky", { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]) });
  await expect(page.getByText("not a PDF, JPG, PNG or DOCX")).toBeVisible();
  await expect(page.getByRole("row", { name: /Sneaky/ })).toHaveCount(0);

  // The bucket itself is private: the stored object cannot be fetched without a signed link
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [d] = await sql<{ storage_bucket: string; storage_path: string }[]>`select storage_bucket, storage_path from docs.documents where title = 'Signed contract' order by created_at desc limit 1`;
    const direct = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${d.storage_bucket}/${d.storage_path}`);
    expect(direct.ok).toBe(false);
    const anon = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${d.storage_bucket}/${d.storage_path}`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    });
    expect(anon.ok).toBe(false);
  } finally {
    await sql.end();
  }

  // The notification bell shows and clears a notification
  const sql2 = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql2`insert into ops.notifications (user_id, kind, title, link)
               select id, 'test', 'Bell works', '/documents' from core.users where lower(email) = ${account.email.toLowerCase()}`;
  } finally {
    await sql2.end();
  }
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  await page.getByRole("button", { name: /Bell works/ }).click();
  await page.waitForURL("**/documents");
  await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible(); // no unread count any more
});
