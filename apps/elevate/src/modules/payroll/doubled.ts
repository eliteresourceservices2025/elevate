// Finding doubled rates: two pay lines of the same person for the same client whose dates overlap, so a run pays both. Pure: no database,
// no clock (dates are plain YYYY-MM-DD strings). With a client, the alias is ignored on purpose (the owner's rule: the same person with a
// different CLIENT is a second job, anything else on the same client is a double). With no client there is nothing to compare but the alias, so
// two no-client lines are doubled only when their aliases match. A restored line is decided on, and is left out before it gets here.

export type DoubledInput = {
  lineKey: string;
  employeeId: string;
  /** The client's name as stored (client names are unique, ignoring case). Null when the line has no client. */
  clientName: string | null;
  /** The line's alias; compared only between lines that have no client. */
  alias?: string | null;
  /** The first day the line is in force. */
  first: string;
  /** The line's last day, or null while it has not ended. */
  last: string | null;
  /** When the line was last written: breaks a tie between two lines that start on the same day (the later one is kept). */
  createdAt: number;
  /** The line has been on a real pay run (not a test, not cancelled): it can be stopped but not taken away. */
  onRealRun: boolean;
};

export type DoubledRemoval = {
  lineKey: string;
  /** withdraw: take it away (never on a real run). end: stop it the day before the kept line starts (it was paid). manual: neither is possible. */
  how: "withdraw" | "end" | "manual";
  /** The last day to write when `how` is "end". */
  endsOn: string | null;
};

export type DoubledGroup = {
  /** Person and client, stable between the preview and the apply. */
  groupId: string;
  employeeId: string;
  /** The client the group is about, as the first line spells it (null for no client). */
  clientName: string | null;
  keep: string;
  remove: DoubledRemoval[];
};

/** One line of a doubled group, as the dialog shows it (the figure is already formatted). */
export type DoubledLineView = { lineKey: string; alias: string | null; monthly: string; since: string; until: string | null };
export type DoubledGroupView = {
  groupId: string;
  name: string;
  clientName: string | null;
  keep: DoubledLineView;
  remove: (DoubledLineView & { how: DoubledRemoval["how"]; endsOn: string | null })[];
};

const FAR = "9999-12-31";
const norm = (name: string | null) => (name === null ? null : name.trim().toLowerCase().replace(/\s+/g, " ") || null);

function dayBefore(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

const overlaps = (a: DoubledInput, b: DoubledInput) => a.first <= (b.last ?? FAR) && b.first <= (a.last ?? FAR);

/**
 * Every set of lines of one person and one client that overlap in time, with the one to keep (the line that starts last: it is the newer
 * rate; a tie goes to the line written last) and what to do with each of the others. A line with no client joins the person's client when the
 * person has exactly one client among these lines and the line has no alias or the client's alias (a leftover from before the client was
 * filled in); otherwise it stays with the other no-client lines of the same alias. Lines that follow each other without overlapping are not doubled.
 */
export function findDoubledRates(lines: DoubledInput[]): DoubledGroup[] {
  const aliasOf = (l: DoubledInput) => (l.alias ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const namedOf = new Map<string, Set<string>>();
  const aliasesWithClient = new Map<string, Set<string>>();
  for (const l of lines) {
    const key = norm(l.clientName);
    if (key === null) continue;
    namedOf.set(l.employeeId, (namedOf.get(l.employeeId) ?? new Set()).add(key));
    aliasesWithClient.set(l.employeeId, (aliasesWithClient.get(l.employeeId) ?? new Set()).add(aliasOf(l)));
  }
  const keyOf = (l: DoubledInput): string => {
    const own = norm(l.clientName);
    if (own !== null) return own;
    const named = namedOf.get(l.employeeId);
    // A no-client line with its own alias is another role, not a leftover.
    if (named && named.size === 1 && (aliasOf(l) === "" || aliasesWithClient.get(l.employeeId)?.has(aliasOf(l)))) return [...named][0];
    // No client to compare: only the same alias is the same job.
    return `|${aliasOf(l)}`;
  };

  const byGroup = new Map<string, DoubledInput[]>();
  for (const l of lines) byGroup.set(`${l.employeeId}|${keyOf(l)}`, [...(byGroup.get(`${l.employeeId}|${keyOf(l)}`) ?? []), l]);

  const out: DoubledGroup[] = [];
  for (const [groupId, group] of byGroup) {
    if (group.length < 2) continue;
    // Connected sets of overlapping lines.
    const seen = new Set<string>();
    for (const start of group) {
      if (seen.has(start.lineKey)) continue;
      const component: DoubledInput[] = [];
      const stack = [start];
      seen.add(start.lineKey);
      while (stack.length > 0) {
        const next = stack.pop()!;
        component.push(next);
        for (const other of group) {
          if (!seen.has(other.lineKey) && overlaps(next, other)) {
            seen.add(other.lineKey);
            stack.push(other);
          }
        }
      }
      if (component.length < 2) continue;
      const keep = [...component].sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : b.createdAt - a.createdAt))[0];
      const remove: DoubledRemoval[] = component
        .filter((l) => l !== keep)
        .map((l) => {
          if (!l.onRealRun) return { lineKey: l.lineKey, how: "withdraw", endsOn: null };
          // Paid before: stop it the day before the kept line starts, when that is not before its own first day.
          return l.first < keep.first ? { lineKey: l.lineKey, how: "end", endsOn: dayBefore(keep.first) } : { lineKey: l.lineKey, how: "manual", endsOn: null };
        });
      out.push({ groupId: `${groupId}${out.some((g) => g.groupId.startsWith(groupId)) ? `#${out.length}` : ""}`, employeeId: keep.employeeId, clientName: keep.clientName, keep: keep.lineKey, remove });
    }
  }
  return out.sort((a, b) => (a.groupId < b.groupId ? -1 : 1));
}
