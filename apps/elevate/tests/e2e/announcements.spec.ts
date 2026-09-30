import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, hydrated, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. HR posts an announcement and publishes a policy;
// an employee sees the banner, acknowledges both, and HR sees who acknowledged.
test("HR posts, an employee acknowledges, and HR sees the status", async ({ browser }) => {
  const stamp = Date.now();
  const hr = await createHrAccount();
  const employee = await createEmployeeAccount("Eli", `Ack${stamp}`);

  const hrPage = await (await browser.newContext()).newPage();
  const empPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, hr);
  await signInEnrollingMfa(empPage, employee);

  // --- HR posts an announcement that needs acknowledgment. Markup is shown as plain text. ---
  const title = `Office closed ${stamp}`;
  await hrPage.goto("/announcements/new");
  await waitForHydration(hrPage, "#an-title");
  await hrPage.getByLabel("Title").fill(title);
  await hrPage.getByLabel("Message").fill("We are closed on **Friday**.\n\n<script>alert('x')</script>\n\n[Bad link](javascript:alert(1))");
  await hrPage.getByLabel("Require acknowledgment").check();
  await hrPage.getByRole("button", { name: "Post announcement" }).click();
  await hrPage.waitForURL(/\/announcements\/[0-9a-f-]{36}$/);
  const announcementUrl = hrPage.url();

  await expect(hrPage.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(hrPage.getByText("<script>alert('x')</script>")).toBeVisible(); // literal text, not executed
  await expect(hrPage.locator("article strong", { hasText: "Friday" })).toBeVisible();
  await expect(hrPage.locator("article a[href^='javascript']")).toHaveCount(0);
  await expect(hrPage.getByRole("button", { name: /Send reminder/ })).toBeVisible();

  // --- The employee sees the banner and the dashboard entry, reads it, and acknowledges ---
  await empPage.goto("/dashboard");
  const banner = empPage.getByRole("region", { name: "Acknowledgments needed" });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("need your acknowledgment"); // it lists only the first 3; the dashboard list below has them all
  await expect(empPage.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();

  await empPage.getByRole("region", { name: "Waiting for you" }).getByRole("link", { name: title }).click();
  await empPage.waitForURL(announcementUrl);
  await (await hydrated(empPage.getByRole("button", { name: "I have read and understand" }))).click();
  await expect(empPage.getByText("Your acknowledgment is recorded.")).toBeVisible();
  await expect(empPage.getByText(/You acknowledged this on/)).toBeVisible();
  await empPage.goto("/dashboard");
  await expect(empPage.getByRole("region", { name: "Waiting for you" }).getByRole("link", { name: title })).toHaveCount(0);

  // The employee cannot see who else acknowledged
  await empPage.goto(announcementUrl);
  await expect(empPage.getByRole("region", { name: "Who has acknowledged" })).toHaveCount(0);

  // --- HR sees the employee as acknowledged ---
  await hrPage.reload();
  const status = hrPage.getByRole("region", { name: "Who has acknowledged" });
  const row = status.getByRole("row").filter({ hasText: `Ack${stamp}` });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Acknowledged/)).toBeVisible();
  await expect(row.getByText("Not acknowledged")).toHaveCount(0);

  // --- HR publishes a policy; the employee is asked to acknowledge it ---
  const policyTitle = `Conduct ${stamp}`;
  await hrPage.goto("/announcements?tab=policies");
  await waitForHydration(hrPage, "#np-title");
  await hrPage.getByLabel("Policy title").fill(policyTitle);
  await hrPage.getByLabel("Text", { exact: true }).fill("# Be kind\n\n- Respect each other");
  await hrPage.getByRole("button", { name: "Create draft" }).click();
  await hrPage.waitForURL(/\/announcements\/policies\/[0-9a-f-]{36}$/);
  const policyUrl = hrPage.url();
  hrPage.once("dialog", (d) => void d.accept());
  await (await hydrated(hrPage.getByRole("button", { name: "Publish version 1" }))).click();
  await expect(hrPage.getByText("Version 1 published.")).toBeVisible();

  await empPage.goto(policyUrl);
  await expect(empPage.getByRole("heading", { level: 2, name: "Be kind" })).toBeVisible();
  await (await hydrated(empPage.getByRole("button", { name: "I have read and understand" }))).click();
  await expect(empPage.getByText(/You acknowledged version 1 on/)).toBeVisible();

  await hrPage.reload();
  await expect(hrPage.getByRole("region", { name: "Who has acknowledged" }).getByRole("row").filter({ hasText: `Ack${stamp}` }).getByText(/Acknowledged/)).toBeVisible();
});
