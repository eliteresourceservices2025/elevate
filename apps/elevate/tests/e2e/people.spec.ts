import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase (`supabase start`) with migrations applied (`pnpm db:migrate`).
// Creates a throwaway HR account and one fake person; both stay in the local database.
test("HR adds a person, saves an encrypted ID, and reveals it", async ({ page }) => {
  const account = await createHrAccount();
  await signInEnrollingMfa(page, account);

  const stamp = Date.now();
  const lastName = `E2e${stamp}`;

  // Add a person
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Erika");
  await page.getByLabel("Legal last name").fill(lastName);
  await page.getByLabel("Work email").fill(`erika.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: `Erika ${lastName}` })).toBeVisible();

  // Save a TIN: it is encrypted, so it shows masked
  await page.getByRole("link", { name: "Government IDs" }).click();
  await page.getByLabel("TIN", { exact: true }).fill("123456789012");
  await page.getByRole("button", { name: "Save encrypted values" }).click();
  await expect(page.getByText("••••••••9012")).toBeVisible();

  // Reveal decrypts it on request
  await page.getByRole("button", { name: "Reveal TIN" }).click();
  await expect(page.getByText("123-456-789-012")).toBeVisible();

  // The history lists the change without the value
  await page.getByRole("link", { name: "History" }).click();
  await expect(page.getByText("TIN updated")).toBeVisible();
  await expect(page.getByText("123-456-789-012")).toHaveCount(0);

  // And the directory finds the person
  await page.goto(`/people?q=${lastName}`);
  await expect(page.getByRole("link", { name: `Erika ${lastName}` })).toBeVisible();
});

test("HR finds where to add a client, adds one, and assigns it to a person", async ({ page }) => {
  test.setTimeout(120_000);
  const slow = { timeout: 30_000 };
  await signInEnrollingMfa(page, await createHrAccount());
  const stamp = Date.now();

  // The People page links to Clients (it used to be reachable only by typing the address)
  await page.goto("/people");
  await page.getByRole("link", { name: "Clients", exact: true }).click();
  await page.waitForURL("**/people/clients", slow);
  await waitForHydration(page, "#nc-name");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).colorScheme)).toBe("dark");
  await page.getByRole("combobox", { name: "Holidays" }).selectOption("PH");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect.poll(() => page.locator("html").evaluate((el) => getComputedStyle(el).colorScheme)).toBe("light");
  await page.getByRole("combobox", { name: "Holidays" }).selectOption("US");
  await page.getByLabel("Client name").fill(`E2E Client ${stamp}`);
  await page.getByRole("button", { name: "Time zone" }).click();
  await expect(page.getByRole("option", { name: "Asia/Manila" })).toBeVisible();
  await page.getByRole("combobox", { name: "Search time zones" }).fill("Europe/London");
  await page.getByRole("option", { name: "Europe/London" }).click();
  await expect(page.getByRole("button", { name: "Time zone" })).toContainText("Europe/London");
  await page.getByRole("button", { name: /Add client/ }).click();
  const clientRow = page.getByRole("listitem").filter({ hasText: `E2E Client ${stamp}` });
  await expect(clientRow).toContainText("Europe/London", slow);
  await clientRow.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Time zone" }).last().click();
  await page.getByRole("combobox", { name: "Search time zones" }).fill("Asia/Tokyo");
  await page.getByRole("combobox", { name: "Search time zones" }).press("ArrowDown");
  await page.getByRole("combobox", { name: "Search time zones" }).press("Enter");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(clientRow).toContainText("Asia/Tokyo", slow);
  await page.getByLabel("Client name").fill(`E2E Other Client ${stamp}`);
  await page.getByRole("button", { name: /Add client/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: `E2E Other Client ${stamp}` })).toBeVisible(slow);

  // A person, then assign the new client from their profile (which also links back to Clients)
  await page.goto("/people/new");
  await page.getByLabel("Legal first name").fill("Cleo");
  await page.getByLabel("Legal last name").fill(`Client${stamp}`);
  await page.getByLabel("Work email").fill(`cleo.${stamp}@example.com`);
  await page.getByRole("button", { name: "Add person" }).click();
  await page.waitForURL(/\/people\/[0-9a-f-]{36}$/, slow);
  await page.getByRole("link", { name: "Client assignments" }).click();
  await expect(page.getByRole("link", { name: "Add a client" })).toBeVisible(slow);
  await page.getByLabel("Client", { exact: true }).selectOption({ label: `E2E Client ${stamp}` });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByText(`E2E Client ${stamp}`).first()).toBeVisible(slow);
  const assignmentRow = page.getByRole("row").filter({ hasText: `E2E Client ${stamp}` });
  await assignmentRow.getByRole("button", { name: "Edit assignment" }).click();
  await page.getByRole("dialog", { name: "Edit assignment" }).getByRole("spinbutton", { name: "Hours per week" }).fill("20.5");
  await page.getByRole("dialog", { name: "Edit assignment" }).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E Client.*20\.5/ })).toBeVisible(slow);
  await expect(page.getByRole("button", { name: "End", exact: true })).toBeVisible();
  await assignmentRow.getByRole("button", { name: "Edit assignment" }).click();
  const editor = page.getByRole("dialog", { name: "Edit assignment" });
  await expect(editor.getByRole("spinbutton", { name: "Hours per week" })).toHaveValue("20.5");
  await expect(editor.getByRole("link", { name: "rename a client for everyone" })).toHaveAttribute("href", "/people/clients");
  await editor.getByRole("combobox", { name: "Assigned client" }).selectOption({ label: `E2E Other Client ${stamp}` });
  await editor.getByLabel("Start date").fill("2026-09-01");
  await editor.getByLabel("End date (optional)").fill("2026-10-01");
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("Earlier exports, approvals"); await dialog.accept(); });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E Other Client.*Sep.*Oct.*20\.5/ })).toBeVisible(slow);
  await page.reload();
  await page.getByRole("link", { name: "Client assignments" }).click();
  const endedRow = page.getByRole("row").filter({ hasText: `E2E Other Client ${stamp}` });
  await endedRow.getByRole("button", { name: "Edit assignment" }).click();
  const endedEditor = page.getByRole("dialog", { name: "Edit assignment" });
  await endedEditor.getByLabel("End date (optional)").fill("2026-10-02");
  page.once("dialog", (dialog) => dialog.accept());
  await endedEditor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("row", { name: /E2E Other Client.*Oct 2.*20\.5/ })).toBeVisible(slow);
  await page.reload();
  await page.getByRole("link", { name: "Client assignments" }).click();
  await expect(page.getByRole("row", { name: /E2E Other Client.*Oct 2.*20\.5/ })).toBeVisible(slow);
  await page.setViewportSize({ width: 375, height: 780 });
  await endedRow.getByRole("button", { name: "Edit assignment" }).click();
  await expect(page.getByRole("dialog", { name: "Edit assignment" }).getByLabel("Assigned client")).toBeVisible();
  await expect(page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)).resolves.toBe(true);
  await page.getByRole("dialog", { name: "Edit assignment" }).getByRole("link", { name: "rename a client for everyone" }).click();
  await page.waitForURL("**/people/clients", slow);
  await expect(page.getByRole("listitem").filter({ hasText: `E2E Client ${stamp}` }).getByRole("button", { name: "Edit" })).toBeVisible(slow);
});
