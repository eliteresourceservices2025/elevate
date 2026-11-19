import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

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

// ---- all-hands (5a) and recording (5b) ---------------------------------------------------------------------------------------------
// HR starts an all-hands in a group; the audience can only watch (a hand and reactions, no microphone or camera); HR makes one person a
// speaker; then HR records: the person is asked, says yes, and the recording is uploaded, kept, and watchable by people who were there.
// The pictures are placeholders (fake media layer); the rules, the upload to storage and the playback route are real.
// Needs the call-recordings bucket (pnpm storage:setup) and migration 0161.

test("an all-hands: the audience watches, a speaker is chosen, then a recording with consent that can be watched", async ({ browser }) => {
  test.setTimeout(420_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const a = await createEmployeeAccount("Ana", `All${stamp}a`);
  const b = await createEmployeeAccount("Bea", `All${stamp}b`);
  const c = await createEmployeeAccount("Cy", `All${stamp}c`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    // HR may record (a Super Admin's pick) and recording is switched on, for this test only.
    await sql`update core.users set can_record_calls = true where lower(email) = ${hr.email.toLowerCase()}`;
    await sql`insert into chat.call_settings (id, recording_enabled) values (1, true) on conflict (id) do update set recording_enabled = true`;

    const pageH = await (await browser.newContext()).newPage();
    const pageA = await (await browser.newContext()).newPage();
    const pageB = await (await browser.newContext()).newPage();
    const pageC = await (await browser.newContext()).newPage();
    await signInEnrollingMfa(pageH, hr);
    for (const [page, account] of [[pageA, a], [pageB, b], [pageC, c]] as const) await signInEnrollingMfa(page, account);
    for (const page of [pageA, pageB, pageC]) await page.goto("/messages");

    // HR makes the group and starts an all-hands in it.
    const title = `Town ${stamp}`;
    await pageH.goto("/messages");
    await (await hydrated(pageH.getByRole("button", { name: "New message" }))).click();
    const dialog = pageH.getByRole("dialog");
    await dialog.getByRole("button", { name: "Group" }).click();
    await dialog.getByLabel("Group name").fill(title);
    await dialog.getByLabel("Find people").fill(`All${stamp}`);
    await dialog.getByRole("button", { name: "Add everyone shown (3)" }).click();
    await dialog.getByRole("button", { name: "Create group" }).click();
    await expect(pageH.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
    const startAllHands = pageH.getByRole("button", { name: "Start an all-hands" });
    await expect(startAllHands).toBeVisible({ timeout: 45_000 });
    await startAllHands.click();
    await pageH.waitForURL(/\/messages\/call\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(pageH.getByText("All-hands: 0 watching, 1 on stage.")).toBeVisible({ timeout: 30_000 });

    // Ana is rung, joins, and is in the audience: no microphone, camera or screen buttons, but a hand and reactions.
    const ring = pageA.getByRole("alertdialog", { name: "Incoming call" });
    await expect(ring).toBeVisible({ timeout: 20_000 });
    await ring.getByRole("button", { name: "Join" }).click();
    await pageA.waitForURL(/\/messages\/call\//, { timeout: 30_000 });
    await expect(pageA.getByText("All-hands: 1 watching, 1 on stage.")).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByRole("button", { name: /microphone/ })).toHaveCount(0);
    await expect(pageA.getByRole("button", { name: "Share your screen" })).toHaveCount(0);
    await expect(pageA.getByRole("button", { name: "Raise your hand" })).toBeVisible();

    // She raises a hand and reacts; HR sees both.
    await pageA.getByRole("button", { name: "Raise your hand" }).click();
    await pageA.getByRole("button", { name: "Send a reaction" }).click();
    await pageA.getByRole("button", { name: "Send 👍" }).click();
    await pageH.getByRole("button", { name: /^People/ }).click();
    await expect(pageH.getByTestId("person-row").filter({ hasText: "Ana" }).getByRole("img", { name: "Hand raised" })).toBeVisible({ timeout: 25_000 });
    await expect(pageH.getByRole("list", { name: "Reactions" })).toContainText("reacted with 👍", { timeout: 25_000 });

    // HR makes her a speaker: her microphone button appears. Then back to the audience: it goes away.
    await pageH.getByRole("button", { name: /^Make Ana .* a speaker$/ }).click();
    await expect(pageA.getByText("You're a speaker now.")).toBeVisible({ timeout: 25_000 });
    await expect(pageA.getByRole("button", { name: "Unmute microphone" })).toBeVisible({ timeout: 25_000 });
    await pageH.getByRole("button", { name: /^Put Ana .* back in the audience$/ }).click();
    await expect(pageA.getByRole("button", { name: /microphone/ })).toHaveCount(0, { timeout: 25_000 });

    // Recording: HR starts it. Ana is asked; until she says yes she is not in it. She can change her mind at any time.
    await pageH.bringToFront();
    await pageH.getByRole("button", { name: "Start recording" }).click();
    const noticeH = pageH.getByTestId("recording-notice");
    await expect(noticeH).toContainText("You are recording this call.", { timeout: 25_000 });
    await expect(noticeH).toContainText("1 so far");
    const noticeA = pageA.getByTestId("recording-notice");
    await expect(noticeA).toContainText("is recording this call", { timeout: 25_000 });
    await expect(noticeA).toContainText("Are you OK with being recorded?");
    await noticeA.getByRole("button", { name: "Yes, record me" }).click();
    await expect(noticeH).toContainText("2 so far", { timeout: 25_000 });
    await noticeA.getByRole("button", { name: "Stop recording me" }).click();
    await expect(noticeH).toContainText("1 so far", { timeout: 25_000 });
    await noticeA.getByRole("button", { name: "I'm OK with it now" }).click();
    await expect(noticeH).toContainText("2 so far", { timeout: 25_000 });

    // Let it record a little, then stop: the last piece is uploaded and checked, and kept for 30 days.
    await pageH.waitForTimeout(6_000);
    await pageH.getByRole("button", { name: "Stop recording" }).click();
    await expect(pageH.getByTestId("recording-notice")).toHaveCount(0, { timeout: 40_000 });
    await expect
      .poll(
        async () => {
          const rows = await sql`select count(*)::int as n, coalesce(sum(p.size_bytes), 0)::int as bytes from chat.call_recording_parts p join chat.call_recordings r on r.id = p.recording_id join chat.calls c on c.id = r.call_id join chat.conversations v on v.id = c.conversation_id where v.title = ${title} and p.status = 'ready'`;
          return rows[0].n > 0 && rows[0].bytes > 0;
        },
        { timeout: 60_000, message: "the recording was uploaded and checked" },
      )
      .toBe(true);
    const [rec] = await sql`select r.id, r.end_reason, r.expires_at from chat.call_recordings r join chat.calls c on c.id = r.call_id join chat.conversations v on v.id = c.conversation_id where v.title = ${title}`;
    expect(rec.end_reason).toBe("stopped");
    expect(rec.expires_at).not.toBeNull();

    // End the call; Ana (she was in it) can watch the recording; Bea (she never joined) cannot.
    await pageH.getByRole("button", { name: "End for everyone" }).click();
    await pageA.goto("/messages/recordings");
    await expect(pageA.getByTestId("recording-row")).toContainText(title, { timeout: 30_000 });
    const played = await pageA.request.get(`/api/calls/recordings/${rec.id}`);
    expect(played.status()).toBe(200);
    expect(played.headers()["content-type"]).toBe("video/webm");
    expect((await played.body()).length).toBeGreaterThan(0);
    const denied = await pageB.request.get(`/api/calls/recordings/${rec.id}`);
    expect(denied.status()).toBe(404);
    await pageB.goto("/messages/recordings");
    await expect(pageB.getByText("No recordings")).toBeVisible({ timeout: 30_000 });
  } finally {
    await sql`update chat.call_settings set recording_enabled = false where id = 1`;
    await sql.end();
  }
});
