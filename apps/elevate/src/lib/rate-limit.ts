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
} satisfies Record<string, Policy>;

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
  if (!client) return process.env.NODE_ENV !== "production";

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
  const { success } = await limiter.limit(key);
  return success;
}
