import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { expect, type Page } from "@playwright/test";

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
export async function createHrAccount(): Promise<TestAccount> {
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
    await sql`insert into core.users (id, email) values (${id}, ${email})`;
    await sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee'), (${id}, 'hr_admin')`;
    await sql`update core.invitations set accepted_at = now() where lower(email) = ${email}`;
  } finally {
    await sql.end();
  }
  return { email, password };
}

/** A fresh Employee account with an active profile (so things can be addressed to them). */
export async function createEmployeeAccount(firstName: string, lastName: string): Promise<TestAccount & { employeeId: string }> {
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
    await sql`insert into core.users (id, email) values (${id}, ${email})`;
    await sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`;
    await sql`update core.invitations set accepted_at = now() where lower(email) = ${email}`;
    const [e] = await sql<{ id: string }[]>`
      insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
      values (${firstName}, ${lastName}, ${email}, 'active', ${id}) returning id`;
    return { email, password, employeeId: e.id };
  } finally {
    await sql.end();
  }
}

/** Password sign-in, then authenticator enrollment (first time) using a generated code. */
export async function signInEnrollingMfa(page: Page, account: TestAccount) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.waitForURL("**/mfa");
  const secretEl = page.locator("span.font-mono");
  await expect(secretEl).toBeVisible();
  const secret = (await secretEl.textContent())!.trim();

  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL("**/dashboard");
}
