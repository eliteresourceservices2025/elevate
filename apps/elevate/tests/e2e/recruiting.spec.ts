import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and the recruiting-docs bucket (pnpm storage:setup).
// Creates a throwaway job and applicant in the local database.

const PDF = Buffer.from("%PDF-1.4\n% e2e resume\n1 0 obj\n<<>>\nendobj\n");

test("HR publishes a job, an applicant applies on the public page, HR moves them through the pipeline and closes it", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const title = `E2E Virtual Assistant ${stamp}`;

  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.getByRole("link", { name: "Recruiting", exact: true }).click();
  await hrPage.waitForURL("**/recruiting", slow);
  await expect(hrPage.getByRole("link", { name: "Recruiting", exact: true })).toHaveAttribute("aria-current", "page");

  await hrPage.getByRole("link", { name: "New job" }).click();
  await hrPage.waitForURL("**/recruiting/new", slow);
  await waitForHydration(hrPage, "#op-title");
  await hrPage.getByLabel("Job title").fill(title);
  await hrPage.getByLabel(/^Description/).fill("Support our clients with scheduling, inbox care and light data entry.\n\n- Reliable internet\n- Clear written English");
  await hrPage.getByRole("button", { name: "Create job (draft)" }).click();
  await hrPage.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const boardUrl = hrPage.url();
  await expect(hrPage.getByRole("heading", { name: title })).toBeVisible(slow);

  // A draft is not public
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/careers");
  await expect(anon.getByRole("link", { name: title })).toHaveCount(0);

  await hrPage.getByRole("button", { name: "Publish job" }).click();
  await expect(hrPage.getByText("Open", { exact: true }).first()).toBeVisible(slow);

  // The applicant, not signed in
  await anon.goto("/careers");
  await anon.getByRole("link", { name: title }).click();
  // A readable address made from the title, and the old id link goes to it
  await anon.waitForURL(/\/careers\/e2e-virtual-assistant-\d+$/, slow);
  const readable = anon.url();
  const openingId = boardUrl.split("/").pop()!;
  await anon.goto(`/careers/${openingId}`);
  await anon.waitForURL(readable, slow);
  await expect(anon.getByText("Clear written English")).toBeVisible();
  // The privacy notice in the consent line is a real link that opens in a new tab
  const privacy = anon.getByRole("link", { name: "privacy notice", exact: false }).filter({ hasText: "privacy notice" }).last();
  await expect(privacy).toHaveAttribute("href", "/privacy");
  await expect(privacy).toHaveAttribute("target", "_blank");
  await expect(privacy).toHaveAttribute("rel", /noopener/);
  await waitForHydration(anon, "#ap-name");
  await anon.getByLabel("Full name").fill(`Pia Applicant${stamp}`);
  await anon.getByLabel("Email", { exact: true }).fill(`pia.${stamp}@example.com`);
  await anon.locator("#ap-resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF });
  // Consent is required
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText("Please accept the privacy notice to apply")).toBeVisible(slow);
  await anon.getByLabel(/I have read the privacy notice/).check();
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText("Thank you, we received your application.")).toBeVisible(slow);

  // HR sees them on the board and moves them
  await hrPage.goto(boardUrl);
  const card = hrPage.locator("section[data-stage='applied']").getByRole("link", { name: `Pia Applicant${stamp}` });
  await expect(card).toBeVisible(slow);
  await waitForHydration(hrPage, "select");
  await hrPage.getByLabel(`Move Pia Applicant${stamp} to`).selectOption("screening");
  await expect(hrPage.locator("section[data-stage='screening']").getByRole("link", { name: `Pia Applicant${stamp}` })).toBeVisible(slow);

  await hrPage.locator("section[data-stage='screening']").getByRole("link", { name: `Pia Applicant${stamp}` }).click();
  await hrPage.waitForURL(/\/recruiting\/applications\//, slow);
  await expect(hrPage.getByRole("heading", { name: `Pia Applicant${stamp}` })).toBeVisible(slow);
  await expect(hrPage.getByRole("link", { name: "Recruiting", exact: true })).toHaveAttribute("aria-current", "page");
  // The resume is viewed inside the page (PDF), with a separate download button
  await expect(hrPage.getByRole("button", { name: "Download resume" })).toBeVisible();
  await hrPage.getByRole("button", { name: "View resume" }).click();
  const frame = hrPage.locator("iframe[title='Resume']");
  await expect(frame).toBeVisible();
  const src = (await frame.getAttribute("src"))!;
  const resumeResponse = await hrPage.request.get(src);
  expect(resumeResponse.status()).toBe(200);
  expect(resumeResponse.headers()["content-type"]).toContain("application/pdf");
  expect(resumeResponse.headers()["content-disposition"]).toContain("inline");
  await hrPage.getByLabel("Add a note").fill("Good phone manner.");
  await hrPage.getByRole("button", { name: "Add note" }).click();
  await expect(hrPage.getByText("Good phone manner.")).toBeVisible(slow);

  hrPage.on("dialog", (d) => void d.accept());
  await hrPage.getByText("Close this application").click();
  await hrPage.getByLabel("Reason (internal only)").fill("Position filled");
  await hrPage.getByRole("button", { name: "Close application" }).click();
  await expect(hrPage.getByText("Rejected", { exact: true }).first()).toBeVisible(slow);
  await expect(hrPage.getByRole("listitem").filter({ hasText: "Position filled" }).or(hrPage.getByText(/Reason: Position filled/))).toBeVisible(slow);
});

test("an employee has no Recruiting menu item and cannot open it; the public pages stay open", async ({ browser, page }) => {
  const slow = { timeout: 30_000 };
  await signInEnrollingMfa(page, await createEmployeeAccount("Ria", `Rec${Date.now()}`));
  await expect(page.getByRole("link", { name: "Recruiting", exact: true })).toHaveCount(0);
  await page.goto("/recruiting");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible(slow);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/careers");
  await expect(anon.getByRole("heading", { name: "Careers at Elite Resource Services" })).toBeVisible(slow);
});

test("a card can be dragged to another stage with the keyboard", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.goto("/recruiting/new");
  await waitForHydration(hrPage, "#op-title");
  await hrPage.getByLabel("Job title").fill(`E2E Drag ${stamp}`);
  await hrPage.getByLabel(/^Description/).fill("A job used to check dragging a card between stages.");
  await hrPage.getByRole("button", { name: "Create job (draft)" }).click();
  await hrPage.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const boardUrl = hrPage.url();
  await hrPage.getByRole("button", { name: "Publish job" }).click();
  await expect(hrPage.getByText("Open", { exact: true }).first()).toBeVisible(slow);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto(boardUrl.replace(/.*\/recruiting\//, "/careers/"));
  await waitForHydration(anon, "#ap-name");
  await anon.getByLabel("Full name").fill(`Dan Dragger${stamp}`);
  await anon.getByLabel("Email", { exact: true }).fill(`dan.${stamp}@example.com`);
  await anon.locator("#ap-resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF });
  await anon.getByLabel(/I have read the privacy notice/).check();
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText("Thank you, we received your application.")).toBeVisible(slow);

  await hrPage.goto(boardUrl);
  await waitForHydration(hrPage, "select");
  const handle = hrPage.getByRole("button", { name: `Drag Dan Dragger${stamp} to another stage. Press space, then the arrow keys, then space again.` });
  await handle.focus();
  // dnd-kit needs a moment between picking up, moving and dropping
  await hrPage.keyboard.press("Space");
  await hrPage.waitForTimeout(400);
  await hrPage.keyboard.press("ArrowRight");
  await hrPage.waitForTimeout(400);
  await hrPage.keyboard.press("Space");
  await expect(hrPage.locator("section[data-stage='screening']").getByRole("link", { name: `Dan Dragger${stamp}` })).toBeVisible(slow);
});

test("the Google Calendar card is for HR and recruiters only; connecting is refused for everyone else", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.goto("/recruiting");
  const card = hrPage.getByRole("region", { name: "Google Calendar" });
  await expect(card).toBeVisible(slow);
  // Either the server has Google credentials (a Connect button) or it says it is not set up: never a broken state
  await expect(card.getByText(/Connect Google Calendar|Not set up on this server yet/).first()).toBeVisible();
  // Starting a connection redirects (to Google, or back with a status when there are no credentials)
  const start = await hrPage.request.get("/api/google/connect", { maxRedirects: 0 });
  expect(start.status()).toBe(307);
  // The callback refuses a missing or wrong state
  const bad = await hrPage.request.get("/api/google/callback?code=x&state=wrong", { maxRedirects: 0 });
  expect(bad.status()).toBe(307);
  expect(bad.headers()["location"]).toContain("calendar=failed");

  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(empPage, await createEmployeeAccount("Eli", `Cal${Date.now()}`));
  expect((await empPage.request.get("/api/google/connect", { maxRedirects: 0 })).status()).toBe(404);
});

function wideBanner(): Buffer {
  // A plain 1000 x 300 PNG: wide enough for the banner, made by the browser into the final JPEG
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const w = 1000;
  const h = 300;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [0xe2, 0xbe, 0x2b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("HR edits the careers page wording and banner, and the public page shows them", async ({ browser }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 45_000 };
  const stamp = Date.now();
  const hrPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.goto("/recruiting");
  // The public page link opens in a new tab
  const publicLink = hrPage.getByRole("link", { name: /View careers page/ });
  await expect(publicLink).toHaveAttribute("target", "_blank");
  await hrPage.getByRole("link", { name: "Edit careers page" }).click();
  await hrPage.waitForURL("**/recruiting/careers-page", slow);
  await waitForHydration(hrPage, "#cp-title");

  await hrPage.getByLabel("Page title").fill(`Join the team ${stamp}`);
  await hrPage.getByLabel("Introduction").fill("We are **growing** and looking for reliable assistants.");
  await hrPage.getByRole("button", { name: "Save wording" }).click();
  await expect(hrPage.getByText("Careers page saved.")).toBeVisible(slow);

  await hrPage.getByLabel("Choose a banner picture").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: wideBanner() });
  await hrPage.getByRole("button", { name: "Save banner" }).click();
  await expect(hrPage.getByText("Banner saved.")).toBeVisible(slow);
  await expect(hrPage.getByAltText("The current careers page banner")).toBeVisible(slow);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/careers");
  await expect(anon.getByRole("heading", { name: `Join the team ${stamp}` })).toBeVisible(slow);
  await expect(anon.getByText("growing", { exact: false })).toBeVisible();
  // Questions about applying go to the recruiting address, never the technical support one
  await expect(anon.getByRole("link", { name: "elitetsp@ersva.com" })).toBeVisible();
  await expect(anon.getByText("eliteresourceservices2025@gmail.com")).toHaveCount(0);
  const served = await anon.request.get("/api/careers/banner");
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  expect([...(await served.body()).subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  // Put the page back to the built-in wording for the next run
  await hrPage.getByLabel("Page title").fill("");
  await hrPage.getByLabel("Introduction").fill("");
  await hrPage.getByRole("button", { name: "Save wording" }).click();
  await expect(hrPage.getByText("Careers page saved.")).toBeVisible(slow);
  await hrPage.getByRole("button", { name: "Remove banner" }).click();
  await expect(hrPage.getByText("Banner removed.")).toBeVisible(slow);
});
