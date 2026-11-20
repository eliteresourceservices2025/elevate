import { createHash, randomBytes, randomInt } from "node:crypto";

// Pure helpers for the tracker's secrets. Only hashes are ever stored; the token and the code are shown once.

/** No 0/1/O/I: a code typed from a screen cannot be misread. */
export const ENROLLMENT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ENROLLMENT_CODE_LENGTH = 8;
export const ENROLLMENT_TTL_MS = 15 * 60_000;

export const hashSecret = (value: string): string => createHash("sha256").update(value).digest("hex");

export function newEnrollmentCode(): string {
  let code = "";
  for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i++) code += ENROLLMENT_ALPHABET[randomInt(ENROLLMENT_ALPHABET.length)];
  return code;
}

/** What a person typed, as the code it means: upper case, no spaces or dashes. */
export const normalizeCode = (input: string): string => input.replace(/[\s-]/g, "").toUpperCase();

export function newDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSecret(token) };
}

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (\S+)$/.exec(header.trim());
  return match ? match[1] : null;
}
