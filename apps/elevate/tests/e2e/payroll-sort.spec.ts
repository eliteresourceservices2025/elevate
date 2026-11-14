import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { createEmployeeAccount, endPayLinesOf, pickFreePayrollPeriod, signInEnrollingMfa, waitForHydration } from "./helpers";

// Needs the local Supabase with migrations applied. Invented people and clients only. Five people in a run (two clients and one with none,
// five different monthly rates), in a random past period that is free in the local database. Checks sorting the run sheet from the Sort menu
// and from the column titles, grouping by client with each client's totals, that filters and paging keep the sort, a bad sort in the address,
// the Rates tab, and a phone.

const SHOTS = "test-results/sort";

async function setLevel(page: Page, email: string, level: "Preparer" | "Approver") {
  await page.goto("/settings/payroll-access");
  await page.locator("#payroll-access-filter").fill(email);
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByRole("combobox").selectOption({ label: level });
  await expect(page.getByText("Payroll access updated.")).toBeVisible();
}

test("payroll: sort the run sheet and the Rates tab, and group by client", async ({ browser }) => {
  test.setTimeout(420_000);
  mkdirSync(SHOTS, { recursive: true });
  const stamp = Date.now().toString(36);
  const period = await pickFreePayrollPeriod();
  const clientA = `Aclient${stamp}`;
  const clientZ = `Zclient${stamp}`;

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    for (const name of [clientA, clientZ]) await sql`insert into core.clients (id, name) values (${randomUUID()}, ${name})`;
  } finally {
    await sql.end();
  }

  // Last name, client, monthly rate. By name: Alpha, Bravo, Charlie, Delta, Echo.
  const people = [
    { last: `Alpha${stamp}`, client: clientZ, rate: "20,000.00" },
    { last: `Bravo${stamp}`, client: clientA, rate: "30,000.00" },
    { last: `Charlie${stamp}`, client: null, rate: "25,000.00" },
    { last: `Delta${stamp}`, client: clientA, rate: "10,000.00" },
    { last: `Echo${stamp}`, client: clientZ, rate: "40,000.00" },
  ];
  const admin = await createEmployeeAccount("Sam", `Admin${stamp}`, { roles: ["super_admin"] });
  const preparer = await createEmployeeAccount("Pia", `Preparer${stamp}`);
  const workers = [];
  for (const p of people) workers.push(await createEmployeeAccount("Sort", p.last));

  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage();
  const p = await ctx.newPage();
  await signInEnrollingMfa(a, admin);
  await signInEnrollingMfa(p, preparer);

  /** The order of our five people in the sheet (the other rows, if any, are not ours). */
  const sheetOrder = async () => {
    const texts = await p.locator('tr[id^="row-"]').evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    return texts.map((t) => /(Alpha|Bravo|Charlie|Delta|Echo)/.exec(t)?.[1]).filter(Boolean);
  };
  const ratesOrder = async () => {
    const texts = await p.getByRole("row").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    return texts.map((t) => (t.includes(stamp) ? /(Alpha|Bravo|Charlie|Delta|Echo)/.exec(t)?.[1] : undefined)).filter(Boolean);
  };
  const chooseSort = async (label: string) => {
    await p.getByRole("button", { name: /^Sort the list/ }).click();
    await p.getByRole("menuitem", { name: label }).click();
  };

  try {
    await setLevel(a, preparer.email, "Preparer");

    // The pay lines.
    for (let i = 0; i < people.length; i++) {
      await p.goto("/payroll/rates");
      await p.getByRole("button", { name: "Add contractor" }).click();
      await waitForHydration(p, "#add-person");
      const option = p.locator("#add-person option", { hasText: `Sort ${people[i].last}` });
      await p.locator("#add-person").selectOption(await option.getAttribute("value"));
      if (people[i].client) await p.locator("#add-client").selectOption({ label: people[i].client! });
      await p.locator("#add-monthly").fill(people[i].rate);
      await p.getByRole("dialog").getByText("Pick another date").click();
      await p.locator("#add-from").fill(period.start);
      await p.getByRole("dialog").getByRole("button", { name: "Add contractor" }).click();
      await expect(p.getByText("Rate added.")).toBeVisible();
      await expect(p.getByRole("dialog")).toHaveCount(0);
    }

    // ---- The Rates tab: by name to start, then by monthly rate, then name Z to A ----
    await p.goto("/payroll/rates");
    expect(await ratesOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    await p.getByRole("columnheader").getByRole("link", { name: /Monthly rate/ }).click();
    await p.waitForURL(/sort=rate_desc/);
    expect(await ratesOrder()).toEqual(["Echo", "Bravo", "Charlie", "Alpha", "Delta"]);
    await expect(p.getByRole("columnheader", { name: /Monthly rate/ })).toHaveAttribute("aria-sort", "descending");
    await chooseSort("Name, Z to A");
    await p.waitForURL(/sort=name_desc/);
    expect(await ratesOrder()).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
    await p.goto("/payroll/rates?sort=rate_asc");
    expect(await ratesOrder()).toEqual(["Delta", "Alpha", "Charlie", "Bravo", "Echo"]);
    await p.screenshot({ path: `${SHOTS}/1-rates-sorted.png` });

    // ---- A run ----
    await p.goto("/payroll");
    await p.getByRole("button", { name: "New run" }).click();
    await waitForHydration(p, "#run-start");
    await p.locator("#run-start").fill(period.start);
    await p.locator("#run-end").fill(period.end);
    await p.getByRole("button", { name: "Create run" }).click();
    await p.waitForURL(/\/payroll\/[0-9a-f-]{36}$/);
    const runId = p.url().split("/").pop()!;

    // By name to start.
    expect(await sheetOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    await expect(p.getByRole("button", { name: /^Sort the list. Now: Name, A to Z/ })).toBeVisible();

    // The Sort menu: monthly rate, high to low.
    await p.getByRole("button", { name: /^Sort the list/ }).click();
    await p.screenshot({ path: `${SHOTS}/2-sort-menu.png` });
    await p.getByRole("menuitem", { name: "Monthly rate, high to low" }).click();
    await p.waitForURL(/sort=rate_desc/);
    expect(await sheetOrder()).toEqual(["Echo", "Bravo", "Charlie", "Alpha", "Delta"]);
    await expect(p.getByRole("button", { name: /Now: Monthly rate, high to low/ })).toBeVisible();

    // The sort survives a reload, and total payable follows the monthly rate here.
    await p.reload();
    expect(await sheetOrder()).toEqual(["Echo", "Bravo", "Charlie", "Alpha", "Delta"]);
    await chooseSort("Total payable, high to low");
    await p.waitForURL(/sort=net_desc/);
    expect(await sheetOrder()).toEqual(["Echo", "Bravo", "Charlie", "Alpha", "Delta"]);

    // Column titles: Person sorts A to Z, then Z to A; the arrow and aria-sort show which way.
    await p.locator("th[aria-sort]").filter({ hasText: /^Person/ }).getByRole("link").click();
    await p.waitForURL((u) => !u.search.includes("sort=net_desc"));
    expect(await sheetOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    await expect(p.locator("th[aria-sort]").filter({ hasText: /^Person/ })).toHaveAttribute("aria-sort", "ascending");
    await p.locator("th[aria-sort]").filter({ hasText: /^Person/ }).getByRole("link").click();
    await p.waitForURL(/sort=name_desc/);
    expect(await sheetOrder()).toEqual(["Echo", "Delta", "Charlie", "Bravo", "Alpha"]);
    await expect(p.locator("th[aria-sort]").filter({ hasText: /^Person/ })).toHaveAttribute("aria-sort", "descending");

    // Client, then name: clients A to Z, No client last, people in name order inside each.
    await chooseSort("Client, then name");
    await p.waitForURL(/sort=client_asc/);
    expect(await sheetOrder()).toEqual(["Bravo", "Delta", "Alpha", "Echo", "Charlie"]);

    // ---- Group by client: a heading for each client with its totals, then the chosen sort inside each ----
    await p.getByRole("link", { name: "Group by client" }).first().click();
    await p.waitForURL(/group=client/);
    await expect(p.locator("[data-client-heading]")).toHaveCount(3);
    const headings = await p.locator("[data-client-heading]").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(headings[0]).toContain(clientA);
    expect(headings[0]).toMatch(/2 people/);
    expect(headings[0]).toMatch(/total payable/);
    expect(headings[1]).toContain(clientZ);
    expect(headings[2]).toContain("No client");
    await p.evaluate(() => document.getElementById("pay-sheet")?.scrollIntoView());
    await p.screenshot({ path: `${SHOTS}/3-grouped.png` });
    await chooseSort("Monthly rate, high to low");
    await p.waitForURL(/sort=rate_desc/);
    expect(new URL(p.url()).searchParams.get("group")).toBe("client"); // the grouping stayed
    expect(await sheetOrder()).toEqual(["Bravo", "Delta", "Echo", "Alpha", "Charlie"]);

    // A filter chip keeps the sort and the grouping, and so does turning the filter off again.
    await p.getByRole("navigation", { name: "Filter the sheet" }).getByRole("link", { name: /^Needs attention/ }).click();
    await p.waitForURL(/focus=attention/);
    const kept = new URL(p.url()).searchParams;
    expect(kept.get("sort")).toBe("rate_desc");
    expect(kept.get("group")).toBe("client");
    expect(await sheetOrder()).toEqual(["Bravo", "Delta", "Echo", "Alpha", "Charlie"]);
    await p.getByRole("navigation", { name: "Filter the sheet" }).getByRole("link", { name: /^All/ }).click();
    expect(new URL(p.url()).searchParams.get("sort")).toBe("rate_desc");

    // A page size of 10 still shows them in order, and "Go to this line" still lands on the right row in this order.
    await p.goto(`/payroll/${runId}?sort=rate_desc&size=10`);
    await p.getByText(/^See every note by person/).click();
    await p.locator("[data-readiness-person]").filter({ hasText: `Delta${stamp}` }).getByRole("link", { name: "Go to this line" }).click();
    await expect(p.locator('tr[id^="row-"]').filter({ hasText: `Delta${stamp}` })).toBeInViewport();

    // A bad value in the address is the default order, not an error.
    await p.goto(`/payroll/${runId}?sort=bogus&group=nothing`);
    expect(await sheetOrder()).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    await expect(p.locator("[data-client-heading]")).toHaveCount(0);

    // ---- A phone: the menu is there and the cards are grouped under a heading for each client ----
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(`/payroll/${runId}?sort=rate_desc&group=client`);
    await expect(p.getByRole("button", { name: /^Sort the list/ })).toBeVisible();
    await expect(p.getByRole("heading", { name: clientA })).toBeVisible();
    const cards = await p.locator('li[id^="card-"]').evaluateAll((els) => els.map((e) => e.textContent ?? ""));
    expect(cards.map((t) => /(Alpha|Bravo|Charlie|Delta|Echo)/.exec(t)?.[1]).filter(Boolean)).toEqual(["Bravo", "Delta", "Echo", "Alpha", "Charlie"]);
    await p.evaluate(() => document.querySelector("li[id^=card-]")?.scrollIntoView({ block: "center" }));
    await p.screenshot({ path: `${SHOTS}/4-phone-grouped.png` });
  } finally {
    for (const w of workers) await endPayLinesOf(w.employeeId);
  }
});
