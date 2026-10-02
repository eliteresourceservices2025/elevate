import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and the signed-docs and recruiting-docs buckets (pnpm storage:setup).
// There is no email service locally, so the applicant's link and session are put in place directly in the database; the emailed-code
// step is covered by the integration tests. Everything else is the real browser flow.

const PDF = Buffer.from("%PDF-1.4\n% e2e resume\n1 0 obj\n<<>>\nendobj\n");
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test("HR makes a template and an offer, the applicant signs it without an account, and HR hires them", async ({ browser }) => {
  test.setTimeout(300_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const applicantName = `Ola Applicant${stamp}`;

  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());

  // A template
  await hrPage.goto("/recruiting/offer-templates");
  await waitForHydration(hrPage, "#tp-name");
  await hrPage.getByLabel("Template name").fill(`E2E offer ${stamp}`);
  await hrPage.getByRole("button", { name: "Create template" }).click();
  await expect(hrPage.getByText(`E2E offer ${stamp}`).first()).toBeVisible(slow);

  // A job and an applicant at the Offer stage
  await hrPage.goto("/recruiting/new");
  await waitForHydration(hrPage, "#op-title");
  await hrPage.getByLabel("Job title").fill(`E2E Offer Job ${stamp}`);
  await hrPage.getByLabel(/^Description/).fill("A job used to check making an offer to an applicant.");
  await hrPage.getByRole("button", { name: "Create job (draft)" }).click();
  await hrPage.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const boardUrl = hrPage.url();
  await hrPage.getByRole("button", { name: "Publish job" }).click();
  await expect(hrPage.getByText("Open", { exact: true }).first()).toBeVisible(slow);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto(boardUrl.replace(/.*\/recruiting\//, "/careers/"));
  await waitForHydration(anon, "#ap-name");
  await anon.getByLabel("Full name").fill(applicantName);
  await anon.getByLabel("Email", { exact: true }).fill(`ola.${stamp}@example.com`);
  await anon.locator("#ap-resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF });
  await anon.getByLabel(/I have read the privacy notice/).check();
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText("Thank you, we received your application.")).toBeVisible(slow);

  await hrPage.goto(boardUrl);
  await waitForHydration(hrPage, "select");
  await hrPage.getByLabel(`Move ${applicantName} to`).selectOption("offer");
  await expect(hrPage.locator("section[data-stage='offer']").getByRole("link", { name: applicantName })).toBeVisible(slow);
  await hrPage.locator("section[data-stage='offer']").getByRole("link", { name: applicantName }).click();
  await hrPage.waitForURL(/\/recruiting\/applications\//, slow);
  const applicationUrl = hrPage.url();

  // Make the offer
  await hrPage.getByText("Make an offer").click();
  await waitForHydration(hrPage, "#of-role");
  await hrPage.getByLabel("Role", { exact: true }).fill("Virtual Assistant");
  await hrPage.getByLabel("Start date").first().fill("2027-01-04");
  await hrPage.getByLabel(/^Pay note/).fill("Hourly rate agreed per client.");
  await hrPage.getByRole("button", { name: "Preview the letter" }).click();
  await expect(hrPage.getByText(`Dear ${applicantName},`)).toBeVisible(slow);
  await hrPage.getByRole("button", { name: "Send offer" }).click();
  await expect(hrPage.getByText("Sent", { exact: true }).first()).toBeVisible(slow);

  // No email service here: give the applicant their link and a verified session directly in the database
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  const token = randomBytes(32).toString("base64url");
  const session = randomBytes(32).toString("base64url");
  try {
    const updated = await sql`
      update docs.esign_signers s set access_token_hash = ${sha(token)}, session_hash = ${sha(session)}, session_expires_at = now() + interval '1 hour'
      from talent.offers o join talent.applications a on a.id = o.application_id join talent.candidates c on c.id = a.candidate_id
      where s.envelope_id = o.envelope_id and s.user_id is null and c.full_name = ${applicantName} returning s.id`;
    expect(updated.length).toBe(1);
  } finally {
    await sql.end();
  }

  // The applicant: no account, reads the document in the page and signs
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "elevate_sign_session", value: session, url: BASE }]);
  const applicant = await ctx.newPage();
  await applicant.goto(`/sign/${token}`);
  await expect(applicant.getByRole("heading", { name: "Offer: Virtual Assistant" })).toBeVisible(slow);
  await waitForHydration(applicant, "#ext-consent");
  await expect(applicant.getByRole("button", { name: "Sign document" })).toBeDisabled();
  await applicant.getByRole("button", { name: "Read the document" }).click();
  await expect(applicant.locator("iframe[title='The document to sign']")).toBeVisible();
  await expect(applicant.getByText("You opened it. You can sign now.")).toBeVisible(slow);
  await applicant.getByLabel(/I agree to sign this document electronically/).check();
  await applicant.getByRole("button", { name: "Sign document" }).click();
  await expect(applicant.getByText("Everyone has signed.")).toBeVisible(slow);
  await expect(applicant.getByRole("link", { name: "Download the signed copy" })).toBeVisible();
  // The link alone (no code) shows nothing of the document
  const stranger = await (await browser.newContext()).newPage();
  const noSession = await stranger.request.get(`/api/sign/${token}/document`);
  expect(noSession.status()).toBe(401);

  // HR sees it signed and hires
  await hrPage.goto(applicationUrl);
  await expect(hrPage.getByText("Signed", { exact: true }).first()).toBeVisible(slow);
  await hrPage.locator("summary", { hasText: /^Hire$/ }).click();
  await waitForHydration(hrPage, "#hr-first");
  await hrPage.getByLabel("Start date").last().fill("2027-01-04");
  hrPage.on("dialog", (d) => void d.accept());
  await hrPage.getByRole("button", { name: "Hire", exact: true }).click();
  await hrPage.waitForURL(/\/people\/[0-9a-f-]{36}$/, slow);
  await expect(hrPage.getByRole("heading", { name: /Ola/ })).toBeVisible(slow);
});

test("offers are for recruiters, HR and the hiring team; an employee sees no offer panel and no templates page", async ({ page }) => {
  const slow = { timeout: 30_000 };
  await signInEnrollingMfa(page, await createEmployeeAccount("Uma", `Offer${Date.now()}`));
  await page.goto("/recruiting/offer-templates");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible(slow);
  const anon = await page.context().browser()!.newContext();
  const bad = await anon.request.get(`${BASE}/sign/${"A".repeat(43)}`);
  expect(bad.status()).toBe(200); // the page itself answers; it says the link is not valid
  expect(await bad.text()).toContain("This link is not valid anymore");
});
