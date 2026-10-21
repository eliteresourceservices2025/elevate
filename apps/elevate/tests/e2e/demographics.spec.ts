import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied and the recruiting-docs bucket (pnpm storage:setup).
// Voluntary gender, pronouns and religion: the profile card, who sees what, and the optional part of the application form.

const PDF = Buffer.from("%PDF-1.4\n% e2e resume\n1 0 obj\n<<>>\nendobj\n");

test("a person shares pronouns, gender and religion on their profile; colleagues see only the pronouns; they can remove it all", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const account = await createEmployeeAccount("Ana", `Demo${stamp}`);

  const me = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(me, account);
  await me.goto("/people/me");
  await me.getByRole("button", { name: "Edit about me" }).click();
  await expect(me.getByRole("heading", { name: "About me (optional)" })).toBeVisible(slow);
  await expect(me.getByText(/Only you can see your gender and religion/)).toBeVisible();
  await waitForHydration(me, "#me-gender");
  // Every question starts on "Skip this question"
  await expect(me.getByLabel("Gender")).toHaveValue("");
  await expect(me.getByLabel("Religion")).toHaveValue("");

  await me.getByLabel("Gender").selectOption("woman");
  await me.getByLabel("Pronouns").selectOption("she_her");
  await me.getByLabel("Religion").selectOption("islam");
  await me.getByRole("button", { name: "Save", exact: true }).click();
  await expect(me.getByText("Saved.")).toBeVisible(slow);
  await expect(me.getByRole("heading", { level: 1 })).toContainText("(she/her)", slow);

  // It is still there after a reload
  await me.reload();
  await me.getByRole("button", { name: "Edit about me" }).click();
  await waitForHydration(me, "#me-gender");
  await expect(me.getByLabel("Gender")).toHaveValue("woman");
  await expect(me.getByLabel("Religion")).toHaveValue("islam");

  // A self-description needs its words
  await me.getByLabel("Gender").selectOption("self_described");
  await me.getByRole("button", { name: "Save", exact: true }).click();
  await expect(me.getByText(/Write how you describe your gender/)).toBeVisible(slow);
  await me.getByLabel("How you describe your gender").fill("Agender");
  await me.getByRole("button", { name: "Save", exact: true }).click();
  await expect(me.getByText("Saved.")).toBeVisible(slow);

  // HR can open the profile: the pronouns show, but there is no gender or religion anywhere, and no About me card.
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());
  await hr.goto(`/people/${account.employeeId}`);
  await expect(hr.getByRole("heading", { level: 1 })).toContainText("(she/her)", slow);
  await expect(hr.getByRole("heading", { name: "About me (optional)" })).toHaveCount(0);
  const body = await hr.locator("body").innerText();
  expect(body).not.toMatch(/Islam|Agender|Religion/);

  // The person removes everything
  await me.getByRole("button", { name: "Edit about me" }).click();
  await waitForHydration(me, "#me-gender");
  me.once("dialog", (d) => d.accept());
  await me.getByRole("button", { name: "Remove all my answers" }).click();
  await expect(me.getByText("Removed.")).toBeVisible(slow);
  await expect(me.getByRole("heading", { level: 1 })).not.toContainText("(she/her)", slow);
  await me.reload();
  await me.getByRole("button", { name: "Edit about me" }).click();
  await waitForHydration(me, "#me-gender");
  await expect(me.getByLabel("Gender")).toHaveValue("");
  await expect(me.getByLabel("Pronouns")).toHaveValue("");
});

test("an applicant can answer the optional questions, or skip them, and the hiring team never sees them", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const title = `E2E Demographics VA ${stamp}`;

  const hrPage = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hrPage, await createHrAccount());
  await hrPage.getByRole("link", { name: "Recruiting", exact: true }).click();
  await hrPage.waitForURL("**/recruiting", slow);
  await hrPage.getByRole("link", { name: "New job" }).click();
  await hrPage.waitForURL("**/recruiting/new", slow);
  await waitForHydration(hrPage, "#op-title");
  await hrPage.getByLabel("Job title").fill(title);
  await hrPage.getByLabel(/^Description/).fill("Support our clients with scheduling, inbox care and light data entry.\n\n- Reliable internet");
  await hrPage.getByRole("button", { name: "Create job (draft)" }).click();
  await hrPage.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const boardUrl = hrPage.url();
  await hrPage.getByRole("button", { name: "Publish job" }).click();
  await expect(hrPage.getByText("Open", { exact: true }).first()).toBeVisible(slow);

  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/careers");
  await anon.getByRole("link", { name: title }).click();
  await anon.waitForURL(/\/careers\//, slow);
  await waitForHydration(anon, "#ap-name");
  await expect(anon.getByText("About you (optional)")).toBeVisible();
  await expect(anon.getByText(/not used to decide whether to hire you/)).toBeVisible();
  // No pronouns question in the application
  await expect(anon.getByLabel("Pronouns")).toHaveCount(0);

  const email = `pia.${stamp}@example.com`;
  await anon.getByLabel("Full name").fill(`Pia Applicant${stamp}`);
  await anon.getByLabel("Email", { exact: true }).fill(email);
  await anon.locator("#ap-resume").setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: PDF });
  await anon.getByLabel("Gender").selectOption("self_described");
  await anon.getByRole("button", { name: "Send application" }).click();
  await anon.getByLabel(/I have read the privacy notice/).check();
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText(/Write how you describe your gender/)).toBeVisible(slow);
  await anon.getByLabel("How you describe your gender").fill("Agender");
  await anon.getByLabel("Religion").selectOption("buddhism");
  await anon.getByRole("button", { name: "Send application" }).click();
  await expect(anon.getByText("Thank you, we received your application.")).toBeVisible(slow);

  // Stored apart from the application, encrypted
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql<{ gender: string; religion_enc: string; gender_other_enc: string }[]>`
      select s.gender, s.religion_enc, s.gender_other_enc from talent.candidate_self_identification s
      join talent.candidates c on c.id = s.candidate_id where lower(c.email) = ${email}`;
    expect(row.gender).toBe("self_described");
    expect(row.religion_enc).not.toContain("buddhism");
    expect(row.gender_other_enc).not.toContain("Agender");
  } finally {
    await sql.end();
  }

  // The hiring team sees the applicant but nothing about gender or religion
  await hrPage.goto(boardUrl);
  const card = hrPage.locator("section[data-stage='applied']").getByRole("link", { name: `Pia Applicant${stamp}` });
  await expect(card).toBeVisible(slow);
  await card.click();
  await hrPage.waitForURL(/\/recruiting\/applications\//, slow);
  await expect(hrPage.getByRole("heading", { name: `Pia Applicant${stamp}` })).toBeVisible(slow);
  const text = await hrPage.locator("body").innerText();
  expect(text).not.toMatch(/Buddhism|Agender|Religion|Gender/);
});
