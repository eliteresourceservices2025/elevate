import { expect, test } from "@playwright/test";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. Each manager view is a bento grid with its own tiles.

async function regions(page: import("@playwright/test").Page, names: string[]) {
  for (const name of names) await expect(page.getByRole("region", { name, exact: true })).toBeVisible({ timeout: 30_000 });
}

test("a team lead sees the lead tiles and their own Me strip, and a plain employee does not", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const lead = await createEmployeeAccount("Lena", `Lead${stamp}`, { roles: ["team_lead"] });
  await createEmployeeAccount("Rae", `ReportA${stamp}`, { managerId: lead.employeeId });
  await createEmployeeAccount("Sam", `ReportB${stamp}`, { managerId: lead.employeeId });

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, lead);
  await regions(page, ["Me", "Needs your decision", "Team hours", "Clocked in now", "Team flags", "Celebrations", "Who is out", "Reviews and goals due"]);
  await expect(page.getByRole("region", { name: "Clocked in now", exact: true })).toContainText("of 2");
  await expect(page.getByRole("region", { name: "Key numbers" })).toHaveCount(0);

  const emp = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(emp, await createEmployeeAccount("Plain", `Worker${stamp}`));
  await expect(emp.getByRole("region", { name: "Team hours", exact: true })).toHaveCount(0);
  await expect(emp.getByRole("region", { name: "Needs your decision", exact: true })).toHaveCount(0);
});
