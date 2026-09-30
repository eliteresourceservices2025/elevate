// Local development helper for the fake sign-in accounts (never for real people).
//
//   pnpm dev:mfa code <secret>      prints the current 6-digit code for the secret shown on the MFA setup screen
//   pnpm dev:mfa reset <email>      removes that account's authenticator so it can enroll again
//   pnpm dev:mfa reset --seed       the same for every seed.<role>@example.com account
//
// "reset" refuses to run against anything but the local Supabase (or ELEVATE_ENV=staging), like the seed script.
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { assertSeedAllowed } from "@/lib/seed/guard";

config({ path: ".env.local" });

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of input.replace(/[\s=]+/g, "").toUpperCase()) {
    const i = alphabet.indexOf(c);
    if (i < 0) throw new Error("That does not look like an authenticator secret (letters A-Z and digits 2-7 only).");
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 time-based one-time password (SHA-1, 6 digits, 30 second step). */
function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

const [command, arg] = process.argv.slice(2);

if (command === "code" && arg) {
  const secondsLeft = 30 - (Math.floor(Date.now() / 1000) % 30);
  console.log(`${totp(arg)}   (valid for about ${secondsLeft} more seconds; run again for a fresh one)`);
} else if (command === "reset" && arg) {
  assertSeedAllowed(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  const wanted = arg === "--seed" ? (u: { email?: string }) => /^seed\..+@example\.com$/i.test(u.email ?? "") : (u: { email?: string }) => (u.email ?? "").toLowerCase() === arg.toLowerCase();
  const users = data.users.filter(wanted);
  if (users.length === 0) console.log("No matching account found.");
  for (const user of users) {
    const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: user.id });
    let removed = 0;
    for (const factor of factors?.factors ?? []) {
      const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id });
      if (deleteError) throw new Error(`${user.email}: ${deleteError.message}`);
      removed += 1;
    }
    console.log(`${user.email}: ${removed} authenticator(s) removed${removed ? ". Sign in again to set it up fresh." : " (none was set up)."}`);
  }
} else {
  console.log("Usage:\n  pnpm dev:mfa code <secret>\n  pnpm dev:mfa reset <email>\n  pnpm dev:mfa reset --seed");
  process.exitCode = 1;
}
