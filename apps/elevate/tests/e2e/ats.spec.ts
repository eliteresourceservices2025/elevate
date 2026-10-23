import { expect, test } from "@playwright/test";
import { createHrAccount, signInEnrollingMfa, waitForHydration } from "./helpers";
import { makePdf } from "../helpers/resume-files";

// Needs the local Supabase with migrations applied and the recruiting-docs bucket (pnpm storage:setup).
// The ATS layer: the all-applicants list with search and filters, the resume keyword match, tags and source, and a bulk action.

test("HR finds applicants across jobs, reads the keyword match, tags one, and closes two at once", async ({ browser }) => {
  test.setTimeout(300_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const title = `E2E Billing ${stamp}`;
  const strong = `Ada Strong${stamp}`;
  const weak = `Ben Weak${stamp}`;

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  // A job with resume keywords
  await hr.goto("/recruiting/new");
  await waitForHydration(hr, "#op-title");
  await hr.getByLabel("Job title").fill(title);
  await hr.getByLabel(/^Description/).fill("Support our clients with billing, inbox care and light data entry.\n\n- Clear written English");
  await hr.getByLabel("Must have").fill("medical billing, excel");
  await hr.getByLabel("Nice to have").fill("hipaa");
  await hr.getByRole("button", { name: "Create job (draft)" }).click();
  await hr.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const openingId = hr.url().split("/").pop()!;
  await hr.getByRole("button", { name: "Publish job" }).click();
  await expect(hr.getByText("Open", { exact: true }).first()).toBeVisible(slow);

  // Two applicants apply on the public form's endpoint; one resume has the words, the other does not
  const apply = async (name: string, lines: string[], source?: string) => {
    const res = await hr.request.post("/api/careers/apply", {
      multipart: {
        openingId,
        fullName: name,
        email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        consent: "on",
        website: "",
        ...(source ? { source } : {}),
        resume: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf(lines)) },
      },
    });
    expect(res.ok()).toBe(true);
  };
  await apply(strong, ["Medical billing specialist", "Excel and HIPAA trained"], "linkedin");
  await apply(weak, ["Gardener and baker"]);

  // The all-applicants page: its own menu item, search, and the keyword match
  await hr.getByRole("link", { name: "Applicants", exact: true }).click();
  await hr.waitForURL("**/recruiting/applicants", slow);
  await expect(hr.getByRole("link", { name: "Applicants", exact: true })).toHaveAttribute("aria-current", "page");
  await waitForHydration(hr, "#bulk-action");
  await hr.getByLabel("Name or email").fill(`${stamp}`);
  await hr.getByRole("button", { name: "Apply filters" }).click();
  await expect(hr.getByRole("link", { name: strong })).toBeVisible(slow);
  await expect(hr.getByRole("link", { name: weak })).toBeVisible();
  await expect(hr.getByText("Match 100%").first()).toBeVisible();
  await expect(hr.getByText("Match 0%").first()).toBeVisible();

  // Only the strong match, by the keyword filter
  await hr.getByText("More filters").click();
  await hr.getByLabel("Keyword match").selectOption("75");
  await hr.getByRole("button", { name: "Apply filters" }).click();
  await expect(hr.getByRole("link", { name: strong })).toBeVisible(slow);
  await expect(hr.getByRole("link", { name: weak })).toHaveCount(0);

  // The applicant page shows the words found and missing, and lets HR tag them and fix the source
  await hr.getByRole("link", { name: strong }).click();
  await hr.waitForURL(/\/recruiting\/applications\//, slow);
  await expect(hr.getByRole("heading", { name: "Keyword match" })).toBeVisible(slow);
  await expect(hr.getByText("100% · Strong")).toBeVisible();
  await expect(hr.getByText("A reading aid only")).toBeVisible();
  await waitForHydration(hr, "#at-new");
  const tag = `E2E strong ${stamp}`;
  await hr.getByLabel("Make a new tag").fill(tag);
  await hr.getByRole("button", { name: "Add tag" }).click();
  await expect(hr.getByText(`Tag "${tag}" is ready`)).toBeVisible(slow);
  await hr.getByRole("button", { name: "Save tags" }).click();
  await expect(hr.getByText("Tags saved.")).toBeVisible(slow);
  await expect(hr.getByLabel("Heard about the job")).toHaveValue("linkedin"); // the apply form's source was kept

  // Back in the list, filter by the tag; then act on both applicants at once
  await hr.goto("/recruiting/applicants");
  await waitForHydration(hr, "#bulk-action");
  await hr.getByText("More filters").click();
  await hr.getByLabel("Tag", { exact: true }).selectOption({ label: tag });
  await hr.getByRole("button", { name: "Apply filters" }).click();
  await expect(hr.getByRole("link", { name: strong })).toBeVisible(slow);
  await expect(hr.getByRole("link", { name: weak })).toHaveCount(0);

  await hr.goto(`/recruiting/applicants?job=${openingId}`);
  await waitForHydration(hr, "#bulk-action");
  await hr.getByRole("checkbox", { name: `Select ${strong}` }).check();
  await hr.getByRole("checkbox", { name: `Select ${weak}` }).check();
  await expect(hr.getByText("2 selected")).toBeVisible();
  await hr.getByLabel("Do this").selectOption("close");
  await hr.getByLabel("How it closes").selectOption("not_qualified");
  await hr.getByLabel("Reason (internal only)").fill("E2E bulk close");
  hr.once("dialog", (d) => d.accept());
  await hr.getByRole("button", { name: /^Apply to 2/ }).click();
  await expect(hr.getByText("2 of 2 done.")).toBeVisible(slow);
  await expect(hr.getByRole("row", { name: new RegExp(strong) }).getByText("Not qualified")).toBeVisible(slow);
  await expect(hr.getByRole("row", { name: new RegExp(weak) }).getByText("Not qualified")).toBeVisible();
});

test("HR puts a consenting applicant in the talent pool, then merges two records of the same person", async ({ browser }) => {
  test.setTimeout(300_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const phone = `09${String(stamp).slice(-9)}`;
  const person = `Pia Pool${stamp}`;

  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  const openJob = async (title: string) => {
    await hr.goto("/recruiting/new");
    await waitForHydration(hr, "#op-title");
    await hr.getByLabel("Job title").fill(title);
    await hr.getByLabel(/^Description/).fill("Support our clients with scheduling, inbox care and light data entry.");
    await hr.getByRole("button", { name: "Create job (draft)" }).click();
    await hr.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
    const id = hr.url().split("/").pop()!;
    await hr.getByRole("button", { name: "Publish job" }).click();
    await expect(hr.getByText("Open", { exact: true }).first()).toBeVisible(slow);
    return id;
  };
  const jobA = await openJob(`E2E Pool A ${stamp}`);
  const jobB = await openJob(`E2E Pool B ${stamp}`);

  const apply = async (openingId: string, name: string, extra: Record<string, string> = {}) => {
    const res = await hr.request.post("/api/careers/apply", {
      multipart: { openingId, fullName: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`, phone, consent: "on", website: "", ...extra, resume: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf(["Virtual assistant"])) } },
    });
    expect(res.ok()).toBe(true);
  };
  await apply(jobA, person, { poolConsent: "on" });
  await apply(jobB, `${person} Again`);

  // The applicant who agreed to be kept goes in the talent pool
  await hr.goto(`/recruiting/applicants?q=${encodeURIComponent(person)}`);
  await hr.getByRole("link", { name: person, exact: true }).click();
  await hr.waitForURL(/\/recruiting\/applications\//, slow);
  await waitForHydration(hr, "#at-new");
  await expect(hr.getByText("They agreed to be kept for future roles")).toBeVisible(slow);
  await hr.getByRole("button", { name: "Add to the talent pool" }).click();
  await expect(hr.getByText("Added to the pool.")).toBeVisible(slow);
  await hr.goto(`/recruiting/applicants?pool=1&q=${encodeURIComponent(person)}`);
  await expect(hr.getByRole("link", { name: person, exact: true })).toBeVisible(slow);
  await expect(hr.getByRole("link", { name: `${person} Again` })).toHaveCount(0);

  // Two records with the same phone number: HR merges them
  await hr.goto("/recruiting/applicants");
  await hr.getByRole("link", { name: "Possible duplicates" }).click();
  await hr.waitForURL("**/recruiting/applicants/duplicates", slow);
  const group = hr.locator("fieldset", { hasText: person }).first();
  await expect(group.getByText("Possible duplicate: same phone number")).toBeVisible(slow);
  await waitForHydration(hr, "input[type=radio]");
  await group.getByRole("radio").first().check();
  hr.once("dialog", (d) => d.accept());
  await group.getByRole("button", { name: /merge the rest/ }).click();
  await expect(hr.getByText(/Merged\. 1 application moved\./)).toBeVisible(slow);
  await expect(hr.locator("fieldset", { hasText: person })).toHaveCount(0, slow);
});

test("HR rewords an applicant email, then reads the recruiting report for a job", async ({ browser }) => {
  test.setTimeout(240_000);
  const slow = { timeout: 30_000 };
  const stamp = Date.now();
  const hr = await (await browser.newContext()).newPage();
  await signInEnrollingMfa(hr, await createHrAccount());

  // The wording: edit, see the preview, save, go back to the built-in text
  await hr.getByRole("link", { name: "Recruiting", exact: true }).click();
  await hr.waitForURL("**/recruiting", slow);
  // The secondary actions are in one "More" menu; the retention settings open in a dialog from it
  await hr.getByRole("button", { name: "More" }).click();
  await hr.getByRole("menuitem", { name: "Applicant data retention" }).click();
  await expect(hr.getByRole("dialog", { name: "Applicant data retention" })).toBeVisible(slow);
  await hr.getByRole("dialog", { name: "Applicant data retention" }).getByRole("button", { name: "Close" }).click();
  await expect(hr.getByRole("dialog", { name: "Applicant data retention" })).toHaveCount(0);
  await hr.getByRole("button", { name: "More" }).click();
  await hr.getByRole("menuitem", { name: "Applicant emails" }).click();
  await hr.waitForURL("**/recruiting/email-templates", slow);
  await waitForHydration(hr, "#tpl-subject-received");
  await hr.locator("#tpl-subject-received").fill(`Salamat, {{first_name}}! ${stamp}`);
  await expect(hr.getByText(`Salamat, Ana! ${stamp}`).first()).toBeVisible(); // the preview fills the sample applicant in
  await hr.locator("#tpl-body-received").fill("Hi {{first_name}}, we got your application for {{job_title}}.");
  await hr.locator("section[aria-label='We received your application']").getByRole("button", { name: "Save" }).click();
  await expect(hr.getByText("Saved.")).toBeVisible(slow);
  await hr.reload();
  await expect(hr.locator("section[aria-label='We received your application']").getByText("Your wording")).toBeVisible(slow);
  await waitForHydration(hr, "#tpl-subject-received");
  hr.once("dialog", (d) => d.accept());
  await hr.locator("section[aria-label='We received your application']").getByRole("button", { name: "Use the built-in wording" }).click();
  await expect(hr.getByText("Back to the built-in wording.")).toBeVisible(slow);

  // A job with one applicant, and the report for it
  await hr.goto("/recruiting/new");
  await waitForHydration(hr, "#op-title");
  await hr.getByLabel("Job title").fill(`E2E Report ${stamp}`);
  await hr.getByLabel(/^Description/).fill("Support our clients with scheduling, inbox care and light data entry.");
  await hr.getByRole("button", { name: "Create job (draft)" }).click();
  await hr.waitForURL(/\/recruiting\/[0-9a-f-]{36}$/, slow);
  const openingId = hr.url().split("/").pop()!;
  await hr.getByRole("button", { name: "Publish job" }).click();
  await expect(hr.getByText("Open", { exact: true }).first()).toBeVisible(slow);
  const res = await hr.request.post("/api/careers/apply", {
    multipart: { openingId, fullName: `Rita Report${stamp}`, email: `rita.report${stamp}@example.com`, consent: "on", website: "", source: "facebook", resume: { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(await makePdf(["Assistant"])) } },
  });
  expect(res.ok()).toBe(true);

  await hr.goto(`/recruiting/reports?job=${openingId}`);
  await expect(hr.getByRole("heading", { name: "Recruiting reports" })).toBeVisible(slow);
  await expect(hr.getByText("1 applications.")).toBeVisible();
  await expect(hr.getByRole("cell", { name: "Facebook" })).toBeVisible();
  await expect(hr.getByRole("heading", { name: "How far applications got" })).toBeVisible();
});
