// Pulls what the TalentHR CSV export lacks, through TalentHR's API (read only on TalentHR's side):
//   - each person's documents, saved as real documents of the person (matched by work email)
//   - each person's time-off budgets and history, kept as an ENCRYPTED archive (not loaded into the leave ledger)
//   - all jobs and applicants, kept as one encrypted archive; ACTIVE applicants are also loaded into recruiting (jobs come in closed, no emails)
//
//   pnpm talenthr:pull -- --probe                          checks the API key (one read-only call) and says which way it works
//   pnpm talenthr:pull -- --shape                          prints the field names of TalentHR's people list (names and counts only, no values)
//   pnpm talenthr:pull -- --as hr@example.com --dry-run    counts what would be pulled, writes nothing
//   pnpm talenthr:pull -- --as hr@example.com              does it (safe to run again: what was imported is skipped)
//   add --only a@x.com,b@x.com to try a few people first (applicants are skipped then); add --no-applicants to leave recruiting alone
//
// REAL DATA: this refuses to run unless ELEVATE_ENV=production, so a laptop or test database never receives real people's files.
// The key is read from the git-ignored file apps/elevate/.env.talenthr.local (TALENTHR_API_KEY) and is never printed.
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { userRoles, users } from "@/modules/core/schema";
import { runPull } from "@/modules/imports/pull";
import { createTalentHrClient, probeTalentHr } from "@/modules/imports/talenthr-client";

config({ path: ".env.local" });
config({ path: ".env.talenthr.local" });

const args = process.argv.slice(2).filter((a) => a !== "--");
const flag = (n: string) => args.includes(n);
// The word after a flag, or undefined when the flag is not there (indexOf gives -1 then, and -1 + 1 would read the first word).
const value = (n: string) => {
  const i = args.indexOf(n);
  return i === -1 ? undefined : args[i + 1];
};

const apiKey = process.env.TALENTHR_API_KEY?.trim();
if (!apiKey) {
  console.error("Put TALENTHR_API_KEY=... in apps/elevate/.env.talenthr.local (a git-ignored file) and run again.");
  process.exit(1);
}

if (flag("--probe")) {
  const scheme = await probeTalentHr(apiKey);
  if (!scheme) {
    console.error("TalentHR refused the key both ways (as the user name and as the password). Check the key in TalentHR (Settings, API).");
    process.exit(1);
  }
  console.log(`The key works (${scheme === "key-as-user" ? "sent as the user name" : "sent as the password"}).`);
  process.exit(0);
}

if (flag("--shape")) {
  // Which fields does TalentHR's people list carry? Prints field NAMES and how many people have a value, never a value.
  const scheme = (await probeTalentHr(apiKey)) ?? "key-as-user";
  const rows = (await createTalentHrClient({ apiKey, scheme }).directory()) as unknown as Record<string, unknown>[];
  const names = new Map<string, number>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined && String(v).trim() !== "") names.set(k, (names.get(k) ?? 0) + 1);
  console.log(`People in the list: ${rows.length}. Fields and how many people have a value:`);
  for (const [k, n] of [...names.entries()].sort()) console.log(`  ${k}: ${n}`);
  process.exit(0);
}

if (process.env.ELEVATE_ENV !== "production") {
  console.error("Refusing to run: ELEVATE_ENV is not production. Real people's files must only go into the production system.");
  process.exit(1);
}

const email = value("--as")?.toLowerCase();
if (!email) {
  console.error("Say who is running it: --as hr@yourcompany.com (an HR or Super Admin account).");
  process.exit(1);
}
const [actor] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(sql`lower(${users.email})`, email));
const roles = actor ? await db.select({ role: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, actor.id)) : [];
if (!actor || !roles.some((r) => r.role === "hr_admin" || r.role === "super_admin")) {
  console.error("That account was not found, or is not an HR Admin or Super Admin.");
  process.exit(1);
}

const scheme = (await probeTalentHr(apiKey)) ?? "key-as-user";
const api = createTalentHrClient({ apiKey, scheme });
const only = value("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const dryRun = flag("--dry-run");
const applicants = !flag("--no-applicants");

console.log(dryRun ? "Dry run: nothing will be written." : "Pulling from TalentHR...");
const { pullId, summary } = await runPull({ id: actor.id, email: actor.email }, api, { dryRun, onlyEmails: only, applicants });
console.log(`Pull ${pullId.slice(0, 8)} finished.`);
console.log(`People in TalentHR: ${summary.people}. Matched in ELEVATE: ${summary.matched}. Not in ELEVATE yet: ${summary.unmatched}.`);
console.log(`Documents found: ${summary.documentsFound}. ${dryRun ? "Would import" : "Imported"}: ${summary.documentsImported}. Already there: ${summary.documentsDuplicate}. Skipped (too big or not allowed): ${summary.documentsSkipped}. Failed: ${summary.documentsFailed}.`);
console.log(`Leave histories archived: ${summary.leaveArchived}. Applicants archived: ${summary.applicantsArchived}.`);
if (applicants && !only) console.log(`Active applicants ${dryRun ? "that would be loaded" : "loaded into recruiting"}: ${summary.applicantsImported} in ${summary.openingsCreated} jobs (closed, no emails sent). Resumes saved: ${summary.resumesImported}. Already there or skipped: ${summary.applicantsSkipped}.`);
if (summary.unmatched > 0) console.log("People not in ELEVATE are not pulled. Import the people CSV first, then run this again.");
process.exit(0);
