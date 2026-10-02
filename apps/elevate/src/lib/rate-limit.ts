import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

type Policy = { requests: number; window: `${number} ${"s" | "m" | "h"}` };

// Login, careers apply and Safe Voice endpoints (CLAUDE.md). Add policies as they are built.
export const POLICIES = {
  login: { requests: 8, window: "10 m" },
  signup: { requests: 5, window: "1 h" },
  passwordReset: { requests: 5, window: "1 h" },
  mfa: { requests: 10, window: "10 m" },
  reveal: { requests: 30, window: "10 m" },
  upload: { requests: 20, window: "10 m" },
  download: { requests: 60, window: "10 m" },
  clock: { requests: 30, window: "10 m" },
  presence: { requests: 60, window: "10 m" },
  /** Public applications, per address. */
  careers: { requests: 5, window: "1 h" },
  /** The public "verify a document" check, per address. */
  verify: { requests: 30, window: "10 m" },
  /** An outside signer asking for an emailed code (per link), checking a code (per link), and everything else on their pages (per address). */
  signCode: { requests: 5, window: "1 h" },
  signVerify: { requests: 20, window: "10 m" },
  signPublic: { requests: 120, window: "10 m" },
} satisfies Record<string, Policy>;

/**
 * Attendance must never depend on the rate limiter: if the limiter is not configured or cannot be reached, the clock and the
 * "still here" ping keep working (the clock has its own state checks and lock). Login, uploads and the rest still fail closed.
 */
const FAIL_OPEN: ReadonlySet<keyof typeof POLICIES> = new Set(["clock", "presence"]);

/** Whether a request may go ahead when the limiter is missing or down. */
export function allowWhenLimiterUnavailable(policy: keyof typeof POLICIES, production: boolean): boolean {
  return FAIL_OPEN.has(policy) || !production;
}

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

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Returns true if the request may proceed. Without Upstash configured it allows
 * requests in development and denies them in production (fail closed).
 */
export async function allowRequest(policy: keyof typeof POLICIES, key: string): Promise<boolean> {
  const client = getRedis();
  if (!client) return allowWhenLimiterUnavailable(policy, process.env.NODE_ENV === "production");

  let limiter = limiters.get(policy);
  if (!limiter) {
    // eslint-disable-next-line security/detect-object-injection -- `policy` is a typed key of POLICIES
    const p = POLICIES[policy];
    limiter = new Ratelimit({
      redis: client,
      limiter: Ratelimit.slidingWindow(p.requests, p.window),
      prefix: `elevate:${policy}`,
    });
    limiters.set(policy, limiter);
  }
  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch {
    console.error("rate limiter unavailable:", policy); // no key or request data
    return allowWhenLimiterUnavailable(policy, true);
  }
}
