import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// Needs the local Supabase with migrations applied.
// A Super Admin is downgraded to the base role (Contractor / VA): the menu, the Approvals page and the notification bell must follow.

test("a downgraded Super Admin keeps no approvals, no recruiting menu and no recruiter or approver notices", async ({ browser }) => {
  test.setTimeout(120_000);
  const account = await createEmployeeAccount("Former", `Admin${Date.now().toString(36)}`, { roles: ["super_admin"] });

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [u] = await sql<{ id: string }[]>`select id from core.users where lower(email) = ${account.email.toLowerCase()}`;
    // Notices sent while they were a Super Admin, plus one that is theirs as a contractor.
    await sql`insert into ops.notifications (user_id, kind, title) values
      (${u.id}, 'recruiting.new_application', 'E2E new application'),
      (${u.id}, 'timeoff.approval_needed', 'E2E time off to decide'),
      (${u.id}, 'timeoff.approved', 'E2E your time off was approved')`;
    // The downgrade, as Settings > Roles saves it.
    await sql`delete from core.user_roles where user_id = ${u.id} and role_slug = 'super_admin'`;
  } finally {
    await sql.end();
  }

  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, account);

  const menu = page.getByRole("navigation", { name: "Main" });
  await expect(menu.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Approvals" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Recruiting" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "Team attendance" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Dashboard view" })).toHaveCount(0);
  await expect(page.getByText("Needs your decision")).toHaveCount(0);

  const response = await page.goto("/approvals");
  expect(response?.status()).toBe(404);

  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const bell = page.getByRole("region", { name: "Notifications" });
  await expect(bell.getByText("E2E your time off was approved")).toBeVisible();
  await expect(bell.getByText("E2E new application")).toHaveCount(0);
  await expect(bell.getByText("E2E time off to decide")).toHaveCount(0);
});
