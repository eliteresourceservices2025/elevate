// Loads the HIPAA course (apps/learn/src/content) into the learn schema.
//   pnpm learn:publish                                         saves the HIPAA course as a DRAFT version (safe to repeat)
//   pnpm learn:publish --course cybersecurity                  the same for another course (hipaa or cybersecurity)
//   pnpm learn:publish --publish --reviewer you@ers.example --counsel-date 2026-11-01
//                                                              makes it live; needs who reviewed it and when counsel approved
//   pnpm learn:publish --publish --new-version --reviewer ... --counsel-date ...
//                                                              the SAME content as a NEW version (the way to correct a wrong counsel
//                                                              date: a published version is frozen; people on the old one finish it)
// Publishing freezes the version. Run it against production only after counsel's review (docs/learn/06-testing-and-review.md).
import { config } from "dotenv";
import postgres from "postgres";
import { loadCourse } from "../src/modules/learn/publish";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL_DIRECT (or DATABASE_URL) in .env.local");

const sql = postgres(url, { prepare: false, onnotice: () => {} });
try {
  let reviewerUserId: string | undefined;
  if (flag("publish")) {
    const email = value("reviewer");
    if (!email) throw new Error("Publishing needs --reviewer <email of who read the content>");
    const [u] = await sql`select id from core.users where lower(email) = ${email.toLowerCase()}`;
    if (!u) throw new Error(`No ELEVATE account for ${email}`);
    reviewerUserId = u.id as string;
  }
  // Was this course ever live before? (Only a first publication starts paused: re-publishing never changes who is assigned.)
  const [seen] = await sql`
    select count(*)::int as n from learn.course_versions v join learn.courses c on c.id = v.course_id
    where c.slug = ${value("course") ?? "hipaa"} and v.status in ('published', 'retired')`;
  const wasLive = (seen?.n as number) > 0;
  const result = await loadCourse(sql, {
    publish: flag("publish"),
    reviewerUserId,
    counselApprovedOn: value("counsel-date"),
    actorUserId: reviewerUserId,
    material: flag("material"),
    newVersion: flag("new-version"),
    courseSlug: value("course"),
  });
  if (result.status === "published" && !wasLive) {
    // A course published for the first time starts PAUSED: the nightly job assigns nobody until HR chooses a pilot or everyone
    // (Training status > Automatic assignment). A course that already has a rule keeps it.
    const made = await sql`
      insert into learn.assignment_rules (course_id, mode, updated_by) values (${result.courseId}, 'paused', ${reviewerUserId ?? null})
      on conflict (course_id) do nothing returning course_id`;
    if (made.length) console.log("Automatic assignment starts PAUSED for this course. Choose who gets it on Training status when you are ready.");
  }
  console.log(`${result.status === "published" ? "Published" : "Saved as a draft"}: version ${result.version} (${result.modules} modules, ${result.questions} questions)${result.created ? "" : ", no change"}.`);
} finally {
  await sql.end();
}
