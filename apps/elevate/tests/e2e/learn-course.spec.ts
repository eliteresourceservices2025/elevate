import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { assignCourse, loadCourse } from "../../src/modules/learn/publish";
import { createEmployeeAccount, signInEnrollingMfa } from "./helpers";

// The course player and the exam in a real browser: open the course from ELEVATE, read a module screen by screen, see that the
// module cannot be finished until the reading time is reached, finish it once it is, then start the exam and answer a question.
// Needs ELEVATE (E2E_BASE_URL) and ELEVATE Learn (LEARN_URL, default http://localhost:3200) running against the same database.
// (The full exam, the certificate and the check are covered through the real request handlers in tests/integration/learn-course.test.ts.)

const LEARN = process.env.LEARN_URL ?? "http://localhost:3200";

test("a person reads a module, finishes it when the time is reached, and starts the exam", async ({ page }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const account = await createEmployeeAccount("Mina", `Course${Date.now()}`);
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  let assignmentId: string;
  let userId: string;
  try {
    const [u] = await sql`select id from core.users where email = ${account.email}`;
    userId = u.id as string;
    // Publish the real course on this local database (a named reviewer and counsel's date are required, so use this account).
    await loadCourse(sql, { publish: true, reviewerUserId: userId, counselApprovedOn: "2026-11-01", actorUserId: userId });
    assignmentId = (await assignCourse(sql, { userId, track: "full" })).assignmentId;
  } catch (e) {
    await sql.end();
    throw e;
  }

  await signInEnrollingMfa(page, account);
  await page.goto("/learn?auto=1");
  await page.waitForURL(`${LEARN}/**`, slow);
  await expect(page.getByRole("heading", { name: /Hello, Mina/ })).toBeVisible(slow);

  // The course page: eight modules, only the first open.
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: /HIPAA Privacy, Security and Awareness/ })).toBeVisible(slow);
  await expect(page.getByText("0 of 8 modules done")).toBeVisible();
  await expect(page.getByText("Locked").first()).toBeVisible();
  await page.getByRole("link", { name: "Start" }).first().click();

  // The player: screen by screen, up to the last, where finishing is blocked until the time is reached.
  await expect(page.getByRole("heading", { name: "HIPAA foundations and your role at ERS" })).toBeVisible(slow);
  await expect(page.getByText("Screen 1 of 10")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Why this training matters" })).toBeVisible();
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Screen 10 of 10")).toBeVisible();
  await expect(page.getByText("Key points")).toBeVisible();
  const finish = page.getByRole("button", { name: "Finish this module" });
  await expect(finish).toBeDisabled();
  await expect(page.getByText(/Reading time: 0:00 of 6:00 needed/)).toBeVisible();

  // The server saw every screen. Reaching the reading time (added directly: the real minimum is minutes long) opens the button.
  await expect
    .poll(async () => (await sql`select count(*)::int as n from learn.module_screens where assignment_id = ${assignmentId}`)[0].n, { timeout: 15_000 })
    .toBe(10);
  await sql`insert into learn.module_time (assignment_id, user_id, module_key, day, seconds) values (${assignmentId}, ${userId}, 'foundations', current_date, 360)`;
  await page.reload();
  await expect(page.getByText("You have spent enough time on this module.")).toBeVisible(slow);
  await page.getByRole("button", { name: "Finish this module" }).click();
  await page.waitForURL(new RegExp(`/course/${assignmentId}$`), slow);
  await expect(page.getByText("1 of 8 modules done")).toBeVisible(slow);
  await expect(page.getByText(/Finish all 8 modules to unlock the exam/)).toBeVisible();

  // Finish the rest as the database would record it, then the exam opens.
  await sql`
    insert into learn.module_completions (assignment_id, user_id, module_key)
    select ${assignmentId}, ${userId}, module_key from learn.version_modules
    where version_id = (select version_id from learn.assignments where id = ${assignmentId}) and module_key <> 'foundations'`;
  await page.reload();
  await expect(page.getByText("8 of 8 modules done")).toBeVisible(slow);
  await page.getByRole("button", { name: "Start the exam" }).click();
  await page.waitForURL(/\/exam\//, slow);
  await expect(page.getByText("Question 1 of 25")).toBeVisible(slow);
  await expect(page.getByRole("timer")).toBeVisible();
  const choices = page.getByRole("group", { name: "Answer choices" }).getByRole("radio");
  await choices.first().check();
  await expect(page.getByText("Saved")).toBeVisible(slow);
  await sql.end();
});
