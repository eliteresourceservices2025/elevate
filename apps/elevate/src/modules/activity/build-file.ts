import { PLATFORMS, parseVersion, type Platform } from "./releases-logic";

// Pure helpers for `pnpm tracker:build`: reading its flags, naming the stored file, and the sanity checks on the file itself.
// These are sanity checks, not a proof that a build is genuine: the real protection is code signing (checked by the operating
// system) and the updater signature (checked by the app against the public key inside it).

export type BuildArgs = { version: string; platform: Platform; kind: "installer" | "update"; file: string; sig: string | undefined };

const FLAGS = new Set(["version", "platform", "kind", "file", "sig"]);

export function parseBuildArgs(argv: readonly string[]): { ok: true; args: BuildArgs } | { ok: false; error: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]?.replace(/^--/, "") ?? "";
    if (!FLAGS.has(flag)) return { ok: false, error: `Unknown option "${argv[i]}".` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `Give a value for --${flag}.` };
    values.set(flag, value);
  }
  const version = values.get("version");
  const platform = values.get("platform");
  const kind = values.get("kind");
  const file = values.get("file");
  if (!version || !platform || !kind || !file) return { ok: false, error: "Give --version, --platform, --kind and --file." };
  if (!parseVersion(version)) return { ok: false, error: "--version must be like 1.2.0." };
  if (!(PLATFORMS as readonly string[]).includes(platform)) return { ok: false, error: `--platform must be one of ${PLATFORMS.join(", ")}.` };
  if (kind !== "installer" && kind !== "update") return { ok: false, error: "--kind must be installer or update." };
  const sig = values.get("sig");
  if (kind === "update" && !sig) return { ok: false, error: "An update build needs --sig (the .sig file made when the update file was signed)." };
  return { ok: true, args: { version, platform: platform as Platform, kind, file, sig } };
}

/** `releases/<version>/<platform>/<kind>/<file>` with a file name that has no folder part and only safe characters. */
export function buildStoragePath(version: string, platform: string, kind: string, fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const safe = base.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "").replace(/\.{2,}/g, ".").replace(/^\.+/, "") || "file";
  return `releases/${version}/${platform}/${kind}/${safe}`;
}

const MIN_BYTES = 100 * 1024;
const MAX_BYTES = 150 * 1024 * 1024;
const starts = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const isMz = (b: Uint8Array) => starts(b, [0x4d, 0x5a]);
const isOle = (b: Uint8Array) => starts(b, [0xd0, 0xcf, 0x11, 0xe0]);
const isGzip = (b: Uint8Array) => starts(b, [0x1f, 0x8b]);

export function checkBuildFile(input: { fileName: string; platform: Platform; kind: "installer" | "update"; sizeBytes: number; head: Uint8Array }): { ok: true } | { ok: false; error: string } {
  const name = input.fileName.toLowerCase();
  if (input.sizeBytes < MIN_BYTES) return { ok: false, error: "That file is too small to be an app." };
  if (input.sizeBytes > MAX_BYTES) return { ok: false, error: "That file is larger than 150 MB." };
  const windows = input.platform.startsWith("windows");
  if (windows) {
    if (name.endsWith(".exe")) return isMz(input.head) ? { ok: true } : { ok: false, error: "A .exe must be a Windows program (the first bytes do not match)." };
    if (name.endsWith(".msi")) return isOle(input.head) ? { ok: true } : { ok: false, error: "A .msi must be a Windows installer package (the first bytes do not match)." };
    return { ok: false, error: "A Windows build must be a .exe or a .msi." };
  }
  if (input.kind === "installer") return name.endsWith(".dmg") ? { ok: true } : { ok: false, error: "A Mac installer must be a .dmg." };
  if (name.endsWith(".gz") || name.endsWith(".tar.gz")) return isGzip(input.head) ? { ok: true } : { ok: false, error: "A Mac update file must be a real .tar.gz (the first bytes do not match)." };
  return { ok: false, error: "A Mac update file must be a .tar.gz." };
}
