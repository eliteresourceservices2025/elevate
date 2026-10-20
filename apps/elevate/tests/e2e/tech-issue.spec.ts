import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, hydrated, signInEnrollingMfa } from "./helpers";

// A contractor reports a technical issue from the Attendance page (a screenshot is required), HR sees it with the screenshot and
// marks it handled, and the contractor sees the answer. It changes no clock events.

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("a contractor reports a technical issue with a screenshot and HR handles it", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const worker = await createEmployeeAccount("Tech", `Issue${stamp}`);
  const page = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(page, worker);

  // On the Attendance page, next to the time correction
  await page.goto("/attendance");
  const section = page.getByRole("region", { name: "My technical issue reports" });
  await expect(section).toBeVisible(slow);
  await (await hydrated(section.getByRole("button", { name: "Report a technical issue" }))).click();
  await page.getByLabel("What went wrong?").selectOption("jibble");
  await page.getByLabel("What happened?").fill(`Jibble kept running after I clocked out ${stamp}`);
  // No screenshot, no report
  await expect(page.getByRole("button", { name: "Send report" })).toBeDisabled();
  await page.getByLabel(/Screenshot of the problem/).setInputFiles({ name: "jibble.png", mimeType: "image/png", buffer: PNG_1X1 });
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Report sent to your lead and HR.")).toBeVisible(slow);
  await expect(section.getByText(`Jibble kept running after I clocked out ${stamp}`)).toBeVisible(slow);
  await expect(section.getByRole("button", { name: "View screenshot 1" })).toBeVisible();
  await expect(section.getByText("Waiting")).toBeVisible();

  // HR sees it with the screenshot and marks it handled
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/attendance?tab=issues");
  const item = hr.getByRole("listitem").filter({ hasText: `Jibble kept running after I clocked out ${stamp}` });
  await expect(item).toBeVisible(slow);
  await expect(item.getByRole("button", { name: "View screenshot 1" })).toBeVisible();
  await item.getByLabel("Note for them (optional)").fill("Thanks, we are checking the Jibble link.");
  await (await hydrated(item.getByRole("button", { name: "Mark as handled" }))).click();
  await expect(hr.getByText("Marked as handled.")).toBeVisible(slow);

  // The contractor sees the answer
  await page.goto("/attendance?tab=issues");
  const mine = page.getByRole("listitem").filter({ hasText: `Jibble kept running after I clocked out ${stamp}` });
  await expect(mine.getByText("Handled")).toBeVisible(slow);
  await expect(mine.getByText("Thanks, we are checking the Jibble link.")).toBeVisible();
});
