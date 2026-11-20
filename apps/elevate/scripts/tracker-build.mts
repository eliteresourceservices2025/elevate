// Registers a build of the ELEVATE Tracker App on a DRAFT release: checks the file, uploads it to the private bucket tracker-builds
// and records its size and SHA-256. CI runs this after it has built and signed the app; HR then writes the notes and publishes.
//
//   pnpm tracker:build --version 1.2.0 --platform windows-x86_64 --kind installer --file path/to/ELEVATE-Tracker_1.2.0_x64-setup.exe
//   pnpm tracker:build --version 1.2.0 --platform windows-x86_64 --kind update --file path/to/app.exe --sig path/to/app.exe.sig
//
// Platforms: windows-x86_64, darwin-aarch64, darwin-x86_64. Kinds: installer (what people download), update (what the updater downloads).
// The release must already exist as a draft (Settings > ELEVATE Tracker > Releases > New release). Never prints keys.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { BUCKETS } from "@/modules/documents/storage";
import { buildStoragePath, checkBuildFile, parseBuildArgs } from "@/modules/activity/build-file";
import { registerBuild } from "@/modules/activity/releases-service";

config({ path: ".env.local" });

const USAGE = `Usage: pnpm tracker:build --version 1.2.0 --platform <windows-x86_64|darwin-aarch64|darwin-x86_64> --kind <installer|update> --file <path> [--sig <path>]`;
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const parsed = parseBuildArgs(process.argv.slice(2));
if (!parsed.ok) fail(`${parsed.error}\n${USAGE}`);
const args = parsed.ok ? parsed.args : fail(USAGE);

// A remote database is only touched when the environment says so on purpose.
const dbHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();
const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbHost);
if (!local && !["staging", "production"].includes(process.env.ELEVATE_ENV ?? "")) fail("Refusing to run against a remote database unless ELEVATE_ENV is staging or production.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");

let bytes: Uint8Array;
let size: number;
try {
  bytes = new Uint8Array(readFileSync(args.file));
  size = statSync(args.file).size;
} catch {
  fail(`Cannot read the file "${args.file}".`);
  process.exit(1);
}
const fileName = basename(args.file);
const check = checkBuildFile({ fileName, platform: args.platform, kind: args.kind, sizeBytes: size, head: bytes.subarray(0, 16) });
if (!check.ok) fail(check.error);
let signature: string | null = null;
try {
  signature = args.sig ? readFileSync(args.sig, "utf8").trim() : null;
} catch {
  fail(`Cannot read the signature file "${args.sig}".`);
}
if (args.kind === "update" && !signature) fail("The signature file is empty.");

const sha256 = createHash("sha256").update(bytes).digest("hex");
const path = buildStoragePath(args.version, args.platform, args.kind, fileName);
const admin = createClient(url as string, key as string, { auth: { autoRefreshToken: false, persistSession: false } });

const uploaded = await admin.storage.from(BUCKETS.trackerBuilds).upload(path, bytes, { contentType: "application/octet-stream", upsert: false });
if (uploaded.error) fail(`Could not upload the file: ${uploaded.error.message}. Has pnpm storage:setup been run?`);

const registered = await registerBuild({ version: args.version, platform: args.platform, kind: args.kind, storagePath: path, fileName, sizeBytes: size, sha256, signature });
if (!registered.ok) {
  await admin.storage.from(BUCKETS.trackerBuilds).remove([path]);
  fail(registered.error);
}
console.log(`Registered ${args.kind} for ${args.platform} on release ${args.version}: ${(size / (1024 * 1024)).toFixed(1)} MB, SHA-256 ${sha256}`);
process.exit(0);
