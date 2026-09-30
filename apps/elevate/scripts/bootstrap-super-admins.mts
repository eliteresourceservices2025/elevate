// Invites every email in SUPER_ADMIN_EMAILS so the first Super Admins can sign up.
// Run once per environment: pnpm --filter elevate exec tsx scripts/bootstrap-super-admins.mts
// The Super Admin role itself is assigned in Phase 0.3.
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const emails = (process.env.SUPER_ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (!url) throw new Error("Set DATABASE_URL_DIRECT (or DATABASE_URL) in .env.local");
if (emails.length === 0) throw new Error("SUPER_ADMIN_EMAILS is empty");

const sql = postgres(url, { prepare: false });

try {
  for (const email of emails) {
    const rows = await sql`
      insert into core.invitations (email, expires_at)
      values (${email}, now() + interval '7 days')
      on conflict ((lower(email))) do update
        set expires_at = excluded.expires_at
        where core.invitations.accepted_at is null
      returning email`;
    console.log(rows.length ? `invited ${email}` : `skipped ${email} (already accepted)`);
  }
} finally {
  await sql.end();
}
