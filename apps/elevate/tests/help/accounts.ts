import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import type { TestAccount } from "../e2e/helpers";

config({ path: ".env.local" });

// Screenshot accounts: the same kind of fake account the e2e tests make, but with natural names and emails (they show in lists such as
// Settings > Invitations) and safe to create again on every run. Local database only.

function assertLocal() {
  for (const u of [process.env.DATABASE_URL_DIRECT, process.env.NEXT_PUBLIC_SUPABASE_URL]) {
    if (!u || !["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error("The screenshot tool only runs against the local Supabase.");
  }
}

/** Creates the person (or takes the existing one), gives them a fresh password, removes any authenticator and sets their roles. */
export async function ensureShotAccount(first: string, last: string, roles: string[]): Promise<TestAccount> {
  assertLocal();
  const email = `${first}.${last}@example.com`.toLowerCase();
  const password = randomBytes(15).toString("base64url");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const sql = postgres(process.env.DATABASE_URL_DIRECT!, { prepare: false, onnotice: () => {} });
  try {
    const [known] = await sql<{ id: string }[]>`select id from core.users where lower(email) = ${email}`;
    let id = known?.id;
    if (id) {
      await admin.auth.admin.updateUserById(id, { password });
      const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: id });
      for (const f of factors?.factors ?? []) await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
    } else {
      await sql`insert into core.invitations (email, expires_at) values (${email}, now() + interval '1 day')`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
      id = data.user.id;
      // The quick tour is marked as seen so it does not cover the page.
      await sql`insert into core.users (id, email, onboarding_tour_seen_at) values (${id}, ${email}, ${new Date()})`;
      await sql`update core.invitations set accepted_at = now() where lower(email) = ${email}`;
    }
    // The seed may already hold a person with this work email: then the account is linked to that person.
    const [person] = await sql<{ id: string; user_id: string | null }[]>`select id, user_id from core.employees where lower(work_email) = ${email}`;
    if (person) {
      if (person.user_id !== id) await sql`update core.employees set user_id = ${id} where id = ${person.id}`;
    } else {
      await sql`
        insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
        values (${first}, ${last}, ${email}, 'active', ${id})`;
    }
    await sql`delete from core.user_roles where user_id = ${id}`;
    for (const role of new Set(["employee", ...roles])) await sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`;
    return { email, password };
  } finally {
    await sql.end();
  }
}
