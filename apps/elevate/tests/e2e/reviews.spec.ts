import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied.
// HR makes a template and launches a cycle for one person; the person writes a self review, their lead writes theirs, HR calibrates and
// shares it, and the person reads the result and acknowledges it.

test("a review goes from self review to acknowledgment", async ({ browser }) => {
  test.setTimeout(300_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const lead = await createEmployeeAccount("Lena", `ReviewLead${stamp}`, { roles: ["team_lead"] });
  const person = await createEmployeeAccount("Rita", `Reviewed${stamp}`, { managerId: lead.employeeId });

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  // A template
  await hr.goto("/reviews/templates");
  // Earlier templates may exist, so the "Add a template" box can be closed and its labels are not unique: use the new form's ids
  if (!(await hr.locator("#rt-name-new").isVisible())) await hr.getByText("Add a template", { exact: true }).click(); // open on a clean database, closed once templates exist
  await waitForHydration(hr, "#rt-name-new");
  const form = hr.locator("form", { has: hr.locator("#rt-name-new") });
  await form.locator("#rt-name-new").fill(`E2E review ${stamp}`);
  await form.locator("#rq-sec-new-0").fill("Work");
  await form.locator("#rq-prompt-new-0").fill("Quality of work");
  await form.getByRole("button", { name: "Save template" }).click();
  await expect(hr.getByText("Template saved.")).toBeVisible(slow);

  // A cycle for that one person
  await hr.goto("/reviews/cycles/new");
  await waitForHydration(hr, "#cy-name");
  await hr.getByLabel("Cycle name").fill(`E2E cycle ${stamp}`);
  const templateValue = await hr.locator("#cy-tpl option", { hasText: `E2E review ${stamp}` }).getAttribute("value");
  await hr.getByLabel("Template").selectOption(templateValue!);
  await hr.getByLabel("Chosen people").check();
  await hr.getByLabel(`Reviewed${stamp}, Rita`).check();
  await hr.getByRole("button", { name: "Launch cycle" }).click();
  await hr.waitForURL(/\/reviews\/cycles\/[0-9a-f-]{36}$/, slow);
  const cycleUrl = hr.url();

  // The person writes a self review
  const personPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(personPage, person);
  await personPage.goto("/reviews");
  await personPage.getByRole("link", { name: "You" }).first().click();
  await personPage.waitForURL(/\/reviews\/[0-9a-f-]{36}$/, slow);
  const reviewUrl = personPage.url();
  await waitForHydration(personPage, "#comments");
  await personPage.getByRole("radiogroup", { name: "Quality of work" }).getByLabel(/^4/).check();
  await personPage.getByRole("button", { name: "Submit" }).click();
  await expect(personPage.getByText("Self review submitted.")).toBeVisible(slow);

  // The lead writes theirs and cannot yet see HR's calibration
  const leadPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(leadPage, lead);
  await leadPage.goto(reviewUrl);
  await waitForHydration(leadPage, "#comments");
  await expect(leadPage.getByRole("heading", { name: "Self review" })).toHaveCount(0); // hidden until their own is in
  await leadPage.getByRole("radiogroup", { name: "Quality of work" }).getByLabel(/^3/).check();
  await leadPage.getByRole("button", { name: "Submit" }).click();
  await expect(leadPage.getByText("Review submitted.")).toBeVisible(slow);

  // HR calibrates (the lead's 3 stands) and shares
  await hr.goto(reviewUrl);
  await waitForHydration(hr, "#final");
  await hr.getByLabel("Summary the person will read").fill("A steady start.");
  await hr.getByRole("button", { name: "Save calibration" }).click();
  await expect(hr.getByText("Calibration saved.")).toBeVisible(slow);
  await hr.getByRole("button", { name: "Share with the person" }).click();
  await expect(hr.getByText("Shared with the person.")).toBeVisible(slow);
  await hr.goto(cycleUrl);
  await expect(hr.getByText("Shared, waiting for acknowledgment")).toBeVisible(slow);

  // The person reads the result and acknowledges
  await personPage.goto(reviewUrl);
  await expect(personPage.getByRole("heading", { name: "Result" })).toBeVisible(slow);
  await expect(personPage.getByText("A steady start.")).toBeVisible();
  await waitForHydration(personPage, "#ack-comment");
  await personPage.getByRole("button", { name: "I have read this review" }).click();
  await expect(personPage.getByText("Acknowledged.", { exact: true })).toBeVisible(slow);
  await personPage.reload();
  await expect(personPage.getByText(/Acknowledged on \d{4}-\d{2}-\d{2}/)).toBeVisible(slow);
});
