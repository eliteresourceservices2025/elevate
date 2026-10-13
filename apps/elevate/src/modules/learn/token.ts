import { createHash, randomBytes } from "node:crypto";

// The sign-in handoff token (docs/learn/02-architecture.md). 256 random bits, shown to the browser once and stored only as a SHA-256
// hash, so a database copy cannot be used to sign in. It works once, for 60 seconds. Learn applies the same hash on its side.

export const LAUNCH_TOKEN_SECONDS = 60;

export function newLaunchToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashLaunchToken(token) };
}

export const hashLaunchToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

/** Where Learn lives. Null when it is not set up (nothing to open). Development defaults to the local port. */
export function learnBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.NEXT_PUBLIC_LEARN_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? null : "http://localhost:3200";
}

/** The page on Learn that receives the form post. */
export const handoffUrl = (base: string): string => `${base}/auth/handoff`;
