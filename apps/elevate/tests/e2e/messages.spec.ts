import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, hydrated, signInEnrollingMfa } from "./helpers";

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

test("a group of three: everyone sees messages, and a person who leaves stops getting them", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();
  const a = await createEmployeeAccount("Ana", `Grp${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Grp${stamp}b`);
  const c = await createEmployeeAccount("Cy", `Grp${stamp}c`);
  const pageA = await (await browser.newContext()).newPage();
  const pageB = await (await browser.newContext()).newPage();
  const pageC = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pageA, a);
  await signInEnrollingMfa(pageB, b);
  await signInEnrollingMfa(pageC, c);
  await pageB.goto("/messages");
  await pageC.goto("/messages");

  const title = `Crew ${stamp}`;
  await pageA.goto("/messages");
  await (await hydrated(pageA.getByRole("button", { name: "New message" }))).click();
  const dialog = pageA.getByRole("dialog");
  await dialog.getByRole("button", { name: "Group" }).click();
  await dialog.getByLabel("Group name").fill(title);
  await dialog.getByLabel("Find people").fill(`Grp${stamp}`);
  await dialog.getByRole("button", { name: new RegExp(`Bea Grp${stamp}b`) }).click();
  await dialog.getByRole("button", { name: new RegExp(`Cy Grp${stamp}c`) }).click();
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(pageA.getByRole("heading", { level: 2, name: title })).toBeVisible();

  await say(pageA, title, "Welcome to the crew");
  for (const page of [pageB, pageC]) {
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible({ timeout: 12_000 });
    await expect(page.getByRole("button", { name: new RegExp(title) })).toContainText("Welcome to the crew");
  }

  // C opens the chat, then leaves it; later messages never reach C.
  await pageC.getByRole("button", { name: new RegExp(title) }).click();
  await pageC.getByRole("button", { name: "Show people in this chat" }).click();
  await pageC.getByRole("button", { name: "Leave group" }).click();
  await pageC.getByRole("alertdialog").getByRole("button", { name: "Leave group" }).click();
  await expect(pageC.getByRole("button", { name: new RegExp(title) })).toHaveCount(0, { timeout: 12_000 });

  await say(pageA, title, "Only two of us now");
  await expect(pageB.getByRole("button", { name: new RegExp(title) })).toContainText("Only two of us now", { timeout: 12_000 });
  await pageC.goto("/messages");
  await expect(pageC.getByText(title)).toHaveCount(0);
});
