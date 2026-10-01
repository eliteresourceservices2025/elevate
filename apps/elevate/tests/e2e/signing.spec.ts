import { PDFDocument } from "pdf-lib";
import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and the signed-docs bucket (pnpm storage:setup).
// Two signers (one types, one draws), HR sends, the document is sealed, and the signed copy verifies on the public page.

async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText("E2E agreement", { x: 60, y: 700 });
  return Buffer.from(await doc.save());
}

/** Clicks an "open" button and returns the bytes of the file it would have opened (window.open is captured, not followed). */
async function openedFile(page: Page, buttonName: string | RegExp): Promise<Buffer> {
  await page.evaluate(() => {
    (window as unknown as { __opened: string | null }).__opened = null;
    window.open = (url) => {
      (window as unknown as { __opened: string | null }).__opened = String(url);
      return null;
    };
  });
  await page.getByRole("button", { name: buttonName }).click();
  await page.waitForFunction(() => (window as unknown as { __opened: string | null }).__opened !== null, undefined, { timeout: 30_000 });
  const url = await page.evaluate(() => (window as unknown as { __opened: string }).__opened);
  const response = await page.request.get(url);
  expect(response.ok()).toBe(true);
  return Buffer.from(await response.body());
}

/** Opens the viewer inside the page (no download, no new tab) and checks the file it shows is an inline PDF. */
async function readInPage(page: Page, envelopeUrl: string) {
  await page.getByRole("button", { name: "Read the document" }).click();
  const frame = page.locator("iframe[title='The document to sign']");
  await expect(frame).toBeVisible();
  const src = (await frame.getAttribute("src"))!;
  expect(src).toBe(`/api/signing/${envelopeUrl.split("/").pop()}/document`);
  const response = await page.request.get(src);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect(response.headers()["content-disposition"]).toContain("inline");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
}

test("HR sends a document, two people sign it (typed and drawn), it is sealed, and the signed copy verifies on the public page", async ({ browser }) => {
  test.setTimeout(360_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const title = `E2E Agreement ${stamp}`;
  const sia = await createEmployeeAccount("Sia", `Signer${stamp}`);
  const tom = await createEmployeeAccount("Tom", `Second${stamp}`);

  // HR sends it
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.getByRole("link", { name: "Signing", exact: true }).click();
  await hrPage.waitForURL("**/signing", slow);
  await expect(hrPage.getByRole("link", { name: "Signing", exact: true })).toHaveAttribute("aria-current", "page");
  await hrPage.getByRole("link", { name: "Send a document" }).click();
  await hrPage.waitForURL("**/signing/new", slow);
  await waitForHydration(hrPage, "#env-title");
  await hrPage.getByLabel("Document title").fill(title);
  await hrPage.locator("#env-file").setInputFiles({ name: "agreement.pdf", mimeType: "application/pdf", buffer: await pdf() });
  for (const account of [sia, tom]) {
    const select = hrPage.locator("#env-add");
    const value = await select.locator("option", { hasText: account.email }).getAttribute("value");
    await select.selectOption(value!);
    await hrPage.getByRole("button", { name: "Add", exact: true }).click();
  }
  await hrPage.getByRole("button", { name: "Send for signature" }).click();
  await hrPage.waitForURL(/\/signing\/[0-9a-f-]{36}$/, slow);
  const envelopeUrl = hrPage.url();
  await expect(hrPage.getByText("Out for signature").first()).toBeVisible(slow);
  await expect(hrPage.getByText("Chain intact")).toBeVisible();

  // First signer: must open the document before signing; types a signature
  const siaPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(siaPage, sia);
  await siaPage.getByRole("link", { name: "Signing", exact: true }).click();
  await siaPage.waitForURL("**/signing", slow);
  await expect(siaPage.getByText("You have 1 document waiting for your signature.")).toBeVisible(slow);
  await siaPage.getByRole("link", { name: title }).click();
  await siaPage.waitForURL(/\/signing\/[0-9a-f-]{36}$/, slow);
  await waitForHydration(siaPage, "#sig-consent");
  await expect(siaPage.getByRole("button", { name: "Sign document" })).toBeDisabled();
  await readInPage(siaPage, envelopeUrl);
  await expect(siaPage.getByText("You opened it. You can sign now.")).toBeVisible(slow);
  await siaPage.getByLabel(/I agree to sign this document electronically/).check();
  await siaPage.getByRole("button", { name: "Sign document" }).click();
  await expect(siaPage.getByText("You signed this. The others still need to sign.")).toBeVisible(slow);

  // Second signer draws
  const tomPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(tomPage, tom);
  await tomPage.goto(envelopeUrl);
  await waitForHydration(tomPage, "#sig-consent");
  await readInPage(tomPage, envelopeUrl);
  await expect(tomPage.getByText("You opened it. You can sign now.")).toBeVisible(slow);
  await tomPage.getByRole("tab", { name: "Draw it" }).click();
  const pad = tomPage.getByTestId("signature-pad");
  const box = (await pad.boundingBox())!;
  await tomPage.mouse.move(box.x + 30, box.y + 80);
  await tomPage.mouse.down();
  await tomPage.mouse.move(box.x + 120, box.y + 30, { steps: 8 });
  await tomPage.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
  await tomPage.mouse.up();
  await tomPage.getByLabel(/I agree to sign this document electronically/).check();
  await tomPage.getByRole("button", { name: "Sign document" }).click();
  await expect(tomPage.getByText("Everyone has signed").first()).toBeVisible(slow);

  // HR sees it completed, with a sealed copy; the sealed file verifies publicly, a changed file does not
  await hrPage.goto(envelopeUrl);
  await expect(hrPage.getByText("Completed").first()).toBeVisible(slow);
  await expect(hrPage.getByText("Chain intact")).toBeVisible();
  const sealed = await openedFile(hrPage, "Download the signed copy");
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/verify");
  await waitForHydration(anon, "#verify-file");
  await anon.locator("#verify-file").setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: sealed });
  await expect(anon.getByText("This is a genuine, unchanged ELEVATE Sign document.")).toBeVisible(slow);
  const changed = Buffer.from(sealed);
  changed[changed.length - 40] ^= 0xff;
  await anon.locator("#verify-file").setInputFiles({ name: "changed.pdf", mimeType: "application/pdf", buffer: changed });
  await expect(anon.getByText("This file does not match any sealed ELEVATE document.")).toBeVisible(slow);
});

test("signing is for signed-in people; the Verify page is public", async ({ browser, page }) => {
  const slow = { timeout: 30_000 };
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/signing");
  await anon.waitForURL(/\/login/, slow);
  await anon.goto("/verify");
  await expect(anon.getByRole("heading", { name: "Verify a signed document" })).toBeVisible(slow);

  // An employee has the menu item and sees nothing to sign, but no HR tabs or "Send a document"
  await signInEnrollingMfa(page, await createEmployeeAccount("Ula", `Nosign${Date.now()}`));
  await page.getByRole("link", { name: "Signing", exact: true }).click();
  await page.waitForURL("**/signing", slow);
  await expect(page.getByText("Nothing has been sent to you to sign.")).toBeVisible(slow);
  await expect(page.getByRole("link", { name: "Send a document" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Templates" })).toHaveCount(0);
  await page.goto("/signing/new");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible(slow);
});
