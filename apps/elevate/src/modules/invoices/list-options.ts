// Small pure helpers of the invoices list: which invoices to show, a safe search pattern, and the initials beside a client name.

export type InvoiceShow = "live" | "all" | "test";

export function parseShow(raw: unknown): InvoiceShow {
  return raw === "all" || raw === "test" ? raw : "live";
}

/** A search text made safe for ILIKE: trimmed, short, and the characters that mean something to LIKE written literally. */
export function likePattern(q: string): string {
  return `%${q.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Up to two letters from a client's name, for the round mark beside it. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
