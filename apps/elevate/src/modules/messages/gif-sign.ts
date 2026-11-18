import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

// Every GIF address our search returns is signed here. Sending a GIF and previewing one both require the signature, so only GIFs that came out of
// our own search can be fetched or posted: a person cannot hand the server some other address on the GIF service's hosts. The key is derived
// from the newest field-encryption key (nothing new to keep); it never leaves the server.

let cachedKey: Buffer | undefined;

function signKey(): Buffer {
  if (cachedKey) return cachedKey;
  const first = (process.env.FIELD_ENCRYPTION_KEYS ?? "").split(",")[0]?.trim() ?? "";
  const material = Buffer.from(first.slice(first.indexOf(":") + 1), "base64");
  if (material.length < 16) throw new Error("FIELD_ENCRYPTION_KEYS is not set");
  cachedKey = Buffer.from(hkdfSync("sha256", material, "elevate-chat-gif-salt", "elevate chat gif v1", 32));
  return cachedKey;
}

export function signGifUrl(url: string): string {
  return createHmac("sha256", signKey()).update(`gif:${url}`).digest("base64url").slice(0, 32);
}

export function verifyGifSignature(url: string, signature: unknown): boolean {
  if (typeof signature !== "string" || signature.length !== 32) return false;
  const expected = Buffer.from(signGifUrl(url));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
