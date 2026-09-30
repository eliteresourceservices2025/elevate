// Seeds FAKE data for development: one sign-in account per role.
// Run: pnpm db:seed   (refuses to run against production or any unknown remote database)
//
// The 40-employee dataset (5 teams, 6 clients) is built by src/lib/seed/data.ts and is ready, but
// its tables (core.employees, teams, clients) arrive in Phase 1.1 and 1.2; the insert step is added then.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import postgres from "postgres";
import { buildSeedDataset } from "../src/lib/seed/data.ts";
import { assertSeedAllowed } from "../src/lib/seed/guard.ts";

config({ path: ".env.local" });
assertSeedAllowed(process.env);

const ROLES = ["super_admin", "hr_admin", "team_lead", "recruiter", "executive", "employee"] as const;
const CREDENTIALS_FILE = ".seed-credentials.local"; // git-ignored

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL!;
const sql = postgres(url, { prepare: false });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Reuse the same fake password on re-runs so the saved file stays correct.
function loadOrCreatePassword(): string {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    const m = fs.readFileSync(CREDENTIALS_FILE, "utf8").match(/^password: (\S+)$/m);
    if (m) return m[1];
  }
  return randomBytes(15).toString("base64url");
}

try {
  const password = loadOrCreatePassword();
  const lines = [`# Fake local accounts. Each asks you to set up an authenticator at first sign-in.`, `password: ${password}`];

  for (const role of ROLES) {
    const email = `seed.${role.replace("_", ".")}@example.com`;

    // The sign-up gate only admits invited emails, even for accounts created by an admin.
    await sql`
      insert into core.invitations (email, expires_at) values (${email}, now() + interval '7 days')
      on conflict ((lower(email))) do nothing`;

    let [existing] = await sql<{ id: string }[]>`select id from auth.users where lower(email) = ${email}`;
    if (!existing) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
      existing = { id: data.user.id };
    }

    await sql.begin(async (tx) => {
      await tx`insert into core.users (id, email) values (${existing.id}, ${email}) on conflict (id) do nothing`;
      await tx`insert into core.user_roles (user_id, role_slug) values (${existing.id}, 'employee') on conflict do nothing`;
      if (role !== "employee") {
        await tx`insert into core.user_roles (user_id, role_slug) values (${existing.id}, ${role}) on conflict do nothing`;
      }
      await tx`update core.invitations set accepted_at = now() where lower(email) = ${email} and accepted_at is null`;
    });

    lines.push(`${role}: ${email}`);
    console.log(`ready: ${role.padEnd(12)} ${email}`);
  }

  fs.writeFileSync(CREDENTIALS_FILE, lines.join("\n") + "\n");
  const data = buildSeedDataset();
  console.log(`\nAccounts and password saved to apps/elevate/${CREDENTIALS_FILE} (not committed).`);
  console.log(
    `Employee dataset ready: ${data.employees.length} people, ${data.teams.length} teams, ${data.clients.length} clients. ` +
      `It is inserted once the People tables exist (Phase 1.1).`,
  );
} finally {
  await sql.end();
}
