import type { BulkAction } from "@/lib/bulk";

// Small pure helpers of the invoices list: which invoices to show, a safe search pattern, the initials beside a client name, and what can be
// done to an invoice from the list (the same rules the server applies again before it changes anything).

export type InvoiceShow = "all" | "live" | "void" | "replaced" | "test" | "archived";

const SHOWS: readonly InvoiceShow[] = ["all", "live", "void", "replaced", "test", "archived"];

/** The view in the address; anything unknown means live. */
export function parseShow(raw: unknown): InvoiceShow {
  return SHOWS.includes(raw as InvoiceShow) ? (raw as InvoiceShow) : "live";
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


export type InvoiceFacts = { isTest: boolean; state: "active" | "archived" | "voided" | "superseded" };

/**
 * What can be done to one invoice from the list. A void or replaced invoice can be deleted; an archived test invoice can be restored or
 * deleted; a live test invoice can be archived; a live real invoice has no list action (it is voided one by one, on its own page, with a reason).
 */
export function invoiceActions(f: InvoiceFacts): { actions: BulkAction[]; whyNot: string | null } {
  if (f.state === "voided" || f.state === "superseded") return { actions: ["delete"], whyNot: null };
  if (f.state === "archived") return { actions: ["restore", "delete"], whyNot: null };
  if (f.isTest) return { actions: ["archive"], whyNot: null };
  return { actions: [], whyNot: "A live invoice can't be deleted. Void it on its own page first." };
}

/** Why each action does NOT fit this invoice (an action that fits has no entry). Shown in the confirmation for the ticked rows it skips. */
export function invoiceWhy(f: InvoiceFacts): Partial<Record<BulkAction, string>> {
  const { actions } = invoiceActions(f);
  const out: Partial<Record<BulkAction, string>> = {};
  if (!actions.includes("delete")) out.delete = f.state === "active" ? (f.isTest ? "A live test invoice can't be deleted yet. Archive it first." : "A live invoice can't be deleted. Void it on its own page first.") : "This invoice can't be deleted.";
  if (!actions.includes("archive")) out.archive = f.state === "active" ? "A real invoice is voided, with a reason, on its own page." : f.state === "archived" ? "It is already archived." : "It is already void or replaced.";
  if (!actions.includes("restore")) out.restore = "It is not archived.";
  return out;
}
