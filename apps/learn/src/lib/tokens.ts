import { createHash, randomBytes } from "node:crypto";

// Handoff tokens and session cookie values are random; only their SHA-256 is ever stored or looked up.
// The format check rejects anything that cannot be one of ours before it reaches the database.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const isWellFormedToken = (value: unknown): value is string => typeof value === "string" && TOKEN_PATTERN.test(value);

export const hashValue = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();

/** A new random session cookie value (256 bits, URL-safe). */
export const newSessionValue = (): string => randomBytes(32).toString("base64url");
