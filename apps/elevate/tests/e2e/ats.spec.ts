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
