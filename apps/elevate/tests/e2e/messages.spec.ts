import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

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
  await box.press("Enter");
  await expect(page.getByRole("log").getByText(text, { exact: true })).toBeVisible();
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
