import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

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

test("HR sees six number tiles and the HR tiles", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createHrAccount());
  // This account has no people record, so there is no Me strip (and no crash).
  await regions(page, ["Active", "Onboarding", "Offboarding", "Change requests", "Docs expiring", "Training overdue", "Needs your decision", "Risks", "Onboarding and offboarding", "Needs attention", "Who is out", "Celebrations"]);
  await expect(page.getByRole("region", { name: "Key numbers" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Active", exact: true })).toContainText(/\d/);
});

test("an executive sees headline tiles with counts only: no person's name outside Celebrations", async ({ browser }) => {
  test.setTimeout(180_000);
  const stamp = Date.now().toString(36);
  const exec = await createEmployeeAccount("Exa", `Exec${stamp}`, { roles: ["executive"] });
  const newcomer = await createEmployeeAccount("Zelda", `Quirkson${stamp}`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`update core.employees set start_date = (now() at time zone 'America/Phoenix')::date where id = ${newcomer.employeeId}`;
  } finally {
    await sql.end();
  }

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, exec);
  const names = ["Me", "Headcount and movement", "Hiring pipeline", "Training compliance", "Risks", "System health", "Time off this week", "Celebrations"];
  await regions(page, names);
  await expect(page.getByRole("region", { name: "Celebrations", exact: true })).toContainText("Zelda");
  for (const name of names.filter((n) => n !== "Celebrations" && n !== "Me")) {
    await expect(page.getByRole("region", { name, exact: true })).not.toContainText("Zelda");
    await expect(page.getByRole("region", { name, exact: true })).not.toContainText("Quirkson");
  }
  await expect(page.getByRole("region", { name: "System health", exact: true })).toContainText(/on time|late/);
});

test("a recruiter sees the hiring tiles", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Rex", `Recruit${Date.now().toString(36)}`, { roles: ["recruiter"] }));
  await regions(page, ["Me", "Pipeline by stage", "Offers pending", "Interviews", "New applicants waiting", "Open roles", "Talent pool", "Celebrations"]);
  await expect(page.getByRole("region", { name: "Offers pending", exact: true })).toContainText("Awaiting signature");
  await expect(page.getByRole("region", { name: "Needs your decision", exact: true })).toHaveCount(0);
});

test("a Super Admin sees the admin tiles with counts only", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Ada", `Admin${Date.now().toString(36)}`, { roles: ["super_admin"] }));
  await regions(page, ["Me", "System health", "Risks", "Needs your decision", "Access", "Audit highlights", "Celebrations"]);
  await expect(page.getByRole("region", { name: "Access", exact: true })).toContainText("Invitations pending");
  await expect(page.getByRole("region", { name: "Audit highlights", exact: true })).toContainText("Exports this week");
  await expect(page.getByRole("region", { name: "Key numbers" })).toHaveCount(0);
});

test("a lead hides a tile and reorders another, it persists across a reload, and Reset puts it back", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const lead = await createEmployeeAccount("Lia", `Layout${stamp}`, { roles: ["team_lead"] });
  await createEmployeeAccount("Ned", `Member${stamp}`, { managerId: lead.employeeId });
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, lead);
  await regions(page, ["Team flags", "Reviews and goals due", "Needs your decision"]);

  await page.getByRole("button", { name: "Edit layout" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "Team flags" }).click();
  for (let i = 0; i < 6; i++) await dialog.getByRole("button", { name: "Move Reviews and goals due up" }).click();
  await dialog.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText("Layout saved.").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Reviews and goals due", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Team flags", exact: true })).toHaveCount(0);
  const first = await page.getByRole("region", { name: "Reviews and goals due", exact: true }).boundingBox();
  const decisions = await page.getByRole("region", { name: "Needs your decision", exact: true }).boundingBox();
  expect(first && decisions && first.x < decisions.x).toBe(true);

  await page.getByRole("button", { name: "Edit layout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset to default" }).click();
  await expect(page.getByText("Layout reset.").first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Team flags", exact: true })).toBeVisible({ timeout: 30_000 });
});

test("a lead with nobody reporting to them is told so instead of seeing healthy-looking zeros", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, await createEmployeeAccount("Solo", `Lead${Date.now().toString(36)}`, { roles: ["team_lead"] }));
  await regions(page, ["Clocked in now", "Team hours", "Team flags"]);
  for (const name of ["Clocked in now", "Team hours", "Team flags"]) {
    await expect(page.getByRole("region", { name, exact: true })).toContainText("No one reports to you yet.");
  }
  await expect(page.getByRole("region", { name: "Clocked in now", exact: true })).not.toContainText("of 0");
});
