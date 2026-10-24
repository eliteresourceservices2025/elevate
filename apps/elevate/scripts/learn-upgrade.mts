// Moves people who are partway through an OLDER version of a course to the latest published version (same due date, progress on the old one
// is not carried over). Always look first:
//   pnpm learn:upgrade --course hipaa                 DRY RUN: lists who would move and how many modules each had finished
//   pnpm learn:upgrade --course hipaa --apply         does it
// Run it for each course (hipaa, cybersecurity). It uses DATABASE_URL_DIRECT: set the production string in the PowerShell window first.
import { config } from "dotenv";
import postgres from "postgres";
import { upgradeOpenAssignments } from "../src/modules/learn/upgrade";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const course = args[args.indexOf("--course") + 1];
if (args.indexOf("--course") < 0 || !course || course.startsWith("--")) throw new Error("Use --course <hipaa|cybersecurity|customer-service>");
const apply = args.includes("--apply");

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_DIRECT (or DATABASE_URL) first");
console.log(`Database host: ${new URL(url).host}`);

const sql = postgres(url, { prepare: false, onnotice: () => {} });
try {
  const r = await upgradeOpenAssignments(sql, { courseSlug: course, dryRun: !apply });
  console.log(`${course}: latest published version is ${r.latestVersion}; ${r.rows.length} unfinished assignment(s) on an older version.`);
  for (const x of r.rows) console.log(`  version ${x.fromVersion} -> ${r.latestVersion}  ${x.email ?? x.userId}  ${x.track}  due ${x.dueOn}  modules finished: ${x.modulesDone}`);
  console.log(apply ? `Moved ${r.moved}.` : "Dry run: nobody was moved. Add --apply to move them.");
} finally {
  await sql.end();
}
