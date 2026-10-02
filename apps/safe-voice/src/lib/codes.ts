import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

// Case codes and passphrases. Both are random (no words, no pattern, nothing derived from the person or the time). The database holds
// the case code only as HMAC-SHA256(pepper, code) and the passphrase only as HMAC(pepper, scrypt(passphrase, salt)): a dump of the
// database, without the pepper, can neither look a case up nor test passphrase guesses. Losing the pepper locks every reporter out
// of their case, so it is kept in the password manager and never changed (docs/SETUP.md).

/** No 0, 1, I, L, O: they are easy to misread when written down. 31 symbols. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 12; // 31^12 is about 2^59
const PASSPHRASE_LENGTH = 20; // 31^20 is about 2^99

const randomSymbols = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const groups = (s: string, size: number) => Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size)).join("-");

export const newCaseCode = () => `SV-${groups(randomSymbols(CODE_LENGTH), 4)}`;
export const newPassphrase = () => groups(randomSymbols(PASSPHRASE_LENGTH), 5);

/** Capitals and digits only, with a leading "SV" dropped, so "sv abcd-efgh-jkmn" and "ABCDEFGHJKMN" are the same code. */
export function normalizeCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.startsWith("SV") ? cleaned.slice(2) : cleaned;
}
export const normalizePassphrase = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** True when the text could be a code or passphrase at all. A wrong shape still goes through the same work as a right one. */
export const looksLikeCode = (normalized: string) => normalized.length === CODE_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));
export const looksLikePassphrase = (normalized: string) => normalized.length === PASSPHRASE_LENGTH && [...normalized].every((c) => ALPHABET.includes(c));

const key = (pepper: string) => Buffer.from(pepper, "utf8");

export function assertPepper(pepper: string | undefined): string {
  if (!pepper || pepper.length < 32) throw new Error("SAFEVOICE_PEPPER is missing or too short");
  return pepper;
}

/** How a case is found: a keyed hash of the normalised code. */
export const codeLookupHash = (normalizedCode: string, pepper: string): Buffer => createHmac("sha256", key(pepper)).update(`code:${normalizedCode}`).digest();

const scryptAsync = (secret: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 }, (err, out) => (err ? reject(err) : resolve(out))));

export const newSalt = () => randomBytes(16);

export async function hashPassphrase(normalizedPassphrase: string, salt: Buffer, pepper: string): Promise<Buffer> {
  const stretched = await scryptAsync(normalizedPassphrase, salt);
  return createHmac("sha256", key(pepper)).update("pass:").update(stretched).digest();
}

const DUMMY_SALT = Buffer.alloc(16, 0x5a);
const DUMMY_HASH = Buffer.alloc(32, 0xa5);

/**
 * Checks a passphrase against a stored salt and hash. With no stored row (an unknown case code) it still does the whole scrypt
 * against a dummy salt and compares in constant time, so "no such case" and "wrong passphrase" take the same work and answer the same.
 */
export async function verifyPassphrase(normalizedPassphrase: string, stored: { salt: Buffer; hash: Buffer } | null, pepper: string): Promise<boolean> {
  const salt = stored?.salt ?? DUMMY_SALT;
  const expected = stored?.hash ?? DUMMY_HASH;
  const actual = await hashPassphrase(normalizedPassphrase, salt, pepper);
  const equal = expected.length === actual.length && timingSafeEqual(expected, actual);
  return stored !== null && equal;
}

/** A per-day, per-address key for the rate limiter. It is a keyed hash and is never stored in the database; it exists only inside Upstash for the length of the limit window. */
export function limiterKey(scope: string, value: string, pepper: string, day: string): string {
  return createHmac("sha256", key(pepper)).update(`limit:${scope}:${day}:`).update(value).digest("hex").slice(0, 32);
}
