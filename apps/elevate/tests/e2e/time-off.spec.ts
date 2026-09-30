import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. HR awards prize days; the employee sees the balance, the
// history and the holidays that apply to them; HR sees the ledger line and the holiday calendars.
test("HR awards prize days and the employee sees them, with the holiday calendars", async ({ browser }) => {
  const stamp = Date.now();
  const employee = await createEmployeeAccount("Toby", `Prize${stamp}`);
  const hr = await createHrAccount();

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  let label: string;
  try {
    const [e] = await sql<{ employee_number: string }[]>`select employee_number from core.employees where id = ${employee.employeeId}`;
    label = `Toby Prize${stamp} (${e.employee_number})`;
  } finally {
    await sql.end();
  }

  const hrPage = await (await browser.newContext()).newPage();
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await signInEnrollingMfa(empPage, employee);

  // The employee starts with nothing
  await empPage.goto("/time-off");
  await expect(empPage.getByText("You have no prize days yet.")).toBeVisible();
  await expect(empPage.getByRole("link", { name: "Award" })).toHaveCount(0); // HR-only tabs are not offered

  // HR awards two days with an expiry
  await hrPage.goto("/time-off?tab=award");
  await hrPage.getByLabel("Person").first().fill(label);
  await hrPage.getByLabel("Days", { exact: true }).selectOption("2");
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await hrPage.getByLabel("Use by (optional)").fill(in30);
  await hrPage.getByLabel("Game or reason").fill("E2E trivia night");
  await hrPage.getByRole("button", { name: "Award", exact: true }).click();
  await expect(hrPage.getByText("Prize days awarded.")).toBeVisible();

  // The employee sees the balance, when it expires, and the line in the history
  await empPage.goto("/time-off");
  await expect(empPage.getByLabel("Prize day off balance: 2 days")).toBeVisible();
  await expect(empPage.getByText("must be used by")).toBeVisible();
  const history = empPage.getByRole("region", { name: "History" });
  await expect(history.getByRole("row").filter({ hasText: "E2E trivia night" })).toContainText("Prize awarded");
  await expect(empPage.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();

  // HR sees the same ledger on the person's page and in the balances list
  await hrPage.goto("/time-off?tab=balances");
  await hrPage.getByRole("link", { name: `Toby Prize${stamp}` }).click();
  await hrPage.waitForURL(`**/time-off/${employee.employeeId}`);
  await expect(hrPage.getByRole("region", { name: "History" }).getByRole("row").filter({ hasText: "E2E trivia night" })).toContainText("+2");

  // Holidays: the employee sees the Philippine calendar only (no US client), HR sees both and what to verify
  await empPage.goto("/time-off?tab=holidays&year=2026");
  await expect(empPage.getByRole("row").filter({ hasText: "Christmas Day" })).toContainText("Philippines");
  await expect(empPage.getByRole("row").filter({ hasText: "Thanksgiving Day" })).toHaveCount(0);
  await hrPage.goto("/time-off?tab=holidays&year=2026");
  await expect(hrPage.getByRole("row").filter({ hasText: "Thanksgiving Day" })).toContainText("United States");
  await expect(hrPage.getByRole("row").filter({ hasText: "Araw ng Kagitingan" })).toContainText("Verify");
});
