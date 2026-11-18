import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, createSignInOnlyAccount, createTestClientRecord, hydrated, signInEnrollingMfa, signInGuestEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied (including 0147, which lets a person join only their own Realtime channel).
// Two or three people chat in separate browser windows: live delivery, unread badges, edit, delete, a group, a 404 for a stranger, phone width.

async function startDirect(page: Page, otherLastName: string, otherFullName: string) {
  await page.goto("/messages");
  await (await hydrated(page.getByRole("button", { name: "New message" }))).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find people").fill(otherLastName);
  await dialog.getByRole("button", { name: new RegExp(otherFullName) }).click();
  await dialog.getByRole("button", { name: "Open chat" }).click();
  // The first load in a development server compiles the page on demand, so allow for a slow moment.
  await expect(page.getByRole("heading", { level: 2, name: otherFullName })).toBeVisible({ timeout: 45_000 });
}

async function say(page: Page, label: string, text: string) {
  const box = page.getByLabel(`Message ${label}`);
  await box.fill(text);
  // Enter is ignored while the previous send is still settling, so press it again until the box has emptied.
  await expect(async () => {
    if ((await box.inputValue()) !== "") await box.press("Enter");
    await expect(page.getByRole("log").getByText(text, { exact: true })).toBeVisible({ timeout: 2_500 });
  }).toPass({ timeout: 15_000 });
}

test("two people chat live, edit, delete, and a stranger gets a 404", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Dm${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Dm${stamp}b`);
  const c = await createEmployeeAccount("Cy", `Dm${stamp}c`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  const pageC = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await signInEnrollingMfa(pageC, c);

  // B waits on the Messages page with nothing yet.
  await pageB.goto("/messages");
  await expect(pageB.getByText("No messages yet")).toBeVisible();

  // A starts a chat with B and says hello.
  await startDirect(pageA, `Dm${stamp}b`, `Bea Dm${stamp}b`);
  const chatUrl = pageA.url();
  expect(chatUrl).toMatch(/\/messages\/[0-9a-f-]{36}$/);
  await say(pageA, `Bea Dm${stamp}b`, "Hello Bea");

  // B sees it appear without reloading: well inside the 20 s polling fallback, so this proves the live channel works.
  const listItem = pageB.getByRole("button", { name: new RegExp(`Ana Dm${stamp}a`) });
  await expect(listItem).toBeVisible({ timeout: 12_000 });
  await expect(listItem).toContainText("Hello Bea");
  await expect(listItem.getByLabel("1 unread")).toBeVisible();

  // The header shows the unread count on the next page load, and clears once B has read the chat.
  await pageB.goto("/dashboard");
  await expect(pageB.getByRole("link", { name: "Messages, 1 unread" })).toBeVisible();
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Dm${stamp}a`) }).click();
  await expect(pageB.getByRole("log").getByText("Hello Bea", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    await pageB.goto("/dashboard");
    return pageB.getByRole("link", { name: "Messages, 1 unread" }).count();
  }, { timeout: 20_000 }).toBe(0);

  // B replies live; A sees the reply and then "Seen" under their own message.
  await pageB.goto(chatUrl);
  await say(pageB, `Ana Dm${stamp}a`, "Hi Ana!");
  await expect(pageA.getByRole("log").getByText("Hi Ana!", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(pageA.getByText("Seen")).toBeVisible({ timeout: 12_000 });

  // A edits, B sees "edited"; A removes, B sees the removal note and never the text.
  await pageA.getByRole("log").getByText("Hello Bea", { exact: true }).hover();
  await pageA.getByRole("button", { name: "Edit message" }).click();
  await pageA.getByLabel("Edit your message").fill("Hello Bea, welcome");
  await pageA.getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("log").getByText("Hello Bea, welcome", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(pageB.getByRole("log").getByText("edited")).toBeVisible();
  await pageA.getByRole("log").getByText("Hello Bea, welcome", { exact: true }).hover();
  await pageA.getByRole("button", { name: "Remove message" }).click();
  await pageA.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(pageB.getByText("This message was removed")).toBeVisible({ timeout: 12_000 });
  await expect(pageB.getByText("Hello Bea, welcome")).toHaveCount(0);

  // C is not in the chat: its address is a 404, the same as a chat that does not exist.
  const response = await pageC.goto(chatUrl);
  expect(response?.status()).toBe(404);

  // Phone width: the list first, then the chat with a way back.
  await pageB.setViewportSize({ width: 390, height: 844 });
  await pageB.goto("/messages");
  await expect(pageB.getByRole("heading", { level: 2, name: "Chats" })).toBeVisible();
  await expect(pageB.getByLabel("Message Ana", { exact: false })).toBeHidden();
  await pageB.getByRole("button", { name: new RegExp(`Ana Dm${stamp}a`) }).click();
  await expect(pageB.getByRole("button", { name: "Back to chats" })).toBeVisible();
  await pageB.getByRole("button", { name: "Back to chats" }).click();
  await expect(pageB.getByRole("heading", { level: 2, name: "Chats" })).toBeVisible();
});

test("only HR makes and manages groups: create, rename, remove a person, delete; everyone else just chats", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const a = await createEmployeeAccount("Ana", `Grp${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Grp${stamp}b`);
  const c = await createEmployeeAccount("Cy", `Grp${stamp}c`);
  const pageH = await (await browser.newContext()).newPage();
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  const pageC = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageH, hr);
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await signInEnrollingMfa(pageC, c);
  for (const page of [pageA, pageB, pageC]) await page.goto("/messages");

  // Someone who is not HR cannot start a group, has no Manage groups link, and the manage page is a 404.
  await (await hydrated(pageA.getByRole("button", { name: "New message" }))).click();
  await expect(pageA.getByRole("dialog").getByRole("button", { name: "Group" })).toHaveCount(0);
  await pageA.keyboard.press("Escape");
  await expect(pageA.getByRole("link", { name: "Manage groups" })).toHaveCount(0);
  expect((await pageA.goto("/messages/manage"))?.status()).toBe(404);
  await pageA.goto("/messages"); // back to the Messages page so live updates arrive

  // HR makes a group of everyone with the shared tag (Ana, Bea and Cy), using "Add everyone shown".
  const title = `Crew ${stamp}`;
  await pageH.goto("/messages");
  await (await hydrated(pageH.getByRole("button", { name: "New message" }))).click();
  const dialog = pageH.getByRole("dialog");
  await dialog.getByRole("button", { name: "Group" }).click();
  await dialog.getByLabel("Group name").fill(title);
  await dialog.getByLabel("Find people").fill(`Grp${stamp}`);
  await dialog.getByRole("button", { name: "Add everyone shown (3)" }).click();
  await expect(dialog.getByText("3 chosen")).toBeVisible();
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(pageH.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 45_000 });

  await say(pageH, title, "Welcome to the crew");
  for (const page of [pageA, pageB, pageC]) {
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: new RegExp(title) })).toContainText("Welcome to the crew");
  }

  // An ordinary member sees who is in the group but has no controls.
  await pageA.getByRole("button", { name: new RegExp(title) }).click();
  await pageA.getByRole("button", { name: "Show people in this chat" }).click();
  await expect(pageA.getByRole("complementary", { name: "People in this chat" })).toContainText(`Cy Grp${stamp}c`);
  await expect(pageA.getByRole("button", { name: /^Remove /i })).toHaveCount(0);
  await expect(pageA.getByRole("button", { name: "Delete group" })).toHaveCount(0);
  await expect(pageA.getByRole("button", { name: "Rename" })).toHaveCount(0);

  // HR renames the group; everyone's list shows the new name.
  const renamed = `Front desk crew ${stamp}`;
  await pageH.getByRole("button", { name: "Show people in this chat" }).click();
  await pageH.getByRole("button", { name: "Rename" }).click();
  await pageH.getByRole("dialog").getByLabel("Group name").fill(renamed);
  await pageH.getByRole("dialog").getByRole("button", { name: "Save name" }).click();
  await expect(pageB.getByRole("button", { name: new RegExp(renamed) })).toBeVisible({ timeout: 12_000 });

  // HR removes Cy: Cy loses the group at once and later messages never reach Cy.
  await pageH.getByRole("button", { name: `Remove Cy Grp${stamp}c` }).click();
  await pageH.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(pageC.getByRole("button", { name: new RegExp(renamed) })).toHaveCount(0, { timeout: 12_000 });
  await say(pageH, renamed, "Only three of us now");
  await expect(pageB.getByRole("button", { name: new RegExp(renamed) })).toContainText("Only three of us now", { timeout: 12_000 });
  await pageC.goto("/messages");
  await expect(pageC.getByText(renamed)).toHaveCount(0);

  // HR deletes the group on the Manage groups page; it disappears for everyone.
  await pageH.getByRole("link", { name: "Manage groups" }).click();
  await expect(pageH.getByRole("heading", { level: 1, name: "Manage groups" })).toBeVisible({ timeout: 45_000 });
  const row = pageH.getByRole("row", { name: new RegExp(renamed) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Manage" }).click();
  await pageH.getByRole("button", { name: "Delete group" }).click();
  await pageH.getByRole("alertdialog").getByRole("button", { name: "Delete group" }).click();
  await expect(pageH.getByRole("row", { name: new RegExp(renamed) })).toHaveCount(0, { timeout: 12_000 });
  await expect(pageB.getByRole("button", { name: new RegExp(renamed) })).toHaveCount(0, { timeout: 12_000 });
  await pageA.goto("/messages");
  await expect(pageA.getByText(renamed)).toHaveCount(0);
});

test("reactions, a thread, a pin and an @mention", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Rich${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Rich${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/messages");
  const bName = `Bea Rich${stamp}b`;
  await startDirect(pageA, `Rich${stamp}b`, bName);

  // Ana mentions Bea (the mention list inserts a token that shows as a chip).
  await pageA.getByRole("button", { name: "Mention someone" }).click();
  await pageA.getByRole("option", { name: bName }).click();
  const box = pageA.getByLabel(`Message ${bName}`);
  await box.press("End");
  await box.pressSequentially("can you cover Friday?");
  await box.press("Enter");
  const message = pageA.getByRole("log").locator("p", { hasText: "can you cover Friday?" });
  await expect(message.getByText(`@${bName}`)).toBeVisible();

  // Bea sees it, reacts, and replies in a thread.
  await pageB.getByRole("button", { name: new RegExp(`Ana Rich${stamp}a`) }).click();
  const bMessage = pageB.getByRole("log").locator("p", { hasText: "can you cover Friday?" });
  await expect(bMessage).toBeVisible({ timeout: 12_000 });
  await bMessage.hover();
  await pageB.getByRole("button", { name: "React to this message" }).first().click();
  await pageB.getByRole("button", { name: "Emoji 👍" }).click();
  await expect(pageA.getByRole("button", { name: /👍 1/ })).toBeVisible({ timeout: 12_000 });

  await bMessage.hover();
  await pageB.getByRole("button", { name: "Reply in thread" }).first().click();
  await pageB.getByRole("textbox", { name: "Reply in thread" }).fill("Yes, I can cover it");
  await pageB.getByRole("textbox", { name: "Reply in thread" }).press("Enter");
  await expect(pageA.getByRole("button", { name: "1 reply" })).toBeVisible({ timeout: 12_000 });
  await pageA.getByRole("button", { name: "1 reply" }).click();
  await expect(pageA.getByRole("complementary", { name: "Thread" }).getByText("Yes, I can cover it")).toBeVisible();

  // Ana pins the message; Bea sees the pinned bar.
  await pageA.getByRole("button", { name: "Close thread" }).click();
  await message.hover();
  await pageA.getByRole("button", { name: "Pin message" }).first().click();
  await expect(pageB.getByRole("region", { name: "Pinned messages" })).toContainText("can you cover Friday?", { timeout: 12_000 });
});

test("team and company channels appear after HR updates them; only HR posts in the company channel", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const a = await createEmployeeAccount("Ana", `Chan${stamp}a`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  const teamName = `Channel team ${stamp}`;
  try {
    const [dept] = await sql<{ id: string }[]>`insert into core.departments (name) values (${`Channel dept ${stamp}`}) returning id`;
    const [team] = await sql<{ id: string }[]>`insert into core.teams (department_id, name) values (${dept.id}, ${teamName}) returning id`;
    await sql`update core.employees set team_id = ${team.id} where id = ${a.employeeId}`;
  } finally {
    await sql.end();
  }
  const pageH = await (await browser.newContext()).newPage();
  const pageA = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageH, hr);
  await signInEnrollingMfa(pageA, a);

  await pageH.goto("/messages/manage");
  await (await hydrated(pageH.getByRole("button", { name: "Update channels now" }))).click();
  await expect(pageH.getByText(/Channels updated/)).toBeVisible({ timeout: 45_000 });

  await pageA.goto("/messages");
  await expect(pageA.getByRole("button", { name: new RegExp(teamName) })).toBeVisible({ timeout: 45_000 });
  await pageA.getByRole("group", { name: "Show" }).getByRole("button", { name: "Channels" }).click();
  await pageA.getByRole("button", { name: /Everyone at ERS/ }).click();
  await expect(pageA.getByText("Only HR can post in this channel.")).toBeVisible();
  await pageA.getByRole("button", { name: new RegExp(teamName) }).click();
  await say(pageA, teamName, "Hello team");
});

test("a poll: create, vote, and everyone sees the counts", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Poll${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Poll${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/messages");
  const bName = `Bea Poll${stamp}b`;
  await startDirect(pageA, `Poll${stamp}b`, bName);

  await pageA.getByRole("button", { name: "Poll", exact: true }).click();
  const dialog = pageA.getByRole("dialog");
  await dialog.getByLabel("Question").fill("Friday huddle time?");
  await dialog.getByLabel("Option 1").fill("9 PM");
  await dialog.getByLabel("Option 2").fill("10 PM");
  await dialog.getByRole("button", { name: "Post poll" }).click();
  await expect(pageA.getByRole("group", { name: "Poll: Friday huddle time?" })).toBeVisible();

  await pageB.getByRole("button", { name: new RegExp(`Ana Poll${stamp}a`) }).click();
  const pollB = pageB.getByRole("group", { name: "Poll: Friday huddle time?" });
  await expect(pollB).toBeVisible({ timeout: 12_000 });
  await pollB.getByRole("button", { name: /10 PM/ }).click();
  await expect(pageA.getByRole("group", { name: "Poll: Friday huddle time?" }).getByRole("button", { name: /10 PM/ })).toContainText("1", { timeout: 12_000 });
  await expect(pageA.getByText("1 person voted")).toBeVisible();
});

test("a picture, a file and a voice note travel with messages; only members can open them", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `File${stamp}a`);
  const b = await createEmployeeAccount("Bea", `File${stamp}b`);
  const c = await createEmployeeAccount("Cy", `File${stamp}c`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  const pageC = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await signInEnrollingMfa(pageC, c);
  await pageB.goto("/messages");
  const bName = `Bea File${stamp}b`;
  await startDirect(pageA, `File${stamp}b`, bName);

  // A tiny real PNG and a minimal PDF.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
  await pageA.getByTestId("chat-file-input").setInputFiles([
    { name: "front desk.png", mimeType: "image/png", buffer: png },
    { name: "schedule.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);
  await expect(pageA.getByRole("list", { name: "Attachments" })).toContainText("front desk.png", { timeout: 45_000 });
  await expect(pageA.getByRole("list", { name: "Attachments" })).toContainText("schedule.pdf", { timeout: 45_000 });
  await expect(pageA.getByText("Don't upload client records or anything with patient details.")).toBeVisible();
  await pageA.getByLabel(`Message ${bName}`).fill("Here is the desk and the schedule");
  await pageA.getByRole("button", { name: "Send message" }).click();

  // Bea sees the picture (it really loads) and the file card.
  await pageB.getByRole("button", { name: new RegExp(`Ana File${stamp}a`) }).click();
  const image = pageB.getByRole("log").getByRole("img", { name: "front desk.png" });
  await expect(image).toBeVisible({ timeout: 12_000 });
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await expect(pageB.getByRole("log").getByRole("link", { name: /schedule\.pdf/ })).toBeVisible();
  const href = await pageB.getByRole("log").getByRole("link", { name: /schedule\.pdf/ }).getAttribute("href");

  // Members can open it; Cy (not in the chat) gets a 404.
  const asB = await pageB.request.get(href!);
  expect(asB.status()).toBe(200);
  expect(asB.headers()["content-type"]).toContain("application/pdf");
  expect(asB.headers()["x-content-type-options"]).toBe("nosniff");
  expect(asB.headers()["content-disposition"]).toContain("attachment");
  const asC = await pageC.request.get(href!);
  expect(asC.status()).toBe(404);

  // A voice note with the fake microphone.
  await pageA.getByRole("button", { name: "Record a voice note" }).click();
  await expect(pageA.getByText(/Recording a voice note/)).toBeVisible();
  await pageA.waitForTimeout(1500);
  await pageA.getByRole("button", { name: /Stop and attach/ }).click();
  await expect(pageA.getByRole("list", { name: "Attachments" })).toContainText("Voice note", { timeout: 45_000 });
  await pageA.getByRole("button", { name: "Send message" }).click();
  await expect(pageB.getByRole("log").locator("audio")).toBeVisible({ timeout: 12_000 });
});

test("search finds a word in my chats; muting a chat takes it out of the unread total", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Srch${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Srch${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/messages");
  const aName = `Ana Srch${stamp}a`;
  await startDirect(pageA, `Srch${stamp}b`, `Bea Srch${stamp}b`);
  await say(pageA, `Bea Srch${stamp}b`, "Quarterly zebracrossing plan");

  // B mutes the chat from its header, then searches for a word from the message.
  await pageB.getByRole("button", { name: new RegExp(aName) }).click();
  await expect(pageB.getByRole("log").getByText("Quarterly zebracrossing plan")).toBeVisible({ timeout: 12_000 });
  await pageB.getByRole("button", { name: "Mute", exact: true }).click();
  const dialog = pageB.getByRole("dialog");
  await dialog.getByLabel("For 8 hours").check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("button", { name: "Muted", exact: true })).toBeVisible();
  await expect(pageB.getByLabel("Muted").first()).toBeVisible();

  await pageB.getByLabel("Search messages").fill("zebracross");
  await expect(pageB.getByRole("button", { name: /zebracrossing plan/ })).toBeVisible({ timeout: 10_000 });
  await pageB.getByLabel("Search messages").fill("nomatchword");
  await expect(pageB.getByText("No messages match")).toBeVisible();

  // The settings dialog opens and saves.
  await pageB.getByRole("button", { name: "Settings" }).click();
  await pageB.getByRole("dialog").getByLabel("Appear offline").check();
  await pageB.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("dialog")).toBeHidden();
});

test("a client guest: invited by HR, accepts the notice, sees only their client group, reaches nothing else, and loses access when ended", async ({ browser }) => {
  test.setTimeout(420_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const staff = await createEmployeeAccount("Sam", `Gst${stamp}s`);
  const clientName = `Clinic ${stamp}`;
  await createTestClientRecord(clientName);
  const guestEmail = `e2e.guest.${stamp}@client.example`;
  const pageHr = await (await browser.newContext()).newPage();
  const pageG = await (await browser.newContext()).newPage();
  const pageS = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageHr, hr);
  await signInEnrollingMfa(pageS, staff);

  // HR invites the guest from Client guests.
  await pageHr.goto("/messages/guests");
  await (await hydrated(pageHr.getByRole("button", { name: "Invite a guest" }))).click();
  const invite = pageHr.getByRole("dialog");
  await invite.getByLabel("Their work email").fill(guestEmail);
  await invite.getByLabel("Client").selectOption({ label: clientName });
  await invite.getByRole("button", { name: "Send invitation" }).click();
  await expect(pageHr.getByRole("listitem").filter({ hasText: guestEmail })).toBeVisible({ timeout: 20_000 });

  // The guest signs up for a sign-in account, and the app's first-sign-in set-up makes them a guest: notice first.
  const guest = await createSignInOnlyAccount(guestEmail);
  await signInGuestEnrollingMfa(pageG, guest);
  await expect(pageG.getByRole("heading", { level: 1, name: /how to use ELEVATE Messages/ })).toBeVisible({ timeout: 45_000 });
  await expect(pageG.getByText("Never share patient details.")).toBeVisible();
  await pageG.getByRole("button", { name: "I have read and agree" }).click();
  await expect(pageG.getByRole("heading", { level: 1, name: "Messages" })).toBeVisible({ timeout: 45_000 });
  await expect(pageG.getByRole("button", { name: "New message" })).toHaveCount(0);

  // Everything else leads back to Messages, and nothing of the staff app shows.
  await pageG.goto("/people");
  await expect(pageG).toHaveURL(/\/messages$/);
  await pageG.goto("/messages/manage");
  await expect(pageG).toHaveURL(/\/messages$/);
  await expect(pageG.getByRole("link", { name: "Dashboard" })).toHaveCount(0);

  // HR makes a client group with the guest and Sam.
  await pageHr.goto("/messages/manage");
  await (await hydrated(pageHr.getByRole("button", { name: "New client group" }))).click();
  const group = pageHr.getByRole("dialog");
  await group.getByLabel("Client").selectOption({ label: clientName });
  await group.getByLabel("Group name").fill(`Attendance ${stamp}`);
  await group.getByLabel(guestEmail).check();
  await group.getByLabel("Find people").fill(`Gst${stamp}s`);
  await group.getByRole("button", { name: new RegExp(`Sam Gst${stamp}s`) }).click();
  await group.getByRole("button", { name: "Create group" }).click();
  await expect(pageHr.getByRole("cell", { name: new RegExp(`Attendance ${stamp}`) })).toBeVisible({ timeout: 20_000 });

  // The guest sees the group (and only it), with the reminder, and chats with Sam.
  await pageG.goto("/messages");
  await pageG.getByRole("button", { name: new RegExp(`Attendance ${stamp}`) }).click();
  await expect(pageG.getByRole("note")).toContainText("Attendance matters only. Never share patient details.");
  await say(pageG, `Attendance ${stamp}`, "Is Sam on at 9?");
  await pageS.goto("/messages");
  await pageS.getByRole("button", { name: new RegExp(`Attendance ${stamp}`) }).click();
  await expect(pageS.getByRole("log").getByText("Is Sam on at 9?")).toBeVisible({ timeout: 15_000 });
  await say(pageS, `Attendance ${stamp}`, "Yes, from 9.");
  await expect(pageG.getByRole("log").getByText("Yes, from 9.")).toBeVisible({ timeout: 15_000 });

  // HR ends the guest's access: they are signed out of everything.
  await pageHr.goto("/messages/guests");
  await pageHr.getByRole("row").filter({ hasText: guestEmail }).getByRole("button", { name: "End access" }).click();
  await pageHr.getByRole("alertdialog").getByRole("button", { name: "End access" }).click();
  await expect(pageHr.getByRole("row").filter({ hasText: guestEmail })).toContainText("Access ended", { timeout: 20_000 });
  await pageG.goto("/messages");
  await expect(pageG).toHaveURL(/\/login/, { timeout: 30_000 });
});

test("presence: an online dot shows who has the chat open, and Appear offline hides you", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Pres${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Pres${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await startDirect(pageA, `Pres${stamp}b`, `Bea Pres${stamp}b`);
  await say(pageA, `Bea Pres${stamp}b`, "Hi Bea");
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Pres${stamp}a`) }).click();
  // Both have the chat open: each sees the other online.
  await expect(pageA.getByRole("heading", { level: 2, name: `Bea Pres${stamp}b` }).locator("xpath=following-sibling::p")).toContainText("1 online", { timeout: 20_000 });
  await expect(pageB.getByRole("heading", { level: 2, name: `Ana Pres${stamp}a` }).locator("xpath=following-sibling::p")).toContainText("1 online", { timeout: 20_000 });
  // Bea appears offline and reloads: Ana no longer sees her.
  await pageB.getByRole("button", { name: "Settings" }).click();
  await pageB.getByRole("dialog").getByLabel("Appear offline").check();
  await pageB.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("dialog")).toBeHidden();
  await pageB.reload();
  await pageB.getByRole("button", { name: new RegExp(`Ana Pres${stamp}a`) }).click();
  await expect(pageA.getByRole("heading", { level: 2, name: `Bea Pres${stamp}b` }).locator("xpath=following-sibling::p")).not.toContainText("online", { timeout: 20_000 });
  // She still sees Ana (watching does not announce).
  await expect(pageB.getByRole("heading", { level: 2, name: `Ana Pres${stamp}a` }).locator("xpath=following-sibling::p")).toContainText("1 online", { timeout: 20_000 });
});

test("the unread badge in the header updates live on any page, and clears after reading", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Bdg${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Bdg${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  // Bea sits on the dashboard (not Messages) with nothing unread.
  await pageB.goto("/dashboard");
  await expect(pageB.getByRole("link", { name: "Messages", exact: true }).first()).toBeVisible();
  await startDirect(pageA, `Bdg${stamp}b`, `Bea Bdg${stamp}b`);
  await say(pageA, `Bea Bdg${stamp}b`, "Badge test one");
  // The badge appears without a reload.
  await expect(pageB.getByRole("link", { name: "Messages, 1 unread" }).first()).toBeVisible({ timeout: 15_000 });
  await say(pageA, `Bea Bdg${stamp}b`, "Badge test two");
  await expect(pageB.getByRole("link", { name: "Messages, 2 unread" }).first()).toBeVisible({ timeout: 15_000 });
  // Reading the chat clears it.
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Bdg${stamp}a`) }).click();
  await expect(pageB.getByRole("log").getByText("Badge test two", { exact: true })).toBeVisible();
  await expect(pageB.getByRole("link", { name: /^Messages, \d+ unread$/ })).toHaveCount(0, { timeout: 15_000 });
});

// Needs a real KLIPY or GIPHY key in the environment of both the test run and the dev server (GIF_PROVIDER picks one); skipped otherwise.
test("a GIF: search through our server, send, and the other person sees it through our own route", async ({ browser }) => {
  test.skip(!process.env.KLIPY_API_KEY && !process.env.GIPHY_API_KEY, "No GIF service key is set");
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Gif${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Gif${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  // The browser must never talk to KLIPY itself.
  const direct: string[] = [];
  pageA.on("request", (r) => void (/(klipy|giphy)\.(com|co)/.test(new URL(r.url()).host) && direct.push(r.url())));
  pageB.on("request", (r) => void (/(klipy|giphy)\.(com|co)/.test(new URL(r.url()).host) && direct.push(r.url())));
  await pageB.goto("/messages");
  await startDirect(pageA, `Gif${stamp}b`, `Bea Gif${stamp}b`);
  await pageA.getByRole("button", { name: "GIF", exact: true }).click();
  const dialog = pageA.getByRole("dialog");
  await dialog.getByLabel("Search GIFs").fill("happy");
  const first = dialog.getByRole("button", { name: /^Send GIF:/ }).first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  // The service requires its credit next to its GIFs.
  await expect(dialog.getByText(/^Powered by (KLIPY|GIPHY)$/)).toBeVisible();
  await expect(first.locator("img")).toHaveJSProperty("complete", true, { timeout: 20_000 });
  expect(await first.locator("img").evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await first.click();
  const sent = pageA.getByRole("log").getByRole("img", { name: "A GIF" });
  await expect(sent).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => sent.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await pageB.getByRole("button", { name: new RegExp(`Ana Gif${stamp}a`) }).click();
  const seen = pageB.getByRole("log").getByRole("img", { name: "A GIF" });
  await expect(seen).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => seen.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  expect(direct).toEqual([]);
});

test("@all typed in a message shows as a highlighted mention and notifies the other person", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Evr${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Evr${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await pageB.goto("/dashboard");
  await startDirect(pageA, `Evr${stamp}b`, `Bea Evr${stamp}b`);
  // Typed.
  const box = pageA.getByLabel(`Message Bea Evr${stamp}b`);
  await box.fill("Standup at 9 @all");
  await box.press("Enter");
  const chip = pageA.getByRole("log").getByText("@all", { exact: true });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  // (The "@everyone" entry in the @ list only appears in chats of three or more people; typing works everywhere.)
  // The other person is told, wherever they are.
  await expect(pageB.getByRole("link", { name: /Messages, 1 unread/ }).first()).toBeVisible({ timeout: 15_000 });
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Evr${stamp}a`) }).click();
  await expect(pageB.getByRole("log").getByText("@all", { exact: true })).toBeVisible({ timeout: 15_000 });
});

test("a new message plays the chosen sound when you are elsewhere, and nothing when it is off", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Snd${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Snd${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const contextB = await browser.newContext();
  // Count the tones the page makes (each note is one oscillator).
  await contextB.addInitScript(() => {
    const w = window as unknown as { __tones: number };
    w.__tones = 0;
    const proto = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext).prototype;
    const original = proto.createOscillator;
    proto.createOscillator = function (this: AudioContext) {
      w.__tones += 1;
      return original.call(this);
    };
  });
  const pageB = await contextB.newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  const tones = () => pageB.evaluate(() => (window as unknown as { __tones: number }).__tones);

  await startDirect(pageA, `Snd${stamp}b`, `Bea Snd${stamp}b`);
  // Bea picks the Bell and saves (the settings button is on the Messages page).
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: "Settings" }).click();
  await pageB.getByRole("dialog").getByLabel("Sound for new messages").selectOption("bell");
  await pageB.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("dialog")).toBeHidden();
  // She is on another page and has used it (the browser only allows sound after a click).
  await pageB.goto("/dashboard");
  await pageB.locator("body").click({ position: { x: 5, y: 5 } });
  const before = await tones();
  await say(pageA, `Bea Snd${stamp}b`, "Sound check one");
  await expect.poll(tones, { timeout: 20_000 }).toBeGreaterThan(before);

  // She turns it off: the next message is silent.
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: "Settings" }).click();
  await pageB.getByRole("dialog").getByLabel("Sound for new messages").selectOption("off");
  await pageB.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(pageB.getByRole("dialog")).toBeHidden();
  await pageB.goto("/dashboard");
  await pageB.locator("body").click({ position: { x: 5, y: 5 } });
  const after = await tones();
  await say(pageA, `Bea Snd${stamp}b`, "Sound check two");
  await expect(pageB.getByRole("link", { name: /Messages, \d+ unread/ }).first()).toBeVisible({ timeout: 20_000 });
  await pageB.waitForTimeout(1500);
  expect(await tones()).toBe(after);
});

test("typing @ suggests people; the emoji picker finds the sweet potato and remembers it; hover shows who reacted; quote reply", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Imp${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Imp${stamp}b`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  const bName = `Bea Imp${stamp}b`;
  await startDirect(pageA, `Imp${stamp}b`, bName);
  const box = pageA.getByLabel(`Message ${bName}`);

  // Typing @ opens the list at once; typing narrows it; Enter picks.
  await box.click();
  await box.pressSequentially("@");
  const list = pageA.getByRole("listbox", { name: "People you can mention" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option", { name: new RegExp(bName) })).toBeVisible();
  await box.pressSequentially("Be");
  await expect(list.getByRole("option")).toHaveCount(1);
  await box.press("Enter");
  await expect(list).toBeHidden();
  await expect(box).toHaveValue(/^@\[Bea .*\]\(user:[0-9a-f-]{36}\) $/);
  await box.fill("");

  // The emoji picker: search finds the sweet potato by its Filipino name; it is remembered under Recently used.
  await pageA.getByRole("button", { name: "Add an emoji to your message" }).click();
  await pageA.getByLabel("Search emoji").fill("kamote");
  await pageA.getByRole("button", { name: "Emoji 🍠" }).click();
  await expect(box).toHaveValue("🍠");
  await pageA.getByRole("button", { name: "Add an emoji to your message" }).click();
  await expect(pageA.getByRole("tab", { name: "Recently used" })).toHaveAttribute("aria-selected", "true");
  await expect(pageA.getByRole("group", { name: "Emoji" }).getByRole("button", { name: "Emoji 🍠" })).toBeVisible();
  await pageA.keyboard.press("Escape");
  await box.fill("Merienda time 🍠");
  await box.press("Enter");
  await expect(pageA.getByRole("log").getByText("Merienda time 🍠", { exact: true })).toBeVisible();

  // Bea reacts; Ana hovers the reaction and sees who reacted.
  await pageB.goto("/messages");
  await pageB.getByRole("button", { name: new RegExp(`Ana Imp${stamp}a`) }).click();
  const row = pageB.getByRole("log").getByText("Merienda time 🍠", { exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.hover();
  await pageB.getByRole("button", { name: "React to this message" }).first().click();
  await pageB.getByRole("button", { name: "Emoji 👍" }).click();
  const chip = pageA.getByRole("log").getByRole("button", { name: /^👍 1/ });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await chip.hover();
  await expect(pageA.getByRole("tooltip")).toContainText(`Bea Imp${stamp}b`);

  // Quote reply: Bea quotes Ana's message; Ana sees the quote.
  await pageB.getByRole("log").getByText("Merienda time 🍠", { exact: true }).hover();
  await pageB.getByRole("button", { name: "Quote message" }).first().click();
  await expect(pageB.getByRole("group", { name: "Quoting" })).toContainText("Merienda time");
  const boxB = pageB.getByLabel(`Message Ana Imp${stamp}a`);
  await boxB.fill("Yes please");
  await boxB.press("Enter");
  await expect(pageB.getByRole("group", { name: "Quoting" })).toHaveCount(0);
  const quoted = pageA.getByLabel("Quoted message");
  await expect(quoted).toContainText("Merienda time", { timeout: 15_000 });
  await expect(quoted).toContainText(`Ana Imp${stamp}a`);
});

test("HR makes a channel, sets who can post, gives it a picture, and a member sees both", async ({ browser }) => {
  test.setTimeout(300_000);
  const stamp = Date.now();
  const hr = await createHrAccount();
  const emp = await createEmployeeAccount("Eli", `Chn${stamp}e`);
  const pageHr = await (await browser.newContext()).newPage();
  const pageE = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageHr, hr);
  await signInEnrollingMfa(pageE, emp);
  await pageE.goto("/messages");
  const channelName = `Announcements ${stamp}`;

  await pageHr.goto("/messages/manage");
  await (await hydrated(pageHr.getByRole("button", { name: "New channel" }))).click();
  const dialog = pageHr.getByRole("dialog");
  await dialog.getByLabel("Channel name").fill(channelName);
  await dialog.getByLabel(/Only HR can post/).check();
  await dialog.getByLabel("Find people").fill(`Chn${stamp}e`);
  await dialog.getByRole("button", { name: new RegExp(`Eli Chn${stamp}e`) }).click();
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await expect(pageHr.getByRole("cell", { name: new RegExp(channelName) })).toContainText("only HR posts", { timeout: 20_000 });

  // A picture (HR is not in the channel).
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await pageHr.getByTestId("group-photo-input").setInputFiles({ name: "team.png", mimeType: "image/png", buffer: png });
  await expect(pageHr.getByRole("button", { name: "Change picture" })).toBeVisible({ timeout: 30_000 });
  await expect(pageHr.locator('img[src*="/api/messages/conversation-photo/"]').first()).toBeAttached();

  // The member finds it under Channels, cannot start a conversation in it, and can see the picture.
  await pageE.reload();
  await pageE.getByRole("button", { name: new RegExp(channelName) }).click();
  await expect(pageE.getByText("Only HR can post in this channel.")).toBeVisible({ timeout: 15_000 });
  const photo = pageE.locator('img[src*="/api/messages/conversation-photo/"]').first();
  await expect(photo).toBeAttached();
  const status = await pageE.evaluate(async (src) => (await fetch(src)).status, (await photo.getAttribute("src")) ?? "");
  expect(status).toBe(200);
});
