import "server-only";
import { createHmac, hkdfSync } from "node:crypto";
import { eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import { splitMentions } from "./mentions";
import { searchTokens } from "./schema";
import { indexTokens, queryTokens, tokenize } from "./search-tokens";

type Tx = Pick<typeof db, "insert" | "delete">;

let cachedKey: Buffer | undefined;

/** The search key: derived (HKDF) from the newest field-encryption key, so there is no new secret to keep. It never leaves the server. */
function searchKey(): Buffer {
  if (cachedKey) return cachedKey;
  const first = (process.env.FIELD_ENCRYPTION_KEYS ?? "").split(",")[0]?.trim() ?? "";
  const material = Buffer.from(first.slice(first.indexOf(":") + 1), "base64");
  if (material.length < 16) throw new Error("FIELD_ENCRYPTION_KEYS is not set");
  cachedKey = Buffer.from(hkdfSync("sha256", material, "elevate-chat-search-salt", "elevate chat search v1", 32));
  return cachedKey;
}

/** The keyed hash stored for a word (or word start). Short on purpose: it only has to tell words apart, and it reveals nothing without the key. */
export function hashToken(token: string): string {
  return createHmac("sha256", searchKey()).update(token).digest().subarray(0, 16).toString("base64url");
}

/** A message as plain text for indexing: a mention counts as the name that was typed, never the id. */
function plainText(body: string): string {
  return splitMentions(body)
    .map((p) => ("mention" in p ? p.mention.name : p.text))
    .join("");
}

/** (Re)builds a message's index rows. Call inside the transaction that saves or edits the message. */
export async function indexMessage(tx: Tx, messageId: string, conversationId: string, body: string): Promise<void> {
  await tx.delete(searchTokens).where(eq(searchTokens.messageId, messageId));
  const tokens = indexTokens(tokenize(plainText(body))).map(hashToken);
  if (tokens.length === 0) return;
  await tx.insert(searchTokens).values(tokens.map((token) => ({ messageId, conversationId, token }))).onConflictDoNothing();
}

/** Removes a message from search (when it is removed). */
export async function clearSearchIndex(tx: Pick<typeof db, "delete">, messageId: string): Promise<void> {
  await tx.delete(searchTokens).where(eq(searchTokens.messageId, messageId));
}

/** The hashes a search for this text looks for (every one must match). Empty when the text has no searchable word. */
export function searchHashes(query: string): string[] {
  return queryTokens(query).map(hashToken);
}
