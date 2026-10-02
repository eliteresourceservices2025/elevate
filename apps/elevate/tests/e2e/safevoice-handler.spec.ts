import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase, migrations applied, SAFEVOICE_HANDLER_DATABASE_URL in .env.local, and the Safe Voice app on :3100.
// A designated handler reads a test report sent through the real reporter app, replies, and the reporter sees the reply.

const SAFE_VOICE = process.env.SAFE_VOICE_URL ?? "http://localhost:3100";

test("a designated handler reads and answers a report sent through the anonymous app", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 45_000 };
  const stamp = Date.now();
  const text = `E2E test report ${stamp}: nothing real happened, this is only a check.`;
  const reply = `E2E reply ${randomBytes(3).toString("hex")}`;

  // The reporter sends a report (no sign-in, no cookies)
  const reporter = await (await browser.newContext()).newPage();
  await reporter.goto(SAFE_VOICE);
  await reporter.getByLabel("What is this about?").selectOption("fraud_or_ethics");
  await reporter.getByLabel("What happened?").fill(text);
  await reporter.getByRole("button", { name: "Send report" }).click();
  await expect(reporter.getByText("Your report was sent")).toBeVisible(slow);
  const body = await reporter.locator("main").innerText();
  const code = body.match(/SV-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)![0];
  const passphrase = body.match(/\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\b/)![0];
  expect(await reporter.context().cookies()).toHaveLength(0);

  // A handler (designated by the database, as Settings > Roles would do) opens it in ELEVATE
  const handler = await createEmployeeAccount("Hana", `Handler${stamp}`, { roles: ["hr_admin"] });
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`update core.users set is_safevoice_handler = true where lower(email) = ${handler.email.toLowerCase()}`;
  } finally {
    await sql.end();
  }
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, handler);
  await page.goto("/safe-voice-cases");
  await expect(page.getByRole("heading", { name: /Safe Voice/i }).first()).toBeVisible(slow);
  await page.screenshot({ path: process.env.SV_SHOT_DIR ? `${process.env.SV_SHOT_DIR}/cases.png` : "test-results/sv-cases.png", fullPage: true });
  // Several reports may be waiting: open them until the one just sent shows
  const links = await page.getByRole("link", { name: /^SV-/ }).count();
  for (let i = 0; i < links; i++) {
    await page.goto("/safe-voice-cases");
    await page.getByRole("link", { name: /^SV-/ }).nth(i).click();
    await page.waitForLoadState("networkidle");
    if ((await page.getByText(text).count()) > 0) break;
  }
  await expect(page.getByText(text)).toBeVisible(slow);
  await waitForHydration(page, "textarea");
  await page.getByRole("textbox").first().fill(reply);
  await page.getByRole("button", { name: /Send reply|Reply/ }).first().click();
  await expect(page.getByText(reply)).toBeVisible(slow);
  await page.screenshot({ path: process.env.SV_SHOT_DIR ? `${process.env.SV_SHOT_DIR}/case.png` : "test-results/sv-case.png", fullPage: true });

  // The reporter opens the case with the code and passphrase and sees the reply
  await reporter.goto(`${SAFE_VOICE}/follow-up`);
  await reporter.getByLabel(/Case code/i).fill(code);
  await reporter.getByLabel(/Passphrase/i).fill(passphrase);
  await reporter.getByRole("button", { name: /Open|Check/ }).first().click();
  await expect(reporter.getByText(reply)).toBeVisible(slow);
  expect(await reporter.context().cookies()).toHaveLength(0);
});
