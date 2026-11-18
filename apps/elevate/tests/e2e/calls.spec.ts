import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, hydrated, signInEnrollingMfa } from "./helpers";

// Calls on the fake media layer (dev server started with CALLS_FAKE=1 and NEXT_PUBLIC_CALLS_FAKE=1): ringing, joining, the roster, camera,
// mute, screen share, the mini window, and how a call ends. The real server rules run; only the pictures are placeholders.
// Needs the local Supabase with migrations applied (including 0159 and 0160).

async function startDirect(page: Page, otherLastName: string, otherFullName: string) {
  await page.goto("/messages");
  await (await hydrated(page.getByRole("button", { name: "New message" }))).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find people").fill(otherLastName);
  await dialog.getByRole("button", { name: new RegExp(otherFullName) }).click();
  await dialog.getByRole("button", { name: "Open chat" }).click();
  await expect(page.getByRole("heading", { level: 2, name: otherFullName })).toBeVisible({ timeout: 45_000 });
}

test("a call: ring, join, camera, mute, screen share, the mini window, leave", async ({ browser }) => {
  test.setTimeout(360_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Cal${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Cal${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  const nameB = `Bea Cal${stamp}b`;
  const nameA = `Ana Cal${stamp}a`;

  // Bea is on the dashboard (not in Messages) when the call comes in.
  await pageB.goto("/dashboard");
  await startDirect(pageA, `Cal${stamp}b`, nameB);
  await pageA.getByRole("button", { name: "Start a call" }).click();
  await pageA.waitForURL(/\/messages\/call\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await expect(pageA.getByText("Waiting for others to join.")).toBeVisible({ timeout: 30_000 });

  // The ring shows on whatever page she is on, then Join takes her into the call.
  const ring = pageB.getByRole("alertdialog", { name: "Incoming call" });
  await expect(ring).toBeVisible({ timeout: 20_000 });
  await expect(ring).toContainText(nameA);
  await ring.getByRole("button", { name: "Join" }).click();
  await pageB.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  await expect(pageB.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 });
  await expect(pageA.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 });
  await expect(pageA.getByText("2 people in this call.")).toBeVisible();

  // Bea's camera: Ana pulls it (the server only allows tracks of people in the call).
  await pageB.getByRole("button", { name: "Turn camera on" }).click();
  await expect(pageB.getByRole("button", { name: "Turn camera off" })).toBeVisible();
  await expect(pageA.getByLabel(`Video of ${nameB}`)).toBeVisible({ timeout: 25_000 });
  expect(await pageA.evaluate(() => (window as unknown as { __callsFake: { pulled: string[] } }).__callsFake.pulled.length)).toBeGreaterThan(0);

  // Bea mutes: the little muted icon shows on her tile for Ana (presence).
  await pageB.getByRole("button", { name: "Mute microphone" }).click();
  await expect(pageA.locator(`[data-testid="call-tile"]:has-text("${nameB}") [aria-label="Muted"]`)).toBeVisible({ timeout: 20_000 });
  await pageB.getByRole("button", { name: "Unmute microphone" }).click();

  // Ana shares her screen: Bea sees a shared screen.
  await pageA.getByRole("button", { name: "Share your screen" }).click();
  await expect(pageB.getByTestId("screen-share")).toBeVisible({ timeout: 25_000 });
  await pageA.getByRole("button", { name: "Stop sharing your screen" }).click();
  await expect(pageB.getByTestId("screen-share")).toHaveCount(0, { timeout: 25_000 });

  // Bea leaves the call page: the call goes on in the mini window.
  await pageB.getByRole("link", { name: "Dashboard" }).first().click();
  await pageB.waitForURL(/\/dashboard/);
  const mini = pageB.getByRole("region", { name: "Call in progress" });
  await expect(mini).toBeVisible();
  await expect(mini).toContainText("2 in call");
  await mini.getByRole("link", { name: "Return" }).click();
  await expect(pageB.getByRole("list", { name: "People in the call" })).toBeVisible();

  // Everyone leaves: back to the chat, which says the call ended.
  await pageB.getByRole("button", { name: "Leave call" }).first().click();
  await pageB.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(pageA.getByText("1 person in this call")).toBeVisible({ timeout: 30_000 });
  await pageA.getByRole("button", { name: "Leave call" }).first().click();
  await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(pageA.getByRole("log").getByText(/Call ended after \d+ min/)).toBeVisible({ timeout: 20_000 });
  await expect(pageA.getByRole("button", { name: "Start a call" })).toBeVisible();
});

test("a call nobody joins ends as a missed call and the other person is told", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Mis${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Mis${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/dashboard");
  await startDirect(pageA, `Mis${stamp}b`, `Bea Mis${stamp}b`);
  await pageA.getByRole("button", { name: "Start a call" }).click();
  await pageA.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  const ring = pageB.getByRole("alertdialog", { name: "Incoming call" });
  await expect(ring).toBeVisible({ timeout: 20_000 });
  // Bea declines; Ana hangs up while alone: it is a missed call.
  await ring.getByRole("button", { name: "Decline" }).click();
  await expect(ring).toBeHidden();
  await expect(pageA.getByText("Waiting for others to join.")).toBeVisible({ timeout: 30_000 });
  await pageA.getByRole("button", { name: "Leave call" }).first().click();
  await pageA.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(pageA.getByRole("log").getByText("Missed call")).toBeVisible({ timeout: 20_000 });
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Mis${stamp}a`) }).click();
  await expect(pageB.getByRole("log").getByText("Missed call")).toBeVisible({ timeout: 20_000 });
});
