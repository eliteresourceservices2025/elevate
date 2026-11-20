// Sorting the pay run sheet (and the Rates tab). Pure: no database. The lines come in from the database already ordered by last name, first
// name and alias, and every sort below keeps that order for ties, so "Name, A to Z" is simply the order they arrive in. A missing figure
// (an unreadable line, no earlier run to compare with) and "No client" always sort last, whichever way the list is turned.

export const SORT_VALUES = ["name_asc", "name_desc", "client_asc", "client_desc", "rate_desc", "rate_asc", "net_desc", "net_asc", "change_desc", "change_asc", "unchecked", "attention"] as const;
export type SortValue = (typeof SORT_VALUES)[number];
export const DEFAULT_SORT: SortValue = "name_asc";

/** What each option says in the Sort menu. */
export const SORT_LABELS: Record<SortValue, string> = {
  name_asc: "Name, A to Z",
  name_desc: "Name, Z to A",
  client_asc: "Client, then name",
  client_desc: "Client, Z to A",
  rate_desc: "Monthly rate, high to low",
  rate_asc: "Monthly rate, low to high",
  net_desc: "Total payable, high to low",
  net_asc: "Total payable, low to high",
  change_desc: "Biggest change from last run",
  change_asc: "Smallest change from last run",
  unchecked: "Not yet checked first",
  attention: "Needs attention first",
};

/** The options in the order the menu lists them. */
export const SORT_MENU: readonly SortValue[] = ["name_asc", "name_desc", "client_asc", "rate_desc", "rate_asc", "net_desc", "net_asc", "change_desc", "unchecked", "attention"];

/** An address value to a sort; anything that is not a known option is the default. */
export function parseSort(value: unknown): SortValue {
  return (SORT_VALUES as readonly string[]).includes(value as string) ? (value as SortValue) : DEFAULT_SORT;
}

/** The numbers a line is sorted on, as whole centavos in text (never a float). Null when the line has none. */
export type SortKeys = { monthly: string | null; net: string | null; change: string | null };

export type SortableLine = {
  runLineId: string;
  clientName: string | null;
  confirmedByName: string | null;
  sortKeys: SortKeys;
};

export type SortContext = { attentionIds?: ReadonlySet<string> };

const big = (s: string | null): bigint | null => (s === null ? null : BigInt(s));
const abs = (n: bigint) => (n < 0n ? -n : n);
const cmpBig = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/** Compares two possibly missing values in one direction; a missing value is always after a present one. */
function nullsLast<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * cmp(a, b);
}

const byText = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });

type Entry<L> = { line: L; index: number };

function comparator<L extends SortableLine>(sort: SortValue, ctx: SortContext): (a: Entry<L>, b: Entry<L>) => number {
  const client = (dir: 1 | -1) => (a: Entry<L>, b: Entry<L>) => nullsLast(a.line.clientName, b.line.clientName, byText, dir);
  const keyed = (pick: (k: SortKeys) => string | null, map: (n: bigint) => bigint, dir: 1 | -1) => (a: Entry<L>, b: Entry<L>) =>
    nullsLast(big(pick(a.line.sortKeys)), big(pick(b.line.sortKeys)), (x, y) => cmpBig(map(x), map(y)), dir);
  const same = (n: bigint) => n;
  switch (sort) {
    case "name_asc":
      return () => 0;
    case "name_desc":
      return (a, b) => b.index - a.index;
    case "client_asc":
      return client(1);
    case "client_desc":
      return client(-1);
    case "rate_desc":
      return keyed((k) => k.monthly, same, -1);
    case "rate_asc":
      return keyed((k) => k.monthly, same, 1);
    case "net_desc":
      return keyed((k) => k.net, same, -1);
    case "net_asc":
      return keyed((k) => k.net, same, 1);
    case "change_desc":
      return keyed((k) => k.change, abs, -1);
    case "change_asc":
      return keyed((k) => k.change, abs, 1);
    case "unchecked":
      return (a, b) => Number(a.line.confirmedByName !== null) - Number(b.line.confirmedByName !== null);
    case "attention":
      return (a, b) => Number(!ctx.attentionIds?.has(a.line.runLineId)) - Number(!ctx.attentionIds?.has(b.line.runLineId));
  }
}

/**
 * The lines in the chosen order, as a new list. Ties keep the order the lines came in (last name, first name, alias). With
 * \`groupByClient\`, lines are first gathered by client (A to Z, "No client" last; Z to A for "Client, Z to A") and the chosen sort orders the
 * people inside each client.
 */
export function sortLines<L extends SortableLine>(lines: readonly L[], sort: SortValue, ctx: SortContext = {}, options: { groupByClient?: boolean } = {}): L[] {
  const entries: Entry<L>[] = lines.map((line, index) => ({ line, index }));
  const within = comparator<L>(sort, ctx);
  const groups = options.groupByClient ? (a: Entry<L>, b: Entry<L>) => nullsLast(a.line.clientName, b.line.clientName, byText, sort === "client_desc" ? -1 : 1) : () => 0;
  // Inside a group the "client" sorts mean "by name": every line in it has the same client already.
  const inside = options.groupByClient && (sort === "client_asc" || sort === "client_desc") ? comparator<L>("name_asc", ctx) : within;
  return entries.sort((a, b) => groups(a, b) || inside(a, b) || a.index - b.index).map((e) => e.line);
}

/** The column headers that sort when clicked. */
export type SortHeader = "name" | "client" | "rate" | "net" | "change" | "checked";

const HEADER_SORTS: Record<SortHeader, readonly [SortValue, SortValue | null]> = {
  name: ["name_asc", "name_desc"],
  client: ["client_asc", "client_desc"],
  rate: ["rate_desc", "rate_asc"],
  net: ["net_desc", "net_asc"],
  change: ["change_desc", "change_asc"],
  checked: ["unchecked", null],
};

/** What clicking a column header asks for next: its first sort, then the opposite one while it is already the sort. */
export function nextSort(header: SortHeader, current: SortValue): SortValue {
  const [first, second] = HEADER_SORTS[header];
  return second !== null && current === first ? second : first;
}

/** Whether a header is the current sort, and which way it points (for the arrow). */
export function headerState(header: SortHeader, current: SortValue): "up" | "down" | null {
  const [first, second] = HEADER_SORTS[header];
  if (current !== first && current !== second) return null;
  return current.endsWith("_desc") ? "down" : "up";
}
