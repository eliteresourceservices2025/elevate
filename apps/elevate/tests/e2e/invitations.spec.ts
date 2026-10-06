import { expect, test } from "@playwright/test";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. A Super Admin chooses roles and the Safe Voice handler flag when inviting; HR can invite but never sees those choices.

test("a Super Admin invites with a role and the Safe Voice handler flag; HR gets the plain form", async ({ browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now().toString(36);

  const sa = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(sa, await createEmployeeAccount("Super", `Inviter${stamp}`, { roles: ["super_admin"] }));
  await sa.goto("/settings/invitations");
  await waitForHydration(sa, "#invite-email");
  const email = `invitee.${stamp}@example.com`;
  await sa.getByLabel("Invite by email").fill(email);
  const choices = sa.getByRole("group", { name: "Give them, on top of Employee" });
  await choices.getByRole("checkbox", { name: "HR Admin" }).click();
  await choices.getByRole("checkbox", { name: /Safe Voice handler/ }).click();
  await expect(choices.getByRole("checkbox", { name: "Super Admin" })).toBeVisible();
  await sa.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(sa.getByText(`Invited ${email}`)).toBeVisible();

  const row = sa.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("HR Admin")).toBeVisible();
  await expect(row.getByText("Safe Voice handler")).toBeVisible();
  // The form clears after a send, so the next invitation starts as Employee only
  await expect(choices.getByRole("checkbox", { name: "HR Admin" })).not.toBeChecked();

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto("/settings/invitations");
  await waitForHydration(hr, "#invite-email");
  await expect(hr.getByRole("group", { name: "Give them, on top of Employee" })).toHaveCount(0);
  await expect(hr.getByRole("columnheader", { name: "Gets on sign-in" })).toHaveCount(0);
  await expect(hr.getByRole("row").filter({ hasText: email })).toBeVisible();
  await expect(hr.getByRole("row").filter({ hasText: email }).getByText("HR Admin")).toHaveCount(0);
  await expect(hr.getByRole("row").filter({ hasText: email }).getByText("Safe Voice handler")).toHaveCount(0);
});
