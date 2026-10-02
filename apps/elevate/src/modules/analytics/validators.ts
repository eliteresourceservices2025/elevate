import { z } from "zod";
import { DEFAULT_RANGE, RANGES, type DimKind } from "./constants";

// Every input to the dashboards (the address bar, the export) is checked here. Anything unusable falls back to the default view
// for the page, and is refused outright for the export.

const uuid = z.uuid();

export type ScopeSel = { kind: Extract<DimKind, "company" | "team" | "client">; id: string | null };

/** "company", "team:<uuid>" or "client:<uuid>"; null when it is anything else. */
export function parseScope(value: unknown): ScopeSel | null {
  if (value === "company") return { kind: "company", id: null };
  if (typeof value !== "string") return null;
  const m = /^(team|client):(.+)$/.exec(value);
  if (!m) return null;
  const id = uuid.safeParse(m[2]);
  return id.success ? { kind: m[1] as "team" | "client", id: id.data } : null;
}

export const scopeValue = (s: ScopeSel): string => (s.id ? `${s.kind}:${s.id}` : s.kind);

const rangeSchema = z.union([z.number(), z.string()]).transform((v) => Number(v)).refine((n) => (RANGES as readonly number[]).includes(n));

/** The address-bar parameters, with a safe default for each one that is missing or wrong. */
export function parseDashboardParams(raw: unknown): { range: number; scope: ScopeSel } {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const range = rangeSchema.safeParse(first(o.range));
  return { range: range.success ? range.data : DEFAULT_RANGE, scope: parseScope(first(o.scope)) ?? { kind: "company", id: null } };
}

/** The export takes the same two choices and refuses anything else. */
export const exportAnalyticsSchema = z.object({
  range: rangeSchema,
  scope: z.string().refine((v) => parseScope(v) !== null, "Choose a group from the list."),
});
