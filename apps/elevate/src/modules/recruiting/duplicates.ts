// Finding applicants who are probably the same person under two records (a new email address, a second application). Pure: it only
// groups the rows it is given. A match is a SUGGESTION: HR looks at each pair and decides; nothing is merged automatically.
import { normalizeText } from "./keywords";

export type DupCandidate = { id: string; fullName: string; email: string; phone: string | null };
export type DupGroup = { ids: string[]; reasons: ("phone" | "name")[] };

/** The name without accents, case, punctuation or extra spaces. A single word ("Ana") is too common to match on. */
export function nameKey(fullName: string): string | null {
  const key = normalizeText(fullName).replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
  return key.includes(" ") && key.length >= 6 ? key : null;
}

/** The last 10 digits of a phone number (so "+63 917 123 4567" and "0917 123 4567" match), or null when it is too short to mean anything. */
export function phoneKey(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function groupDuplicates(rows: DupCandidate[]): DupGroup[] {
  const parent = new Map<string, string>(rows.map((r) => [r.id, r.id]));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  const reasonsOf = new Map<string, Set<"phone" | "name">>();
  const link = (kind: "phone" | "name", keyOf: (r: DupCandidate) => string | null) => {
    const firstWith = new Map<string, string>();
    for (const r of rows) {
      const key = keyOf(r);
      if (key === null) continue;
      const first = firstWith.get(key);
      if (first === undefined) firstWith.set(key, r.id);
      else {
        union(first, r.id);
        // remember the reason on both ends; the group's reasons are collected below
        for (const id of [first, r.id]) (reasonsOf.get(id) ?? reasonsOf.set(id, new Set()).get(id)!).add(kind);
      }
    }
  };
  link("phone", (r) => phoneKey(r.phone));
  link("name", (r) => nameKey(r.fullName));

  const groups = new Map<string, { ids: string[]; reasons: Set<"phone" | "name"> }>();
  for (const r of rows) {
    const root = find(r.id);
    const g = groups.get(root) ?? groups.set(root, { ids: [], reasons: new Set() }).get(root)!;
    g.ids.push(r.id);
    for (const reason of reasonsOf.get(r.id) ?? []) g.reasons.add(reason);
  }
  return [...groups.values()].filter((g) => g.ids.length > 1).map((g) => ({ ids: g.ids, reasons: [...g.reasons].sort() }));
}
