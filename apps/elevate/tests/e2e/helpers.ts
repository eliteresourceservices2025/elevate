import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { expect, type Locator, type Page } from "@playwright/test";

// End-to-end helpers. They talk to the LOCAL Supabase started with `supabase start` and only ever
// create throwaway accounts with fake data.
config({ path: ".env.local" });

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 time-based one-time password (SHA-1, 6 digits, 30 second step). */
export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

function assertLocal() {
  const urls = [process.env.DATABASE_URL_DIRECT, process.env.NEXT_PUBLIC_SUPABASE_URL];
  for (const u of urls) {
    if (!u || !["127.0.0.1", "localhost"].includes(new URL(u).hostname)) {
      throw new Error("E2E tests only run against the local Supabase (supabase start).");
    }
  }
}

export type TestAccount = { email: string; password: string };

/** A fresh HR Admin account: invited, confirmed, and holding the HR Admin role. */
export async function createHrAccount(options: { tour?: boolean } = {}): Promise<TestAccount> {
  assertLocal();
  const email = `e2e.hr.${Date.now()}.${randomBytes(2).toString("hex")}@example.com`;
  const password = randomBytes(15).toString("base64url");

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into core.invitations (email, expires_at) values (${email}, now() + interval '1 day')`;
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not create test account: ${error?.message}`);
    const id = data.user.id ?? randomUUID();
    // The quick tour starts by itself for a new account; tests skip it (it would cover the page) unless they ask for it.
    await sql`insert into core.users (id, email, onboarding_tour_seen_at) values (${id}, ${email}, ${options.tour ? null : new Date()})`;
    await sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee'), (${id}, 'hr_admin')`;
    await sql`update core.invitations set accepted_at = now() where lower(email) = ${email}`;
  } finally {
    await sql.end();
  }
  return { email, password };
}

/** A fresh Employee account with an active profile (so things can be addressed to them). */
export async function createEmployeeAccount(
  firstName: string,
  lastName: string,
  options: { roles?: string[]; managerId?: string; tour?: boolean } = {},
): Promise<TestAccount & { employeeId: string }> {
  assertLocal();
  const email = `e2e.emp.${Date.now()}.${randomBytes(2).toString("hex")}@example.com`;
  const password = randomBytes(15).toString("base64url");

  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`insert into core.invitations (email, expires_at) values (${email}, now() + interval '1 day')`;
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error(`Could not create test account: ${error?.message}`);
    const id = data.user.id ?? randomUUID();
    await sql`insert into core.users (id, email, onboarding_tour_seen_at) values (${id}, ${email}, ${options.tour ? null : new Date()})`;
    for (const role of new Set(["employee", ...(options.roles ?? [])])) await sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`;
    await sql`update core.invitations set accepted_at = now() where lower(email) = ${email}`;
    const [e] = await sql<{ id: string }[]>`
      insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
      values (${firstName}, ${lastName}, ${email}, 'active', ${id}, ${options.managerId ?? null}) returning id`;
    return { email, password, employeeId: e.id };
  } finally {
    await sql.end();
  }
}

/** Password sign-in, then authenticator enrollment (first time) using a generated code. */
export async function signInEnrollingMfa(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL(/\/mfa(\?|$)/);
  const secretEl = page.locator("span.font-mono");
  await expect(secretEl).toBeVisible();
  const secret = (await secretEl.textContent())!.trim();

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Waits until React has taken over an element. In the dev server a page can load before its client code runs, and
 * text typed into a controlled field before then is lost from React's state.
 */
export async function waitForHydration(page: Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el !== null && Object.keys(el).some((k) => k.startsWith("__reactProps"));
  }, selector);
}

/** Same as waitForHydration, for a button or field you are about to use: waits until React owns it, then returns it. */
export async function hydrated(locator: Locator): Promise<Locator> {
  await expect.poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true);
  return locator;
}

// ---- Payroll ----
// Payroll tables are append-only and a run is unique per period, so a payroll test works in a made-up period long in the past (random,
// cutoff, checked free in the local database) and, when it is done, ends the pay lines it made so they never leak into a later test's run.

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * A cutoff (the 1st to the 15th, or the 16th to the last day of a month; payroll accepts nothing else) between 2001 and 2019 where no
 * live run exists, no pay line is in force and no pay settings version is dated on the start or on `later` (five days after the start).
 * Pay settings are chosen by the day a period starts, so a test can save a version on `start` and one on `later` that puts the old
 * values back, leaving today's settings as they were.
 */
export async function pickFreePayrollPeriod(): Promise<{ start: string; end: string; later: string }> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      const year = 2001 + (randomBytes(1)[0] % 19);
      const month = 1 + (randomBytes(1)[0] % 12);
      const firstHalf = randomBytes(1)[0] % 2 === 0;
      const mm = String(month).padStart(2, "0");
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const start = `${year}-${mm}-${firstHalf ? "01" : "16"}`;
      const end = `${year}-${mm}-${firstHalf ? "15" : String(lastDay)}`;
      const later = addDays(start, 5);
      const [busy] = await sql<{ n: number }[]>`
        select (
          (select count(*) from payroll.pay_runs where status <> 'cancelled' and period_start <= ${end}::date and period_end >= ${start}::date)
          + (select count(*) from payroll.pay_settings where effective_from in (${start}::date, ${later}::date))
          + (select count(*) from (
               select distinct on (line_key) ends_on, effective_from from payroll.pay_lines order by line_key, effective_from desc, created_at desc
             ) l where l.effective_from <= ${end}::date and (l.ends_on is null or l.ends_on >= ${start}::date))
        )::int as n`;
      if (busy.n === 0) return { start, end, later };
    }
    throw new Error("Could not find a free pay period in the local database.");
  } finally {
    await sql.end();
  }
}

/** Gives every pay line a person has an END version dated its first day (copied in SQL, ciphertext included), so it is never in force again. */
export async function endPayLinesOf(employeeId: string): Promise<void> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`
      insert into payroll.pay_lines (id, line_key, employee_id, client_id, alias, hours_per_day, payment_method, fte, ends_on, effective_from, amounts_enc, created_by)
      select gen_random_uuid(), l.line_key, l.employee_id, l.client_id, l.alias, l.hours_per_day, l.payment_method, l.fte, l.effective_from, l.effective_from, l.amounts_enc, l.created_by
      from (
        select distinct on (line_key) * from payroll.pay_lines where employee_id = ${employeeId} order by line_key, effective_from desc, created_at desc
      ) l
      where l.ends_on is null`;
  } finally {
    await sql.end();
  }
}

/**
 * Puts the pay settings back: inserts a copy of the version that was in force just before `changedOn`, dated `restoreOn`, unless a
 * version dated `restoreOn` already exists. Safe to call whether or not the test got as far as its own restoring step.
 */
export async function restorePaySettings(changedOn: string, restoreOn: string): Promise<void> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    await sql`
      insert into payroll.pay_settings (effective_from, cutoff_divisor, extra_regular_bp, extra_holiday_bp, extra_rest_day_bp, extra_rest_day_over_8_bp, holiday_bp, change_warn_bp, created_by)
      select ${restoreOn}::date, cutoff_divisor, extra_regular_bp, extra_holiday_bp, extra_rest_day_bp, extra_rest_day_over_8_bp, holiday_bp, change_warn_bp, created_by
      from payroll.pay_settings
      where effective_from < ${changedOn}::date
        and not exists (select 1 from payroll.pay_settings where effective_from = ${restoreOn}::date)
      order by effective_from desc, created_at desc
      limit 1`;
  } finally {
    await sql.end();
  }
}

/** Any other run than the given one, for "a payslip that is not yours" checks; null when the database has none. */
export async function anotherPayRunId(notThis: string): Promise<string | null> {
  assertLocal();
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql<{ id: string }[]>`select id from payroll.pay_runs where id <> ${notThis}::uuid order by created_at desc limit 1`;
    return row?.id ?? null;
  } finally {
    await sql.end();
  }
}
