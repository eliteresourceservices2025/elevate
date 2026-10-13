import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { loadCourse } from "../../src/modules/learn/publish";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// HR's Training status page in a real browser: find a person who has no training yet, assign it, see them as "Not yet", and give
// them more exam time with a reason. A team lead sees the same list for their team without scores or actions.

test("HR assigns HIPAA training from the Training status page and a lead sees only status", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Tess", `Lead${stamp}`, { roles: ["team_lead"] });
  const person = await createEmployeeAccount("Wren", `Trainee${stamp}`, { managerId: lead.employeeId });
  const hr = await createHrAccount();

  // The course must be published for assigning (this local database may be fresh).
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [u] = await sql`select id from core.users where email = ${hr.email}`;
    await loadCourse(sql, { publish: true, reviewerUserId: u.id as string, counselApprovedOn: "2026-11-01", actorUserId: u.id as string });
  } finally {
    await sql.end();
  }

  const hrPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await hrPage.goto(`/training?q=${encodeURIComponent(`Trainee${stamp}`)}`);
  await expect(hrPage.getByRole("heading", { name: "Training status" })).toBeVisible(slow);
  const row = hrPage.getByRole("row").filter({ hasText: `Wren Trainee${stamp}` });
  await expect(row).toBeVisible(slow);
  await expect(row.getByText("Not assigned")).toBeVisible();

  await waitForHydration(hrPage, "main button");
  await row.getByRole("button", { name: "Assign" }).click();
  await expect(hrPage.getByText("Training assigned.")).toBeVisible(slow);
  await expect(row.getByText("Not yet")).toBeVisible(slow);
  await expect(row.getByText(/Full|Essentials/)).toBeVisible();

  await row.getByRole("button", { name: "More tries or time" }).click();
  await row.getByLabel("What to give").selectOption("time");
  await row.getByLabel("Reason").fill("Slow connection during the exam");
  await row.getByRole("button", { name: "Give", exact: true }).click();
  await expect(hrPage.getByText("Extra time given.")).toBeVisible(slow);

  // The person is told, in the app.
  const personPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(personPage, person);
  await personPage.goto("/dashboard");
  await personPage.getByRole("button", { name: /notifications/i }).first().click();
  await expect(personPage.getByText("HIPAA training is assigned to you")).toBeVisible(slow);

  // A lead sees their team's status, with no scores and no actions.
  const leadPage = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto("/training");
  await expect(leadPage.getByRole("heading", { name: "Training status" })).toBeVisible(slow);
  await expect(leadPage.getByRole("row").filter({ hasText: `Wren Trainee${stamp}` })).toBeVisible(slow);
  await expect(leadPage.getByRole("columnheader", { name: "Latest score" })).toHaveCount(0);
  await expect(leadPage.getByRole("button", { name: "Assign" })).toHaveCount(0);
});
