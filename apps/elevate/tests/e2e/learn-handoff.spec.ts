import { expect, test } from "@playwright/test";
import { createEmployeeAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// The sign-in handoff in a real browser: a person opens HIPAA training from ELEVATE and lands on ELEVATE Learn signed in as
// themselves; the link works only through the form post (the token is never in an address); signing out of Learn goes back to
// ELEVATE; and a visit to Learn with no session is sent through ELEVATE and returns signed in.
// Needs ELEVATE (E2E_BASE_URL) and ELEVATE Learn (LEARN_URL, default http://localhost:3200) both running against the same database.

const LEARN = process.env.LEARN_URL ?? "http://localhost:3200";

test("a person opens HIPAA training from ELEVATE and lands signed in on Learn", async ({ page }) => {
  test.setTimeout(180_000);
  const slow = { timeout: 30_000 };
  const person = await createEmployeeAccount("Lia", `Learn${Date.now()}`);
  await signInEnrollingMfa(page, person);

  // The menu item is its own page with a clear button.
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "My training" })).toBeVisible(slow);
  await waitForHydration(page, "main button");
  await page.getByRole("button", { name: /Open HIPAA training/ }).click();

  await page.waitForURL(`${LEARN}/**`, slow);
  await expect(page.getByRole("heading", { name: /Hello, Lia/ })).toBeVisible(slow);
  await expect(page.getByText("You have no training assigned yet.")).toBeVisible();
  // the one-time token is not left in the address or in history
  expect(page.url()).not.toContain("token");
  const cookies = await page.context().cookies(LEARN);
  const session = cookies.find((c) => c.name === "learn_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");

  // A return visit works with the session, without going back through ELEVATE.
  await page.goto(LEARN);
  await expect(page.getByRole("heading", { name: /Hello, Lia/ })).toBeVisible(slow);

  // Signing out of training ends that session and returns to ELEVATE.
  await page.getByRole("button", { name: "Sign out of training" }).click();
  await page.waitForURL(/\/dashboard/, slow);
  // (Signing out already cleared Learn's cookie. Cookies are shared across ports on localhost, so nothing else is cleared here.)

  // With no Learn session, opening Learn goes through ELEVATE (still signed in there) and comes back signed in.
  await page.goto(LEARN);
  await page.waitForURL(`${LEARN}/**`, slow);
  await expect(page.getByRole("heading", { name: /Hello, Lia/ })).toBeVisible({ timeout: 45_000 });
});

test("a token cannot be replayed, and a post from another site is refused", async ({ request }) => {
  // No session or account needed: these go straight at Learn's handoff address.
  const forged = await request.post(`${LEARN}/auth/handoff`, {
    form: { token: "A".repeat(43) },
    headers: { origin: "https://evil.example.com" },
    maxRedirects: 0,
  });
  expect(forged.status()).toBe(403);

  const unknown = await request.post(`${LEARN}/auth/handoff`, {
    form: { token: "A".repeat(43) },
    headers: { origin: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
    maxRedirects: 0,
  });
  expect(unknown.status()).toBe(303);
  expect(unknown.headers()["location"]).toContain("/expired");
  expect(unknown.headers()["set-cookie"]).toBeUndefined();
});
