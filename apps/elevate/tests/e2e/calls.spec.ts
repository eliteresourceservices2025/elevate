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

test("host controls: the People list, mute someone, remove someone", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Hst${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Hst${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  const nameB = `Bea Hst${stamp}b`;
  await pageB.goto("/dashboard");
  await startDirect(pageA, `Hst${stamp}b`, nameB);
  await pageA.getByRole("button", { name: "Start a call" }).click();
  await pageA.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
  const ring = pageB.getByRole("alertdialog", { name: "Incoming call" });
  await expect(ring).toBeVisible({ timeout: 20_000 });
  await ring.getByRole("button", { name: "Join" }).click();
  await expect(pageB.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 });
  await expect(pageA.getByRole("list", { name: "People in the call" }).getByTestId("call-tile")).toHaveCount(2, { timeout: 30_000 });

  // The host sees mute and remove next to Bea; Bea sees neither next to anyone.
  await pageA.getByRole("button", { name: /^People \(2\)/ }).click();
  await expect(pageA.getByRole("button", { name: `Mute ${nameB}` })).toBeVisible();
  await expect(pageA.getByRole("button", { name: `Remove ${nameB} from the call` })).toBeVisible();
  await pageB.getByRole("button", { name: /^People \(2\)/ }).click();
  await expect(pageB.getByTestId("person-row")).toHaveCount(2);
  await expect(pageB.getByRole("button", { name: /^Mute (?!microphone)/ })).toHaveCount(0);
  await expect(pageB.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  // Mute: the server switches off Bea's microphone, and her own button follows.
  await expect(pageB.getByRole("button", { name: "Mute microphone" })).toBeVisible();
  await pageB.waitForTimeout(7_000); // a change made a moment ago is not mistaken for the host
  await pageA.getByRole("button", { name: `Mute ${nameB}` }).click();
  await expect(pageB.getByRole("button", { name: "Unmute microphone" })).toBeVisible({ timeout: 30_000 });

  // Remove: Bea is taken out and sent back to the chat; Ana is alone again.
  await pageA.getByRole("button", { name: `Remove ${nameB} from the call` }).click();
  await pageA.getByRole("button", { name: `Remove ${nameB}?` }).click();
  await pageB.waitForURL(/\/messages\/[0-9a-f-]{36}$/, { timeout: 40_000 });
  await expect(pageA.getByText("1 person in this call")).toBeVisible({ timeout: 30_000 });
});

test("settings: a Super Admin sees the month's media estimate and saves the warning; an employee gets a 404", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const admin = await createEmployeeAccount("Sue", `Set${stamp}a`, { roles: ["super_admin"] });
  const employee = await createEmployeeAccount("Ed", `Set${stamp}e`);
  const pageS = await (await browser.newContext()).newPage();
  const pageE = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageS, admin);
  await signInEnrollingMfa(pageE, employee);

  await pageS.goto("/settings/calls");
  await expect(pageS.getByRole("heading", { level: 1, name: "Calls" })).toBeVisible({ timeout: 45_000 });
  await expect(pageS.getByRole("progressbar", { name: "Estimated media this month" })).toBeVisible();
  await expect(pageS.getByText(/of 1,000 GB free/)).toBeVisible();
  const level = pageS.getByLabel("Warn me at (GB a month)");
  await level.fill("40");
  await expect(level).toHaveAttribute("aria-invalid", "true");
  await expect(pageS.getByRole("button", { name: "Save" })).toBeDisabled();
  await level.fill("800");
  await pageS.getByRole("button", { name: "Save" }).click();
  await expect(pageS.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  await pageS.reload();
  await expect(pageS.getByLabel("Warn me at (GB a month)")).toHaveValue("800");
  await pageS.getByLabel("Warn me at (GB a month)").fill("700");
  await pageS.getByRole("button", { name: "Save" }).click();

  const response = await pageE.goto("/settings/calls");
  expect(response?.status()).toBe(404);
});
