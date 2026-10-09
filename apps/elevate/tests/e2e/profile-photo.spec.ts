import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// A person adds a profile photo from the account menu: the badge then shows it, the server serves a cleaned JPEG, My profile shows it,
// and removing it brings the initials back.

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A plain 160 x 120 purple PNG (not square, so the crop has something to do). */
function png(): Buffer {
  const w = 160;
  const h = 120;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0x6c, 0x1a, 0xba]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("a person adds and removes a profile photo", async ({ browser }) => {
  test.setTimeout(150_000);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Photo", "Tester"));
  await page.goto("/dashboard");
  await waitForHydration(page, '[data-tour="account"]');

  const badge = page.getByRole("button", { name: /Account menu for/ });
  await expect(badge.locator("img")).toHaveCount(0);
  await expect(badge).toHaveText("PT");

  // Choose a picture and save it.
  await badge.click();
  await page.getByRole("menuitem", { name: "Add a photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Profile photo" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save photo" })).toBeDisabled();
  await dialog.getByLabel("Choose a picture").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png() });
  await expect(dialog.getByLabel("Zoom")).toBeVisible();
  await dialog.getByRole("button", { name: "Save photo" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 45_000 }); // the first save compiles the route in dev

  // The badge shows the picture, and the server serves a cleaned JPEG for it.
  const image = badge.locator("img");
  await expect(image).toHaveAttribute("src", /^\/api\/profile-photo\/[0-9a-f-]{36}\?v=\d+$/);
  const src = (await image.getAttribute("src"))!;
  const served = await page.request.get(src);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await served.body();
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(bytes.length).toBeLessThan(60_000);
  // Nobody can fetch it without signing in.
  const anonymous = await (await browser.newContext()).request.get(new URL(src, page.url()).toString(), { maxRedirects: 0 });
  expect([307, 308, 401, 403, 404]).toContain(anonymous.status());

  // My profile shows it too, with the button to change it.
  await page.goto("/people/me");
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();
  await expect(page.locator("main img[src^='/api/profile-photo/']")).toHaveCount(1);

  // Removing it brings the initials back.
  await page.goto("/dashboard");
  await waitForHydration(page, '[data-tour="account"]');
  await badge.click();
  await page.getByRole("menuitem", { name: "Change photo" }).click();
  await page.getByRole("dialog", { name: "Profile photo" }).getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("dialog", { name: "Profile photo" })).toHaveCount(0);
  await expect(badge.locator("img")).toHaveCount(0);
  await expect(badge).toHaveText("PT");
});

test("a file that is not a picture is refused with a plain message", async ({ browser }) => {
  test.setTimeout(120_000);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await signInEnrollingMfa(page, await createHrAccount());
  await page.goto("/dashboard");
  await waitForHydration(page, '[data-tour="account"]');
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Add a photo" }).click();
  const dialog = page.getByRole("dialog", { name: "Profile photo" });
  await dialog.getByLabel("Choose a picture").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 hello") });
  await expect(dialog.getByRole("alert")).toContainText("Choose a JPG, PNG or WEBP picture.");
  await expect(dialog.getByRole("button", { name: "Save photo" })).toBeDisabled();
});
