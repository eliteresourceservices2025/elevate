import type { JibblePerson } from "./http-client";

// Finding one Jibble account from what HR types: the email used in Jibble, the member code, or Jibble's own person id.
// Pure and server-side only: the action looks the text up in Jibble's people list and stores the id it finds.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AccountLookup = { kind: "id"; id: string } | { kind: "found"; person: JibblePerson } | { kind: "none" } | { kind: "many" };

export const looksLikePersonId = (text: string) => UUID.test(text.trim());

/** An id is used as given (as before). An email is compared whole and without case; anything else is a member code, also whole and without case. */
export function resolveJibbleAccount(text: string, people: JibblePerson[]): AccountLookup {
  const q = text.trim();
  if (looksLikePersonId(q)) return { kind: "id", id: q.toLowerCase() };
  const wanted = q.toLowerCase();
  if (!wanted) return { kind: "none" };
  const byEmail = q.includes("@");
  const hits = people.filter((p) => (byEmail ? p.email?.trim().toLowerCase() === wanted : p.code?.trim().toLowerCase() === wanted));
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "many" };
  return { kind: "found", person: hits[0] };
}
