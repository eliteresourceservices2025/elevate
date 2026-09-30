import fs from "node:fs";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. An employee asks for a prize day; their lead approves, then HR;
// the employee sees it approved, on the team calendar, and downloads the calendar file.
test("an employee asks for a day off, the lead and HR approve it, and it shows on the calendar", async ({ browser }) => {
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lena", `Lead${stamp}`, { roles: ["team_lead"] });
  const employee = await createEmployeeAccount("Eddie", `Asks${stamp}`, { managerId: lead.employeeId });
  const hr = await createHrAccount();

  // A working day about three weeks out that no holiday touches, and a prize day awarded a week ago
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  let day: string;
  try {
    const holidays = new Set((await sql<{ date: string }[]>`select date::text as date from time.holidays`).map((h) => h.date));
    let d = new Date(Date.now() + 21 * 86_400_000);
    for (;;) {
      const iso = d.toISOString().slice(0, 10);
      if ([2, 3, 4].includes(d.getUTCDay()) && !holidays.has(iso)) {
        day = iso;
        break;
      }
      d = new Date(d.getTime() + 86_400_000);
    }
    await sql`
      insert into time.leave_ledger (employee_id, leave_type_id, entry_type, days, effective_on, reason)
      select ${employee.employeeId}, id, 'award', 2, current_date - 7, 'E2E prize' from time.leave_types where slug = 'prize_day'`;
  } finally {
    await sql.end();
  }

  const pages = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()].map(async (c) => (await c).newPage()));
  const [empPage, leadPage, hrPage] = pages;
  await signInEnrollingMfa(empPage, employee);
  await signInEnrollingMfa(leadPage, lead);
  await signInEnrollingMfa(hrPage, hr);

  // --- The employee asks; the form previews what it uses ---
  await empPage.goto("/time-off?tab=requests");
  await waitForHydration(empPage, "#rq-start");
  await empPage.getByLabel("First day").fill(day);
  await expect(empPage.getByText("This uses 1 day")).toBeVisible();
  await expect(empPage.getByText("You have 2 days available")).toBeVisible();
  await empPage.getByLabel("Note (optional)").fill("Family event");
  await empPage.getByRole("button", { name: "Send request" }).click();
  await expect(empPage.getByText("Request sent.")).toBeVisible();
  const mine = empPage.getByRole("region", { name: "My requests" });
  await expect(mine.getByText("Waiting for lead")).toBeVisible();

  // --- The lead approves the first step ---
  await leadPage.goto("/time-off?tab=approvals");
  const leadCard = leadPage.getByRole("listitem").filter({ hasText: `Asks${stamp}` });
  await expect(leadCard).toContainText("Family event");
  await leadCard.getByRole("button", { name: "Approve" }).click();
  await expect(leadPage.getByText("Approved.")).toBeVisible();

  // --- HR approves the last step (the lead's is done, so HR can decide now) ---
  await hrPage.goto("/time-off?tab=approvals");
  const hrCard = hrPage.getByRole("listitem").filter({ hasText: `Asks${stamp}` });
  await expect(hrCard).toContainText("Waiting for HR");
  await hrCard.getByRole("button", { name: "Approve" }).click();
  await expect(hrPage.getByText("Approved.")).toBeVisible();

  // --- The employee sees it approved, uses one day of the balance, and finds it on the calendar ---
  await empPage.goto("/time-off?tab=requests");
  await expect(empPage.getByRole("region", { name: "My requests" }).getByText("Approved", { exact: true })).toBeVisible();
  await empPage.goto("/time-off");
  await expect(empPage.getByLabel("Prize day off balance: 1 day")).toBeVisible();
  await empPage.goto(`/time-off?tab=calendar&month=${day.slice(0, 7)}`);
  await expect(empPage.getByRole("grid", { name: "Time off calendar" }).getByText(`Eddie Asks${stamp}`)).toBeVisible();

  // --- And downloads the calendar file ---
  await empPage.goto("/time-off?tab=requests");
  const [download] = await Promise.all([empPage.waitForEvent("download"), empPage.getByRole("button", { name: "Add to calendar" }).click()]);
  expect(download.suggestedFilename()).toBe("time-off.ics");
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path Playwright gives for its own download
  const ics = fs.readFileSync((await download.path())!, "utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain(`DTSTART;VALUE=DATE:${day.replace(/-/g, "")}`);
});
