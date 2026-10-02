import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { limiterKey } from "./codes";

// Rate limits for the public endpoints (CLAUDE.md: Safe Voice endpoints are rate limited). The app never stores or logs an address.
// The limiter needs *some* key, so it gets a keyed hash of the address that changes every UTC day (limiterKey) and lives only inside
// Upstash for the length of the window; the real address is never written anywhere. Without Upstash configured, requests are allowed
// in development and refused in production (fail closed).

type Policy = { requests: number; window: `${number} ${"s" | "m" | "h"}` };

export const POLICIES = {
  /** Sending a report, per address: a handful an hour is plenty for a person. */
  submit: { requests: 5, window: "1 h" },
  /** Opening or replying to a case, per address. */
  open: { requests: 20, window: "10 m" },
  /** Tries against one case code, from anywhere (a wrong or unknown code counts the same). */
  perCode: { requests: 10, window: "15 m" },
} satisfies Record<string, Policy>;

export type PolicyName = keyof typeof POLICIES;

let redis: Redis | null | undefined;
const limiters = new Map<string, Ratelimit>();

function getRedis() {
  if (redis === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    redis = url && token ? new Redis({ url, token }) : null;
  }
  return redis;
}

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** The address as the host forwards it: used to make a limiter key in memory, never stored or logged. */
export function addressOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function allow(policy: PolicyName, scope: string, value: string, pepper: string, production = process.env.NODE_ENV === "production"): Promise<boolean> {
  const client = getRedis();
  if (!client) return !production;
  let limiter = limiters.get(policy);
  if (!limiter) {
    // eslint-disable-next-line security/detect-object-injection -- `policy` is a typed key of POLICIES
    const p = POLICIES[policy];
    limiter = new Ratelimit({ redis: client, limiter: Ratelimit.slidingWindow(p.requests, p.window), prefix: `safevoice:${policy}` });
    limiters.set(policy, limiter);
  }
  try {
    const { success } = await limiter.limit(limiterKey(scope, value, pepper, utcDay()));
    return success;
  } catch {
    console.error("rate limiter unavailable"); // no key, address or request data
    return !production;
  }
}
