import { expect, test, type Page } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

// HR access to a chat they are not in: an HR Admin asks, a DIFFERENT Super Admin approves, the HR Admin reads it read-only. Everyone else gets a 404.

async function say(page: Page, label: string, text: string) {
  const box = page.getByLabel(`Message ${label}`);
  await box.fill(text);
  await expect(async () => {
    if ((await box.inputValue()) !== "") await box.press("Enter");
    await expect(page.getByRole("log").getByText(text, { exact: true })).toBeVisible({ timeout: 2_500 });
  }).toPass({ timeout: 15_000 });
}

const phoenixToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });

test("HR asks to read a chat, a different Super Admin approves, HR reads it read-only; everyone else gets a 404", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const maker = await createHrAccount(); // makes the group and is in it
  const hr = await createHrAccount(); // asks, is not in the group
  const sue = await createEmployeeAccount("Sue", `Acs${stamp}`, { roles: ["super_admin"] });
  const a = await createEmployeeAccount("Ana", `Acc${stamp}a`);
  const b = await createEmployeeAccount("Bea", `Acc${stamp}b`);
  const c = await createEmployeeAccount("Cy", `Acc${stamp}c`);
  const pageM = await (await browser.newContext()).newPage();
  const pageH = await (await browser.newContext()).newPage();
  const pageS = await (await browser.newContext()).newPage();
  const pageA = await (await browser.newContext()).newPage();
  for (const [page, account] of [[pageM, maker], [pageH, hr], [pageS, sue], [pageA, a]] as const) await signInEnrollingMfa(page, account);
  void b;
  void c;

  // The group exists, with something said in it.
  const title = `Secret ${stamp}`;
  const words = `the plan is private ${stamp}`;
  await pageM.goto("/messages");
  await (await hydrated(pageM.getByRole("button", { name: "New message" }))).click();
  const dialog = pageM.getByRole("dialog");
  await dialog.getByRole("button", { name: "Group" }).click();
  await dialog.getByLabel("Group name").fill(title);
  await dialog.getByLabel("Find people").fill(`Acc${stamp}`);
  await dialog.getByRole("button", { name: "Add everyone shown (3)" }).click();
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(pageM.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 45_000 });
  await say(pageM, title, words);

  // HR (not in the group) asks to read it, for today.
  await pageH.goto("/messages");
  await pageH.getByRole("link", { name: "Chat access" }).click();
  await expect(pageH.getByRole("heading", { level: 1, name: "Chat access" })).toBeVisible({ timeout: 45_000 });
  await (await hydrated(pageH.getByRole("button", { name: "Ask to read a chat" }))).click();
  const form = pageH.getByRole("dialog");
  const value = await form.locator("#access-chat option", { hasText: title }).getAttribute("value");
  await form.getByLabel("Chat", { exact: true }).selectOption(value!);
  await form.getByLabel("First day").fill(phoenixToday());
  await form.getByLabel("Last day").fill(phoenixToday());
  await form.getByLabel("Why do you need to read it?").fill("A complaint about conduct in this chat.");
  await form.getByRole("button", { name: "Send request" }).click();
  const mine = pageH.getByTestId("access-request").first();
  await expect(mine).toHaveAttribute("data-state", "pending", { timeout: 30_000 });
  await expect(mine).toContainText(title);
  // Nothing opens yet, and HR cannot decide their own request.
  await expect(mine.getByRole("link", { name: "Read the messages" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);

  // A different Super Admin sees the reason and approves (after a confirmation).
  await pageS.goto("/messages/access");
  const theirs = pageS.getByTestId("access-request").filter({ hasText: title });
  await expect(theirs).toContainText("A complaint about conduct in this chat.", { timeout: 45_000 });
  await (await hydrated(theirs.getByRole("button", { name: "Approve" }))).click();
  await pageS.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
  await expect(theirs).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  // The Super Admin who approved cannot read it.
  await expect(theirs.getByRole("link", { name: "Read the messages" })).toHaveCount(0);

  // HR reads it: read-only, with the words that were said.
  await pageH.reload();
  const open = pageH.getByTestId("access-request").filter({ hasText: title });
  await expect(open).toHaveAttribute("data-state", "approved", { timeout: 30_000 });
  await open.getByRole("link", { name: "Read the messages" }).click();
  await expect(pageH.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 45_000 });
  await expect(pageH.getByText("Read-only.")).toBeVisible();
  await expect(pageH.getByTestId("access-message").filter({ hasText: words })).toBeVisible();
  await expect(pageH.getByLabel(`Message ${title}`)).toHaveCount(0); // no composer
  const viewerUrl = pageH.url();

  // Everyone else: the Super Admin, a member and the page for people without access are all 404s.
  expect((await pageS.goto(viewerUrl))?.status()).toBe(404);
  expect((await pageA.goto(viewerUrl))?.status()).toBe(404);
  expect((await pageA.goto("/messages/access"))?.status()).toBe(404);
});
