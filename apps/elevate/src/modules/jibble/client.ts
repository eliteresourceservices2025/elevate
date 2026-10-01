import "server-only";
import { JibbleHttpClient, configFromEnv, type JibbleClient } from "./http-client";
import { parseBreakMode, type BreakMode } from "./mirror-rules";

// The configured Jibble client, or null when no token is set (then nothing is sent and the clock works as usual).
// Tests install a fake with setJibbleClient().

let override: JibbleClient | null | undefined;
let real: { key: string; client: JibbleClient } | null = null;

/** Tests only: install a fake client, or null for "not configured". Pass undefined to restore the default. */
export function setJibbleClient(client: JibbleClient | null | undefined) {
  override = client;
}

export function getJibbleClient(): JibbleClient | null {
  if (override !== undefined) return override;
  const config = configFromEnv(process.env);
  if (!config) return null;
  const key = JSON.stringify(config);
  if (!real || real.key !== key) real = { key, client: new JibbleHttpClient(config) };
  return real.client;
}

/** JIBBLE_MIRROR_ENABLED=false = fallback mode: ELEVATE sends nothing to Jibble, people clock into both apps, and the nightly comparison finds gaps. */
export const mirrorSendsEnabled = () => process.env.JIBBLE_MIRROR_ENABLED !== "false";
export const breakMode = (): BreakMode => parseBreakMode(process.env.JIBBLE_BREAK_MODE);
export const mismatchToleranceMinutes = () => {
  const n = Number(process.env.JIBBLE_MISMATCH_MINUTES);
  return Number.isFinite(n) && n >= 1 && n <= 240 ? n : 15;
};

/**
 * The safety lock: ELEVATE only sends to Jibble in production (ELEVATE_ENV=production). Anywhere else (a laptop, staging, tests) it
 * sends only for the Jibble person ids listed in JIBBLE_TEST_PERSON_IDS, so a copy of the app can never clock real people in or out
 * of the live Jibble organization.
 */
export function sendsAllowed(jibblePersonId: string | null): boolean {
  if (process.env.ELEVATE_ENV === "production") return true;
  const testIds = (process.env.JIBBLE_TEST_PERSON_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return jibblePersonId !== null && testIds.includes(jibblePersonId);
}
