// Gives a person the published HIPAA course (until the HR Training page and the nightly assignment job exist).
//   pnpm learn:assign --email person@ers.example --track full
//   Tracks: full (healthcare-client VAs and anyone handling client data), essentials (internal staff), refresher.
import { config } from "dotenv";
import postgres from "postgres";
import { assignCourse } from "../src/modules/learn/publish";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = value("email");
const track = value("track") ?? "full";
if (!email) throw new Error("Use --email <work email of the person's ELEVATE account>");
if (!["full", "essentials", "refresher"].includes(track)) throw new Error("--track must be full, essentials or refresher");

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_DIRECT (or DATABASE_URL) in .env.local");

const sql = postgres(url, { prepare: false, onnotice: () => {} });
try {
  const [u] = await sql`select id from core.users where lower(email) = ${email.toLowerCase()} and archived_at is null`;
  if (!u) throw new Error(`No active ELEVATE account for ${email}`);
  const r = await assignCourse(sql, { userId: u.id as string, track: track as "full" | "essentials" | "refresher", reason: "manual" });
  console.log(r.created ? `Assigned (${track}), due ${r.dueOn}.` : `Already assigned, due ${r.dueOn}.`);
} finally {
  await sql.end();
}
