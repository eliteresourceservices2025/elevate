import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied. The VA dashboard is a bento grid of work tiles and people tiles; a person can hide their own birthday.

test("a VA sees work and people tiles, and a colleague who hides their birthday disappears from the birthdays tile", async ({ browser }) => {
  test.setTimeout(240_000);
  const stamp = Date.now().toString(36);
  const lead = await createEmployeeAccount("Lena", `Lead${stamp}`, { roles: ["team_lead"] });
  const peer = await createEmployeeAccount("Pia", `Birthday${stamp}`, { managerId: lead.employeeId });
  const viewer = await createEmployeeAccount("Vic", `Viewer${stamp}`, { managerId: lead.employeeId });

  // Pia's birthday is today (company zone), in an old year: only the month and day may ever reach the dashboard.
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`update core.employees set birth_date = to_char(now() at time zone 'America/Phoenix', '"1995"-MM-DD')::date where id = ${peer.employeeId}`;
  } finally {
    await sql.end();
  }

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, viewer);

  for (const name of ["My hours this week", "My schedule", "My to-do", "Birthdays this month", "Work anniversaries", "New joiners", "My team", "Who is out", "Latest announcements"]) {
    await expect(page.getByRole("region", { name })).toBeVisible({ timeout: 30_000 });
  }
  const birthdays = page.getByRole("region", { name: "Birthdays this month" });
  await expect(birthdays).toContainText("Pia B.");
  await expect(birthdays).toContainText("Today");
  await expect(birthdays).not.toContainText("1995");
  await expect(page.getByRole("region", { name: "My team" })).toContainText(`Lena L.`);
  await expect(page.getByRole("region", { name: "Key numbers" })).toHaveCount(0);

  // Pia hides her birthday in her own profile.
  const pia = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(pia, peer);
  await pia.goto("/people/me?tab=personal");
  const toggle = pia.getByRole("switch", { name: "Show my birthday on the dashboard" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(pia.getByText("Your birthday is hidden from the dashboard.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Birthdays this month" })).not.toContainText("Pia B.", { timeout: 30_000 });
});
