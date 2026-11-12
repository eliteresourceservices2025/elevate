import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { endPayLinesOf, restorePaySettings, signInEnrollingMfa, waitForHydration } from "../e2e/helpers";
import { ensureShotAccount } from "./accounts";
import { dress } from "./dress";

// Takes the pictures for the payroll guides (how-payroll-works, prepare-a-pay-run, approve-a-pay-run, read-your-payslip).
// See docs/modules/help-center.md. Local database only.
//
// Unlike capture.spec.ts this does not use the shared screenshot accounts and adds no demo data of its own: it makes four NEW fake people
// (a Super Admin, a Preparer, an Approver and one person to pay) and then does a whole pay run through the real screens, taking a picture
// at each step. It never touches an account that already exists, and it puts the pay settings back and ends the pay line it made, so the
// database stays usable. Pay runs cannot be deleted: the demo run stays in the local database as an old, paid run.

const ASSETS = path.join(process.cwd(), "content", "help", "assets");

function assertLocal() {
  for (const u of [process.env.DATABASE_URL_DIRECT, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    if (!u || !["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error("The screenshot tool only runs against the local Supabase.");
  }
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The latest cutoff before October 2026 that has no pay run and no settings change on its first days: the demo run goes there. */
async function latestFreeCutoff(): Promise<{ start: string; end: string; later: string }> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    let year = 2026;
    let month = 9;
    let firstHalf = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const mm = String(month).padStart(2, "0");
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const start = `${year}-${mm}-${firstHalf ? "01" : "16"}`;
      const end = `${year}-${mm}-${firstHalf ? "15" : String(lastDay)}`;
      const later = addDays(start, 5);
      const [busy] = await sql<{ n: number }[]>`
        select (
          (select count(*) from payroll.pay_runs where status <> 'cancelled' and period_start <= ${end}::date and period_end >= ${start}::date)
          + (select count(*) from payroll.pay_settings where effective_from in (${start}::date, ${later}::date))
        )::int as n`;
      if (busy.n === 0) return { start, end, later };
      if (!firstHalf) firstHalf = true;
      else {
        firstHalf = false;
        month -= 1;
        if (month === 0) {
          month = 12;
          year -= 1;
        }
      }
    }
    throw new Error("Could not find a free pay period in the local database.");
  } finally {
    await sql.end();
  }
}

/** The four demo people start without a payroll level, so choosing one on the Payroll access page is a real change every time. */
async function clearLevels(emails: string[]): Promise<void> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`update core.users set payroll_access = null where lower(email) in ${sql(emails.map((e) => e.toLowerCase()))}`;
  } finally {
    await sql.end();
  }
}

async function employeeIdOf(email: string): Promise<string> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql<{ id: string }[]>`select id from core.employees where lower(work_email) = ${email.toLowerCase()}`;
    if (!row) throw new Error(`No person has the work email ${email}.`);
    return row.id;
  } finally {
    await sql.end();
  }
}

const taken: { article: string; file: string; alt: string }[] = [];

type Snap = { highlight?: Locator[]; /** Show only this many table rows (the lists hold leftovers from other tests). */ rows?: number; viewport?: { width: number; height: number }; scrollTo?: Locator; /** Put this part at the top of the screen */ scrollStart?: Locator };

async function snap(page: Page, article: string, file: string, alt: string, options: Snap = {}) {
  const original = page.viewportSize();
  if (options.viewport) await page.setViewportSize(options.viewport);
  await page.waitForLoadState("networkidle").catch(() => {});
  const css = ["[data-sonner-toaster] { display: none !important; }"];
  if (options.rows) css.push(`main table tbody tr:nth-child(n+${options.rows + 1}) { display: none !important; }`);
  await page.addStyleTag({ content: css.join("\n") });
  await options.scrollTo?.scrollIntoViewIfNeeded();
  await options.scrollStart?.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const highlight = options.highlight ?? [];
  await dress(page, highlight);
  await page.waitForTimeout(500);
  mkdirSync(path.join(ASSETS, article), { recursive: true });
  await page.screenshot({ path: path.join(ASSETS, article, `${file}.png`) });
  taken.push({ article, file: `${file}.png`, alt });
  console.log(`  ok  ${article}/${file}`);
  // Take the gold frames off again so they do not show in the next picture of the same page
  for (const target of highlight) {
    await target
      .first()
      .evaluate((el) => {
        const node = el as HTMLElement;
        node.style.outline = "";
        node.style.outlineOffset = "";
        node.style.borderRadius = "";
        node.style.boxShadow = "";
      })
      .catch(() => {});
  }
  if (options.viewport && original) await page.setViewportSize(original);
}

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
  return row;
}

test("take the payroll Help center screenshots", async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const period = await latestFreeCutoff();
  console.log(`  demo pay period ${period.start} to ${period.end}`);

  const adminAccount = await ensureShotAccount("Helen", "Ortiz", ["super_admin"]);
  const prepAccount = await ensureShotAccount("Grace", "Delgado", ["hr_admin"]);
  const apprAccount = await ensureShotAccount("Victor", "Lim", ["executive"]);
  const workAccount = await ensureShotAccount("Rina", "Alcantara", []);
  // Someone who has never been paid, for the picture of an empty My pay (Rina has payslips from earlier runs of this tool). Only the initials show.
  const newcomerAccount = await ensureShotAccount("Tess", `Navarro${Date.now().toString(36)}`, []);
  const workerId = await employeeIdOf(workAccount.email);
  await clearLevels([adminAccount.email, prepAccount.email, apprAccount.email, workAccount.email]);

  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "light", acceptDownloads: true });
    return context.newPage();
  };
  const adminPage = await open();
  const prepPage = await open();
  const apprPage = await open();
  const workPage = await open();
  const newcomerPage = await open();
  await signInEnrollingMfa(adminPage, adminAccount);
  await signInEnrollingMfa(prepPage, prepAccount);
  await signInEnrollingMfa(apprPage, apprAccount);
  await signInEnrollingMfa(workPage, workAccount);
  await signInEnrollingMfa(newcomerPage, newcomerAccount);

  let settingsTouched = false;
  try {
    // The person to be paid, before any payslip exists.
    await newcomerPage.goto("/my-pay");
    await expect(newcomerPage.getByText("No statements yet")).toBeVisible();
    await snap(newcomerPage, "read-your-payslip", "01-no-payslip-yet", "My payment statements before a pay run is paid: it says there are no statements yet.");

    // The Super Admin chooses who has payroll access.
    await adminPage.goto("/settings/payroll-access");
    await waitForHydration(adminPage, "#payroll-access-filter");
    const prepRow = await setLevel(adminPage, prepAccount.email, "Preparer");
    await snap(adminPage, "how-payroll-works", "02-choose-who-has-access", "Settings, Payroll access: a Super Admin picks a level for one person. The list is filtered to that person.", {
      highlight: [prepRow.getByRole("combobox")],
    });
    await setLevel(adminPage, apprAccount.email, "Approver");

    // The Super Admin sets who signs the payslips: a name, a title and a drawn demo signature (invented), through the real screen.
    await adminPage.goto("/settings/payroll-signatory");
    await waitForHydration(adminPage, "#signatory-name");
    const signaturePng = await adminPage.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 520;
      canvas.height = 150;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 520, 150);
      ctx.strokeStyle = "#1c2a6b";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(30, 100);
      ctx.bezierCurveTo(60, 20, 90, 20, 100, 90);
      ctx.bezierCurveTo(110, 130, 140, 40, 175, 70);
      ctx.bezierCurveTo(200, 95, 215, 95, 240, 60);
      ctx.bezierCurveTo(262, 30, 270, 100, 300, 85);
      ctx.bezierCurveTo(340, 65, 360, 110, 410, 80);
      ctx.moveTo(30, 122);
      ctx.bezierCurveTo(150, 110, 300, 135, 440, 118);
      ctx.stroke();
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const signatureFile = `${os.tmpdir()}/help-demo-signature.png`;
    writeFileSync(signatureFile, Buffer.from(signaturePng, "base64"));
    await adminPage.locator("#signatory-name").fill("Carmen Dela Rosa");
    await adminPage.locator("#signatory-title").fill("Human Resources Director");
    await adminPage.locator("#signatory-picture").setInputFiles(signatureFile);
    await expect(adminPage.locator("form img")).toBeVisible();
    await snap(adminPage, "how-payroll-works", "03-statement-signatory", "Settings, Payment statement signatory: the name, the title and the signature picture that print on every contractor payment statement.", {
      viewport: { width: 1280, height: 900 },
      highlight: [adminPage.locator("#signatory-name"), adminPage.locator("#signatory-picture")],
    });
    await adminPage.getByRole("button", { name: "Save signatory" }).click();
    await expect(adminPage.getByText("Signatory saved.")).toBeVisible();

    // Settings: the overtime (OT) rate for this period.
    await prepPage.goto("/payroll/settings");
    await snap(prepPage, "prepare-a-pay-run", "01-settings", "Payroll, Settings: the cutoff divisor and the overtime (OT) rates.", {
      rows: 2,
      highlight: [prepPage.getByRole("button", { name: "Change settings" })],
    });
    await prepPage.getByRole("button", { name: "Change settings" }).click();
    await waitForHydration(prepPage, "#set-extraRegular");
    settingsTouched = true; // from here on, the finally block puts the old settings back if the run stops early
    await prepPage.locator("#set-from").fill(period.start);
    await prepPage.locator("#set-extraRegular").fill("125");
    await snap(prepPage, "prepare-a-pay-run", "02-change-settings", "The Change settings window: the date the new rates start and the overtime (OT) rate for a regular day.", {
      highlight: [prepPage.locator("#set-extraRegular")],
    });
    await prepPage.getByRole("button", { name: "Save settings" }).click();
    await expect(prepPage.getByText("Settings saved.")).toBeVisible();
    await expect(prepPage.getByRole("dialog")).toHaveCount(0);

    // Rates: the pay lines, and adding one.
    await prepPage.goto("/payroll/rates");
    await snap(prepPage, "prepare-a-pay-run", "03-rates", "Payroll, Rates: one row for each pay line, with the Add pay line button.", {
      highlight: [prepPage.getByRole("button", { name: "Add pay line" })],
    });
    await prepPage.getByRole("button", { name: "Add pay line" }).click();
    await waitForHydration(prepPage, "#add-person");
    const option = prepPage.locator("#add-person option", { hasText: "Rina Alcantara" });
    await prepPage.locator("#add-person").selectOption(await option.getAttribute("value"));
    await prepPage.locator("#add-monthly").fill("24,000.00");
    await prepPage.locator("#add-from").fill(period.start);
    await snap(prepPage, "prepare-a-pay-run", "04-add-pay-line", "The Add pay line window: the person, the monthly rate in pesos and the date it starts.", {
      highlight: [prepPage.locator("#add-person"), prepPage.locator("#add-monthly")],
    });
    await prepPage.getByRole("dialog").getByRole("button", { name: "Add pay line" }).click();
    await expect(prepPage.getByText("Pay line added.")).toBeVisible();

    // A new run for the cutoff.
    await prepPage.goto("/payroll");
    await prepPage.getByRole("button", { name: "New run" }).click();
    await waitForHydration(prepPage, "#run-start");
    await prepPage.locator("#run-start").fill(period.start);
    await prepPage.locator("#run-end").fill(period.end);
    await snap(prepPage, "prepare-a-pay-run", "05-new-run", "The New run window: the first and last day of one cutoff.", {
      highlight: [prepPage.locator("#run-start"), prepPage.locator("#run-end")],
    });
    await prepPage.getByRole("button", { name: "Create run" }).click();
    await prepPage.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
    const runId = prepPage.url().split("/").pop()!;
    const worker = () => prepPage.getByRole("row").filter({ hasText: "Rina Alcantara" });
    await expect(worker()).toBeVisible();
    await snap(prepPage, "prepare-a-pay-run", "06-worksheet", "A new run: the checks above the worksheet, and one line for each person.", {
      viewport: { width: 1280, height: 1000 },
      highlight: [worker().getByRole("button", { name: /^Actions for/ })],
    });

    // Overtime for the person.
    await worker().getByRole("button", { name: /^Actions for/ }).click();
    await prepPage.getByRole("menuitem", { name: "Amounts" }).click();
    await waitForHydration(prepPage, "form select");
    await prepPage.getByLabel("What to enter").selectOption({ label: "Overtime (OT), regular day" });
    await prepPage.getByLabel("Hours or minutes").selectOption("m");
    await prepPage.getByLabel("Amount", { exact: true }).fill("120");
    await snap(prepPage, "prepare-a-pay-run", "07-amounts", "The Amounts window: what to enter, and the amount (here 120 minutes of overtime).", {
      highlight: [prepPage.getByLabel("What to enter"), prepPage.getByLabel("Amount", { exact: true })],
    });
    await prepPage.getByRole("button", { name: "Save amount" }).click();
    await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
    await expect(prepPage.getByRole("dialog")).toHaveCount(0);

    // A named allowance (itemized), then a reimbursement and a bonus.
    await worker().getByRole("button", { name: /^Actions for/ }).click();
    await prepPage.getByRole("menuitem", { name: "Amounts" }).click();
    await waitForHydration(prepPage, "form select");
    await prepPage.getByLabel("What to enter").selectOption({ label: "Allowance" });
    await prepPage.getByLabel(/^Name of this allowance/).fill("Health allowance");
    await prepPage.getByLabel("Amount", { exact: true }).fill("500");
    await snap(prepPage, "prepare-a-pay-run", "08-named-allowance", "The Amounts window for an allowance: give it a name, like Health allowance, and an amount. Add as many named lines as you need.", {
      highlight: [prepPage.getByLabel(/^Name of this allowance/), prepPage.getByLabel("Amount", { exact: true })],
    });
    await prepPage.getByRole("button", { name: "Save amount" }).click();
    await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
    await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    for (const [type, label, amount] of [
      ["Reimbursement", "Supplies", "120"],
      ["Bonus", "Performance bonus", "2000"],
    ] as const) {
      await worker().getByRole("button", { name: /^Actions for/ }).click();
      await prepPage.getByRole("menuitem", { name: "Amounts" }).click();
      await waitForHydration(prepPage, "form select");
      await prepPage.getByLabel("What to enter").selectOption({ label: type });
      await prepPage.getByLabel(new RegExp(`^Name of this ${type.toLowerCase()}`)).fill(label);
      await prepPage.getByLabel("Amount", { exact: true }).fill(amount);
      await prepPage.getByRole("button", { name: "Save amount" }).click();
      await expect(prepPage.getByText("Amount saved.").first()).toBeVisible();
      await expect(prepPage.getByRole("dialog")).toHaveCount(0);
    }

    // Every line is checked by a Preparer.
    const rowMenus = prepPage.getByRole("button", { name: /^Actions for/ });
    await rowMenus.first().waitFor(); // the menus appear once the page has refreshed after the last amount
    const lineCount = await rowMenus.count();
    for (let i = 0; i < lineCount; i++) {
      await rowMenus.nth(i).click();
      const check = prepPage.getByRole("menuitem", { name: /^(Mark as checked|Check again)$/ });
      if ((await check.count()) > 0 && (await check.isEnabled())) {
        await check.click();
        await expect(prepPage.getByText("Line checked.").first()).toBeVisible();
      } else {
        await prepPage.keyboard.press("Escape"); // the Preparer's own line: another Preparer checks it
      }
    }
    const send = prepPage.getByRole("button", { name: "Send for review" });
    await expect(send).toBeEnabled();
    await snap(prepPage, "prepare-a-pay-run", "09-ready", "Every line checked: Send for review is ready.", {
      viewport: { width: 1280, height: 1000 },
      scrollTo: send,
      highlight: [send],
    });
    await send.click();
    await expect(prepPage.getByText("Sent for review. The Approvers have been told.")).toBeVisible();

    // The Approver reads the run, sees the Send back window, and approves.
    await apprPage.goto(`/payroll/${runId}`);
    const approve = apprPage.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeEnabled();
    await snap(apprPage, "approve-a-pay-run", "01-in-review", "A run in review as the Approver sees it: the status, the checks and the worksheet with every line.", {
      viewport: { width: 1280, height: 1000 },
    });
    await snap(apprPage, "approve-a-pay-run", "02-approve-bar", "The bottom of the run: Approve and Send back.", {
      viewport: { width: 1280, height: 1000 },
      scrollTo: approve,
      highlight: [approve, apprPage.getByRole("button", { name: "Send back" })],
    });
    await apprPage.getByRole("button", { name: "Send back" }).first().click();
    await expect(apprPage.getByRole("dialog")).toBeVisible();
    await apprPage.getByRole("dialog").getByRole("textbox").first().fill("Please check the overtime on one line.");
    await snap(apprPage, "approve-a-pay-run", "03-send-back", "The Send back window: a short note about what needs to change.", {
      highlight: [apprPage.getByRole("dialog").getByRole("textbox").first()],
    });
    // The window holds typed text, so closing it asks first (Discard what you wrote?): discard it
    await apprPage.keyboard.press("Escape");
    await apprPage.getByRole("button", { name: "Discard changes" }).click();
    await expect(apprPage.getByRole("dialog")).toHaveCount(0);
    const approveNow = apprPage.getByRole("button", { name: "Approve", exact: true });
    await expect(approveNow).toBeEnabled();
    await approveNow.click();
    await expect(apprPage.getByText("Run approved.").first()).toBeVisible();

    // Payment: the Remitly list and recording each payment.
    await prepPage.goto(`/payroll/${runId}`);
    const download = prepPage.getByRole("button", { name: "Download Remitly list" });
    await expect(download).toBeVisible();
    const payment = prepPage.getByRole("heading", { name: "Payment", exact: true });
    await snap(prepPage, "prepare-a-pay-run", "10-payment", "An approved run: the Payment section with Download Remitly list and a Mark paid button for each person.", {
      viewport: { width: 1280, height: 1000 },
      scrollStart: payment,
      highlight: [download, prepPage.getByRole("button", { name: "Mark paid" }).first()],
    });
    let n = 0;
    const markPaid = prepPage.getByRole("button", { name: "Mark paid" });
    for (let guard = 0; guard < 20 && (await markPaid.count()) > 0; guard++) {
      const before = await markPaid.count();
      await markPaid.first().click();
      const dialog = prepPage.getByRole("dialog");
      await dialog.getByLabel("Remitly reference").fill(`DEMO-REF-${String(++n).padStart(3, "0")}`);
      if (n === 1) await snap(prepPage, "prepare-a-pay-run", "11-mark-paid", "The Mark paid window: the Remitly reference and the date it was paid.", { highlight: [dialog.getByLabel("Remitly reference")] });
      await dialog.getByRole("button", { name: "Mark paid" }).click();
      await expect(prepPage.getByText("Payment recorded.").first()).toBeVisible();
      await expect(prepPage.getByRole("dialog")).toHaveCount(0);
      await expect(markPaid).toHaveCount(before - 1);
    }
    await expect(prepPage.getByText("Everyone on this run is paid.")).toBeVisible();
    await snap(prepPage, "prepare-a-pay-run", "12-all-paid", "Everyone on the run is paid: the run is now Paid.", { viewport: { width: 1280, height: 1000 }, scrollStart: payment });

    // The Approver releases the statements, and only then does the person to be paid read theirs.
    await apprPage.goto(`/payroll/statements/${runId}`);
    await apprPage.getByRole("button", { name: "Release to everyone" }).click();
    await apprPage.getByRole("button", { name: "Release now" }).click();
    await expect(apprPage.getByText(/^Released \d+ statements?\.$/)).toBeVisible();
    await workPage.goto("/my-pay");
    // Newest payslip first: earlier runs of this tool may have left older ones for the same person
    const link = workPage.getByRole("link", { name: "Download PDF" }).first();
    await expect(link).toBeVisible();
    const viewLink = workPage.getByRole("link", { name: /View the contractor payment statement for/ }).first();
    await expect(viewLink).toBeVisible();
    await snap(workPage, "read-your-payslip", "02-my-pay", "My payment statements after the run is paid: the pay period, the total payable compensation, View and Download PDF.", { highlight: [viewLink, link] });
    // The payslip on screen, for the run made here
    await workPage.goto(`/my-pay/${runId}`);
    await expect(workPage.getByText("Carmen Dela Rosa")).toBeVisible();
    await snap(workPage, "read-your-payslip", "03-payslip", "A contractor payment statement on screen: the period, how it was paid, the pay line by line, the total payable compensation and who signed it.", { viewport: { width: 1280, height: 1900 } });
    await workPage.goto("/my-pay");
    const bell = workPage.getByRole("button", { name: /notification/i }).first();
    if (await bell.count()) {
      await bell.click();
      await expect(workPage.getByText("Your contractor payment statement is ready").first()).toBeVisible();
      await snap(workPage, "read-your-payslip", "04-notice", "The bell in the header shows the notice: Your contractor payment statement is ready.", { highlight: [workPage.getByText("Your contractor payment statement is ready").first()] });
      await workPage.keyboard.press("Escape");
    } else {
      console.log("  note  read-your-payslip/04-notice: the notification button was not found");
    }

    // The change history, and the list of runs.
    await apprPage.goto(`/payroll/history?run=${runId}`);
    await expect(apprPage.getByRole("row").filter({ hasText: "Amount saved on a line" }).first()).toBeVisible();
    await snap(apprPage, "approve-a-pay-run", "04-history", "Payroll, History, filtered to one run: who changed what and when, with the old and new values.", {
      viewport: { width: 1280, height: 1000 },
    });
    // The menu and the list of runs (the list also holds leftovers from other tests, so only the newest rows are shown)
    await prepPage.goto("/payroll");
    await expect(prepPage.getByRole("heading", { name: "Payroll", exact: true })).toBeVisible();
    await snap(prepPage, "how-payroll-works", "01-menu", "The left menu for a Preparer or Approver: Payroll under Admin. The Runs tab lists each run with its period and status.", {
      viewport: { width: 1280, height: 1000 },
      highlight: [prepPage.locator('a[href="/payroll"]')],
      rows: 3,
    });
  } finally {
    try {
      if (settingsTouched) await restorePaySettings(period.start, period.later);
    } finally {
      await endPayLinesOf(workerId);
    }
  }

  // The list of pictures taken (with their captions): this run updates only its own entries
  const listFile = path.join(ASSETS, "_shots.json");
  const earlier: typeof taken = existsSync(listFile) ? JSON.parse(readFileSync(listFile, "utf8")) : [];
  const merged = [...earlier.filter((e) => !taken.some((t) => t.article === e.article && t.file === e.file)), ...taken];
  writeFileSync(listFile, `${JSON.stringify(merged, null, 2)}\n`);
});
