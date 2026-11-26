// Pure rules for turning a Jibble person's time entries into ELEVATE clock events. No database, no clock, no network.
// Only entry times, the kind of entry (in, out, start break) and the project and activity ids are read: never screenshots, location or activity data.

import { type ClockState, type ClockType } from "@/modules/attendance/clock";

/** One active Jibble time entry of a person. `timeMs` is the instant Jibble recorded. */
export type JibbleTimeEntry = { id: string; type: "In" | "Out" | "StartBreak"; timeMs: number; projectId: string | null; activityId: string | null };

/** Which ELEVATE client a Jibble activity or project means; `only` is the client of a person who has just one (used when an entry has no mapping). */
export type ClientMapping = { activity: ReadonlyMap<string, string>; project: ReadonlyMap<string, string>; only: string | null };

/** A project or activity id on an entry that no client is mapped to (and no single client to fall back on). */
export type Unmapped = { kind: "project" | "activity"; id: string };

export type DesiredEvent = { type: ClockType; atMs: number; entryId: string; clientId: string | null };

/** An event already imported for this person (possibly voided). */
export type ImportedEvent = { id: string; entryId: string; type: string; atMs: number; clientId: string | null; voided: boolean };

/**
 * The client of an entry: its activity's client, else its project's, else the person's only client, else none (then an unmapped id is
 * reported so HR can map it, and the day is flagged until they do).
 */
export function clientFor(entry: Pick<JibbleTimeEntry, "projectId" | "activityId">, mapping: ClientMapping): { clientId: string | null; unmapped: Unmapped[] } {
  const byActivity = entry.activityId ? mapping.activity.get(entry.activityId) : undefined;
  if (byActivity) return { clientId: byActivity, unmapped: [] };
  const byProject = entry.projectId ? mapping.project.get(entry.projectId) : undefined;
  if (byProject) return { clientId: byProject, unmapped: [] };
  if (mapping.only) return { clientId: mapping.only, unmapped: [] };
  const unmapped: Unmapped[] = [];
  if (entry.activityId) unmapped.push({ kind: "activity", id: entry.activityId });
  if (entry.projectId) unmapped.push({ kind: "project", id: entry.projectId });
  return { clientId: null, unmapped };
}

/**
 * The ELEVATE events a person's Jibble entries stand for, in order, starting from where the person already was before the first entry.
 * An In while out is a clock-in; an In while on a break ends the break; an In while working with a different client is a switch of client
 * (that is how Jibble records a change of project or activity); an Out ends the session (ending a break first when on one); a start break
 * while working starts a break. Anything that does not fit the state is ignored.
 */
export function desiredEvents(
  entries: readonly JibbleTimeEntry[],
  start: { state: ClockState; clientId: string | null },
  mapping: ClientMapping,
): { events: DesiredEvent[]; unmapped: Unmapped[] } {
  const events: DesiredEvent[] = [];
  const unmapped: Unmapped[] = [];
  let state = start.state;
  let client = start.clientId;
  for (const e of [...entries].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id))) {
    const mapped = clientFor(e, mapping);
    unmapped.push(...mapped.unmapped);
    if (e.type === "In") {
      if (state === "out") {
        events.push({ type: "clock_in", atMs: e.timeMs, entryId: e.id, clientId: mapped.clientId });
        client = mapped.clientId;
        state = "working";
      } else {
        if (state === "break") {
          events.push({ type: "break_end", atMs: e.timeMs, entryId: e.id, clientId: null });
          state = "working";
        }
        if (mapped.clientId !== null && mapped.clientId !== client) {
          events.push({ type: "switch_client", atMs: e.timeMs, entryId: e.id, clientId: mapped.clientId });
          client = mapped.clientId;
        }
      }
    } else if (e.type === "StartBreak") {
      if (state === "working") {
        events.push({ type: "break_start", atMs: e.timeMs, entryId: e.id, clientId: null });
        state = "break";
      }
    } else if (state !== "out") {
      if (state === "break") events.push({ type: "break_end", atMs: e.timeMs, entryId: e.id, clientId: null });
      events.push({ type: "clock_out", atMs: e.timeMs, entryId: e.id, clientId: null });
      state = "out";
    }
  }
  return { events, unmapped };
}

const keyOf = (entryId: string, type: string, atMs: number, clientId: string | null) => `${entryId}|${type}|${atMs}|${clientId ?? ""}`;

/**
 * What to change so the imported events match the entries: add what is missing, and void what Jibble no longer says (an entry deleted,
 * or edited to another time, or mapped to another client). An event that was voided earlier is not added again while the entry still
 * says the same thing (same time and client); if HR maps a project or activity to a client later, the day is re-attributed.
 */
export function planImport(desired: readonly DesiredEvent[], existing: readonly ImportedEvent[]): { toInsert: DesiredEvent[]; toVoid: string[] } {
  const have = new Set(existing.map((e) => keyOf(e.entryId, e.type, e.atMs, e.clientId)));
  const wanted = new Set(desired.map((d) => keyOf(d.entryId, d.type, d.atMs, d.clientId)));
  return {
    toInsert: desired.filter((d) => !have.has(keyOf(d.entryId, d.type, d.atMs, d.clientId))),
    toVoid: existing.filter((e) => !e.voided && !wanted.has(keyOf(e.entryId, e.type, e.atMs, e.clientId))).map((e) => e.id),
  };
}

/**
 * Why one person's import failed, as a short code that is safe to keep and show: Jibble's HTTP status, the database's error code, or the
 * error's class name. Never a message, which can carry names, ids or what Jibble sent.
 */
export function failureReason(error: unknown): string {
  const e = (error ?? {}) as { name?: unknown; status?: unknown; code?: unknown; cause?: { code?: unknown } };
  if (e.name === "JibbleError") return typeof e.status === "number" ? `Jibble ${e.status}` : "Jibble unreachable";
  const code = e.cause?.code ?? e.code;
  if (typeof code === "string" && /^(?=.*\d)[0-9A-Z]{5}$/.test(code)) return `database ${code}`;
  return typeof e.name === "string" && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "unknown error";
}

/** The outcome of a whole run (all its steps): how many people were not imported and why, or null when everyone was. Counts and codes only. */
export function importProblem(runs: readonly { people: number; failed: number; reasons: Readonly<Record<string, number>> }[]): { failed: number; total: number; refusedOnly: boolean; text: string } | null {
  const failed = runs.reduce((n, r) => n + r.failed, 0);
  if (failed === 0) return null;
  const total = failed + runs.reduce((n, r) => n + r.people, 0);
  const reasons = new Map<string, number>();
  for (const run of runs) for (const [reason, n] of Object.entries(run.reasons)) reasons.set(reason, (reasons.get(reason) ?? 0) + n);
  const sorted = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    failed,
    total,
    refusedOnly: sorted.every(([reason]) => reason === "Jibble 401" || reason === "Jibble 403"),
    text: `${failed} of ${total} not imported: ${sorted.slice(0, 4).map(([reason, n]) => `${reason} (${n})`).join(", ")}`,
  };
}
