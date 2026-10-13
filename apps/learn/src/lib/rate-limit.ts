import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate limits for the public endpoint (the handoff). Without Upstash configured, requests are allowed in development and refused
// in production (fail closed).

type Policy = { requests: number; window: `${number} ${"s" | "m" | "h"}` };

export const POLICIES = {
  /** Handoff attempts per address: a person opens training a few times, never dozens. */
  handoff: { requests: 20, window: "10 m" },
  /** The player and exam calls, per person: a heartbeat every 30 seconds plus clicks stays far below this. */
  api: { requests: 600, window: "10 m" },
  /** The public certificate check, per address. */
  verify: { requests: 30, window: "10 m" },
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

/** The address as the host forwards it. Used only as a limiter key; never stored or logged by this app. */
export function addressOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function allow(policy: PolicyName, key: string, production = process.env.NODE_ENV === "production"): Promise<boolean> {
  const client = getRedis();
  if (!client) return !production;
  let limiter = limiters.get(policy);
  if (!limiter) {
    // eslint-disable-next-line security/detect-object-injection -- `policy` is a typed key of POLICIES
    const p = POLICIES[policy];
    limiter = new Ratelimit({ redis: client, limiter: Ratelimit.slidingWindow(p.requests, p.window), prefix: `learn:${policy}` });
    limiters.set(policy, limiter);
  }
  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch {
    console.error("rate limiter unavailable");
    return !production;
  }
}
