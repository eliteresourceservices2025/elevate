// Tries the Jibble link end to end on ONE test person, so you can see whether an API clock-in really starts the screenshots
// in Jibble's desktop app (the open question behind "mirror mode" versus "fallback mode").
//
//   pnpm jibble:probe                                  checks the token and counts the people (read only)
//   pnpm jibble:probe test.person@example.com          also finds that person by email (read only)
//   pnpm jibble:probe test.person@example.com --clock  also clocks them in, waits for you, then out
//   add --native-break to try Jibble's own break entries instead of clocking out and in for a break
//
// Use a TEST person that is not a real VA: --clock creates real time entries in Jibble for that person.
// Reads JIBBLE_ACCESS_TOKEN (or JIBBLE_CLIENT_ID and JIBBLE_CLIENT_SECRET) from the git-ignored file
// apps/elevate/.env.jibble.local. Never prints the token.
import { createInterface } from "node:readline/promises";
import { config } from "dotenv";
import { JibbleError, JibbleHttpClient, configFromEnv, type JibbleClient } from "@/modules/jibble/http-client";
import type { JibbleAction } from "@/modules/jibble/mirror-rules";

config({ path: ".env.jibble.local" });

const args = process.argv.slice(2);
const email = args.find((a) => a.includes("@"))?.trim().toLowerCase();
const doClock = args.includes("--clock");
const nativeBreak = args.includes("--native-break");

const cfg = configFromEnv(process.env);
if (!cfg) {
  console.error("No Jibble credentials found. Put JIBBLE_ACCESS_TOKEN=<your personal access token> in apps/elevate/.env.jibble.local (never in chat or in git).");
  process.exit(1);
}
console.log(`Using a ${cfg.accessToken ? "personal access token" : "client id and secret"}. Hosts: ${new URL(cfg.workspaceUrl).host}, ${new URL(cfg.timeTrackingUrl).host}, ${new URL(cfg.timeAttendanceUrl).host}`);

const client: JibbleClient = new JibbleHttpClient(cfg);
const show = (error: unknown) => (error instanceof JibbleError ? error.message : "unexpected error");

let people;
try {
  people = await client.listPeople();
} catch (error) {
  console.error(`Could not read the people list: ${show(error)}`);
  console.error("401 means the token was rejected or has expired. 403 means it is not allowed to read people.");
  process.exit(1);
}
const withEmail = people.filter((p) => p.email).length;
console.log(`OK: the token works. Jibble has ${people.length} people (${withEmail} with an email address).`);

if (!email) {
  console.log("Add a test person's email to look them up: pnpm jibble:probe test.person@example.com");
  process.exit(0);
}

const found = people.find((p) => p.email?.toLowerCase() === email);
if (!found) {
  console.error(`No Jibble person has the email ${email}. Check the spelling, or that the test person was added to Jibble with that email.`);
  process.exit(1);
}
console.log(`Found ${found.fullName} (status ${found.status ?? "unknown"}), id ${found.id}.`);

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
try {
  const days = await client.dailyTracked([found.id], yesterday, today);
  console.log(`Timesheet read OK: ${days.length} day(s) with tracked time ${days.map((d) => `${d.date} ${Math.round(d.trackedMinutes)} min`).join(", ") || "(none)"}.`);
} catch (error) {
  console.error(`Timesheet read failed: ${show(error)} (the nightly comparison needs this).`);
}

if (!doClock) {
  console.log("Read-only checks done. Add --clock to test clocking this person in and out.");
  process.exit(0);
}

const ask = createInterface({ input: process.stdin, output: process.stdout });
const pause = async (question: string) => {
  const answer = await ask.question(`${question} (press Enter to go on, or type q to stop) `);
  return answer.trim().toLowerCase() !== "q";
};
const send = async (action: JibbleAction) => {
  try {
    const { entryId } = await client.clock(found.id, action);
    console.log(`  ${action}: sent${entryId ? ` (entry ${entryId})` : ""}.`);
    return true;
  } catch (error) {
    console.error(`  ${action}: FAILED, ${show(error)}`);
    return false;
  }
};

console.log(`\nThis will clock ${found.fullName} in and out in Jibble. Open the Jibble desktop app signed in as this person first.`);
if (!(await pause("Ready?"))) process.exit(0);

if (await send("In")) {
  const running = await pause("1/3 Check the desktop app: does it show the person as clocked in and start capturing screenshots? Note it down.");
  if (running) {
    if (await send(nativeBreak ? "StartBreak" : "Out")) {
      const paused = await pause(`2/3 Check the desktop app: did screenshots stop for the break${nativeBreak ? "" : " (we clocked out)"}?`);
      if (paused && (await send(nativeBreak ? "EndBreak" : "In"))) await pause("Check the desktop app: did screenshots start again?");
    }
  }
  console.log("Finishing: clocking the test person out.");
  await send("Out");
}
ask.close();
console.log("\nDone. Tell Claude what you saw in the desktop app at each step (started, stopped for the break, started again, stopped).");
