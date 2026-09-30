import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. Creates throwaway fake data in the local database.
test("HR builds a team and a reporting line, and the org chart shows it", async ({ page }) => {
  const account = await createHrAccount();
  await signInEnrollingMfa(page, account);

  const stamp = Date.now();
  const deptName = `E2E Dept ${stamp}`;
  const teamName = `E2E Team ${stamp}`;
  const positionTitle = `E2E Analyst ${stamp}`;

  // Structure: department, team, position
  await page.goto("/people/structure");
  await page.getByLabel("New department").fill(deptName);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: deptName }).first()).toBeVisible();

  await page.getByLabel("New team").fill(teamName);
  await page.getByLabel("Department", { exact: true }).first().selectOption({ label: deptName });
  await page.getByRole("button", { name: "Add team" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: teamName }).first()).toBeVisible();

  await page.getByLabel("New position").fill(positionTitle);
  await page.getByRole("button", { name: "Add position" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: positionTitle }).first()).toBeVisible();

  // A manager, then someone who reports to them
  async function addPerson(first: string, last: string, extra?: { manager: string }) {
    await page.goto("/people/new");
    await page.getByLabel("Legal first name").fill(first);
    await page.getByLabel("Legal last name").fill(last);
    await page.getByLabel("Work email").fill(`${first}.${last}.${stamp}@example.com`.toLowerCase());
    await page.getByLabel("Position", { exact: true }).selectOption({ label: positionTitle });
    await page.getByLabel("Team", { exact: true }).selectOption({ label: teamName });
    if (extra) await page.getByLabel("Manager").fill(extra.manager);
    await page.getByRole("button", { name: "Add person" }).click();
    await page.waitForURL(/\/people\/[0-9a-f-]{36}$/);
    const number = (await page.getByText(/^ERS-\d{4}$/).first().textContent())!.trim();
    return number;
  }

  const bossLast = `Boss${stamp}`;
  const reportLast = `Report${stamp}`;
  const bossNumber = await addPerson("Bianca", bossLast);
  await addPerson("Rafael", reportLast, { manager: `Bianca ${bossLast} (${bossNumber})` });

  // The profile shows the team and the manager
  await page.getByRole("link", { name: "Employment" }).click();
  await expect(page.getByText(`Bianca ${bossLast}`).first()).toBeVisible();
  await expect(page.getByText(teamName).first()).toBeVisible();

  // The list view nests the report under the manager
  await page.goto("/org-chart?view=list");
  const list = page.getByRole("list", { name: "Organization list" });
  await expect(list.getByRole("link", { name: `Bianca ${bossLast}` })).toBeVisible();
  await expect(list.getByRole("link", { name: `Rafael ${reportLast}` })).toBeVisible();

  // The chart renders people as buttons; search finds a person and centers the view on them
  await page.goto("/org-chart");
  await expect(page.getByRole("region", { name: "Organization chart" })).toBeVisible();
  const card = (first: string, last: string) => page.getByRole("button", { name: `${first} ${last}, ` });
  await expect(card("Bianca", bossLast)).toBeVisible();
  await expect(card("Rafael", reportLast)).toBeVisible();

  // Search finds a person and centers the view on them
  const search = async () => {
    await page.getByLabel("Find a person on the chart").fill("");
    await page.getByLabel("Find a person on the chart").fill(reportLast);
    await page.getByRole("list", { name: "Search results" }).getByRole("button", { name: `Rafael ${reportLast}` }).click();
  };
  await search();
  await expect(card("Rafael", reportLast)).toBeVisible();

  // Collapsing the manager hides the report...
  // dispatchEvent: the toggle is tiny and the chart pans, which trips Playwright's pixel-stability wait
  await page.getByRole("button", { name: `Hide 1 person under Bianca ${bossLast}` }).dispatchEvent("click");
  await expect(card("Rafael", reportLast)).toHaveCount(0);

  // ...and searching for the report opens the branch again
  await search();
  await expect(card("Rafael", reportLast)).toBeVisible();
});
