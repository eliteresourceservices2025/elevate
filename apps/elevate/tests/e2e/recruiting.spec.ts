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
  await anon.waitForURL(/\/careers\/[0-9a-f-]{36}$/, slow);
  await expect(anon.getByText("Clear written English")).toBeVisible();
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
