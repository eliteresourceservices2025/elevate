// What the all-applicants list can be filtered and sorted by. Pure: it reads the address (?q=&stage=...) and turns anything
// it does not recognise into "no filter", so a hand-typed or stale link never errors and nothing odd reaches the query.
import { CLOSE_KINDS, STAGES, type CloseKind, type Stage } from "./constants";

export const APPLICANT_SORTS = ["applied", "updated", "name"] as const;
export type ApplicantSort = (typeof APPLICANT_SORTS)[number];
export const APPLICANT_SORT_LABELS: Record<ApplicantSort, string> = { applied: "Newest applications", updated: "Recently changed", name: "Name (A to Z)" };

/** "open" = anyone still in the pipeline (not hired and not closed). */
export type StageFilter = Stage | "open" | "all";

export type ApplicantFilters = {
  q: string;
  stage: StageFilter;
  closeKind: CloseKind | "all";
  openingId: string | null;
  from: string | null;
  to: string | null;
  sort: ApplicantSort;
};

export const EMPTY_FILTERS: ApplicantFilters = { q: "", stage: "all", closeKind: "all", openingId: null, from: null, to: null, sort: "applied" };

export const SEARCH_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : typeof v === "string" ? v : "");

function isoDate(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

export function parseApplicantFilters(raw: Record<string, unknown>): ApplicantFilters {
  const stage = first(raw.stage);
  const kind = first(raw.kind);
  const sort = first(raw.sort);
  const job = first(raw.job);
  return {
    q: first(raw.q).replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX),
    stage: stage === "open" || (STAGES as readonly string[]).includes(stage) ? (stage as StageFilter) : "all",
    closeKind: (CLOSE_KINDS as readonly string[]).includes(kind) ? (kind as CloseKind) : "all",
    openingId: UUID.test(job) ? job.toLowerCase() : null,
    from: isoDate(first(raw.from)),
    to: isoDate(first(raw.to)),
    sort: (APPLICANT_SORTS as readonly string[]).includes(sort) ? (sort as ApplicantSort) : "applied",
  };
}

/** The same filters as an address query (only what differs from "no filter"), for the pager and the Reset link. */
export function filtersToQuery(f: ApplicantFilters): Record<string, string | undefined> {
  return {
    q: f.q || undefined,
    stage: f.stage === "all" ? undefined : f.stage,
    kind: f.closeKind === "all" ? undefined : f.closeKind,
    job: f.openingId ?? undefined,
    from: f.from ?? undefined,
    to: f.to ?? undefined,
    sort: f.sort === "applied" ? undefined : f.sort,
  };
}

/** Escapes % _ and \ so a typed search is matched as plain text by LIKE. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
