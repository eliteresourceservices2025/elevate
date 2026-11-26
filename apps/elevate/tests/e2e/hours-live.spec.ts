import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa } from "./helpers";

// A VA clocks in and out; hours review shows them working at once and finished at once, with no nightly run in between.
const SHOTS = process.env.SHOT_DIR;

test("hours review follows the clock without waiting for the nightly run", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 45_000 };
  const stamp = String(Date.now()).slice(-6);
  // "Aaa" so the person is on the first page of a well-used local database.
  const va = await createEmployeeAccount("Aaa", `Aaalive${stamp}`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [c] = await sql<{ id: string }[]>`insert into core.clients (name, time_zone) values (${`Aaa A Rather Long Client Name For Wrapping, LLC ${stamp}`}, 'America/Phoenix') returning id`;
    await sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${va.employeeId}, ${c.id}, current_date - 30)`;
  } finally {
    await sql.end();
  }

  const vaPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(vaPage, va);
  await vaPage.goto("/attendance");
  await vaPage.waitForLoadState("networkidle");
  await vaPage.getByRole("button", { name: /Clock in/ }).first().click();
  const confirmIn = vaPage.getByRole("menuitem").first();
  await confirmIn.click({ timeout: 4000 }).catch(() => undefined);
  await expect(vaPage.getByText(/Working since|Clock out/).first()).toBeVisible(slow);

  const hr = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  const monday = (() => {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Phoenix" }));
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  await hr.goto(`/hours-review?rweek=${monday}`);
  await hr.waitForLoadState("networkidle");
  const row = hr.getByRole("row").filter({ hasText: `Aaalive${stamp}` });
  await expect(row).toBeVisible(slow);
  // Their own detail is the row under theirs: other test people share the page.
  const detail = row.locator("xpath=following-sibling::tr[1]");
  await detail.getByText("Review daily detail").click();
  await expect(detail.getByText("Working now").first()).toBeVisible(slow);
  await expect(hr.getByText(/Last refreshed/)).toBeVisible();
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/h-working.png`, fullPage: false });

  await vaPage.getByRole("button", { name: /Clock out/ }).first().click();
  await vaPage.getByRole("menuitem", { name: /Clock out/ }).click({ timeout: 4000 }).catch(() => undefined);
  await vaPage.getByRole("button", { name: /Clock out|Yes|Confirm/ }).last().click({ timeout: 4000 }).catch(() => undefined);

  await expect(async () => {
    await hr.reload();
    await detail.getByText("Review daily detail").click();
    await expect(detail.getByText("Working now")).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await hr.getByRole("button", { name: "Refresh this week" }).click();
  await expect(hr.getByText(/already up to date|Updated \d+/)).toBeVisible(slow);
  if (SHOTS) await hr.screenshot({ path: `${SHOTS}/h-done.png`, fullPage: false });
});
