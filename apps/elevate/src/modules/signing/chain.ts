import { createHash } from "node:crypto";

// The event log of an envelope is a hash chain: each event stores the hash of the one before it, so removing, reordering or editing
// an event (even with direct database access, which the append-only trigger also blocks) is detectable. Pure: no database.

export type ChainFields = {
  envelopeId: string;
  seq: number;
  type: string;
  actorUserId: string | null;
  signerId: string | null;
  at: string; // ISO instant
  ip: string | null;
  detail: Record<string, unknown> | null;
};

export const GENESIS_HASH = "0".repeat(64);

/** Stable text for an object: keys sorted, so the same data always gives the same hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

export function computeEventHash(prevHash: string, fields: ChainFields): string {
  return createHash("sha256").update(`${prevHash}|${canonical(fields)}`).digest("hex");
}

export type StoredEvent = ChainFields & { prevHash: string; hash: string };

/** True when every event links to the one before it and its own hash is what the fields give. */
export function verifyChain(events: StoredEvent[]): { ok: true } | { ok: false; brokenAt: number } {
  let prev = GENESIS_HASH;
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  for (const [index, e] of sorted.entries()) {
    if (e.seq !== index + 1) return { ok: false, brokenAt: e.seq };
    if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq };
    const { prevHash: _p, hash: _h, ...fields } = e;
    void _p;
    void _h;
    if (computeEventHash(prev, fields) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
