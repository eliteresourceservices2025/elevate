import "server-only";
import { buildTurnUsageQuery, sumTurnBytes, type TurnUsage } from "./usage";

// The real month-to-date TURN traffic, read from Cloudflare's GraphQL Analytics API (the only place Cloudflare publishes TURN usage). Needs an
// API token with the "Account Analytics" permission and the account id. Read-only, one request, never logged. Any failure returns a short
// reason and the Settings page falls back to our own estimate. Cloudflare documents no usage figure for the SFU part, so this is TURN only.

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const TIMEOUT_MS = 8_000;

export type CloudflareUsage = { state: "off" } | { state: "error"; reason: string } | ({ state: "ok" } & TurnUsage);

/** TURN bytes sent and received so far this month (UTC), for our own TURN key. */
export async function fetchTurnUsage(now = new Date()): Promise<CloudflareUsage> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
  if (!account || !/^[0-9a-f]{32}$/i.test(account) || !token) return { state: "off" };
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const query = buildTurnUsageQuery(now, keyId && /^[A-Za-z0-9_-]{8,64}$/.test(keyId) ? keyId : undefined);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: query.text, variables: { accountId: account, ...query.variables } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) return { state: "error", reason: response.status === 401 || response.status === 403 ? "Cloudflare refused the token (it needs the Account Analytics permission)." : `Cloudflare answered ${response.status}.` };
    const json = (await response.json()) as { data?: unknown; errors?: unknown[] };
    if (Array.isArray(json.errors) && json.errors.length > 0) return { state: "error", reason: "Cloudflare could not answer the usage question." };
    // An account id the token cannot see comes back as an empty list, not an error: say so plainly.
    const accounts = (json.data as { viewer?: { accounts?: unknown[] } } | null | undefined)?.viewer?.accounts;
    if (Array.isArray(accounts) && accounts.length === 0) return { state: "error", reason: "Cloudflare found no account with that id for this token." };
    const usage = sumTurnBytes(json.data);
    if (!usage) return { state: "error", reason: "Cloudflare's answer was not in the shape we expected." };
    return { state: "ok", ...usage };
  } catch {
    return { state: "error", reason: "Cloudflare did not answer in time." };
  }
}
