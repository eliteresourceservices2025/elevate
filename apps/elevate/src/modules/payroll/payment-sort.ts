// How the Payment table of an approved run is ordered. Pure: the panel keeps the choice in the page, and nothing is stored.
// Whatever the column, ties fall back to the person's name A to Z, and rows with nothing to compare (not paid yet, no dollars recorded)
// always go last for the paid-on and dollars columns so a click never buries the rows that have a value.

export const PAYMENT_SORT_KEYS = ["name", "client", "status", "paid_on", "usd"] as const;
export type PaymentSortKey = (typeof PAYMENT_SORT_KEYS)[number];
export type PaymentSort = { key: PaymentSortKey; dir: "asc" | "desc" };

export const DEFAULT_PAYMENT_SORT: PaymentSort = { key: "name", dir: "asc" };

export type SortablePayment = {
  name: string;
  clients: string;
  payment: { paidOn: string; usdCents: string | null } | null;
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

/** The rows in the chosen order (a new array). */
export function sortPayments<T extends SortablePayment>(people: readonly T[], sort: PaymentSort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const compare = (a: T, b: T): number => {
    switch (sort.key) {
      case "client":
        return sign * byText(a.clients, b.clients);
      case "status": {
        // Ascending is "Not paid first": the rows still to be paid.
        const x = a.payment ? 1 : 0;
        const y = b.payment ? 1 : 0;
        return sign * (x - y);
      }
      case "paid_on": {
        if (!a.payment || !b.payment) return a.payment ? -1 : b.payment ? 1 : 0; // not paid yet: last, either way
        return sign * (a.payment.paidOn < b.payment.paidOn ? -1 : a.payment.paidOn > b.payment.paidOn ? 1 : 0);
      }
      case "usd": {
        const x = a.payment?.usdCents ?? null;
        const y = b.payment?.usdCents ?? null;
        if (x === null || y === null) return x !== null ? -1 : y !== null ? 1 : 0; // no dollars recorded: last, either way
        const diff = BigInt(x) - BigInt(y);
        return sign * (diff < 0n ? -1 : diff > 0n ? 1 : 0);
      }
      default:
        return sign * byText(a.name, b.name);
    }
  };
  return [...people].sort((a, b) => compare(a, b) || byText(a.name, b.name));
}

/** The choices of the Sort menu (used on a phone, where the table is a list of cards and has no column titles). */
export const PAYMENT_SORT_CHOICES: { value: string; label: string; sort: PaymentSort }[] = [
  { value: "name:asc", label: "Person, A to Z", sort: { key: "name", dir: "asc" } },
  { value: "name:desc", label: "Person, Z to A", sort: { key: "name", dir: "desc" } },
  { value: "client:asc", label: "Client, A to Z", sort: { key: "client", dir: "asc" } },
  { value: "client:desc", label: "Client, Z to A", sort: { key: "client", dir: "desc" } },
  { value: "status:asc", label: "Not paid first", sort: { key: "status", dir: "asc" } },
  { value: "status:desc", label: "Paid first", sort: { key: "status", dir: "desc" } },
  { value: "paid_on:desc", label: "Paid on, newest first", sort: { key: "paid_on", dir: "desc" } },
  { value: "paid_on:asc", label: "Paid on, oldest first", sort: { key: "paid_on", dir: "asc" } },
  { value: "usd:desc", label: "Dollars paid, highest first", sort: { key: "usd", dir: "desc" } },
  { value: "usd:asc", label: "Dollars paid, lowest first", sort: { key: "usd", dir: "asc" } },
];

/** What a column title does when clicked: the same column flips its direction, another column starts ascending (newest and highest first for dates and dollars). */
export function nextSort(current: PaymentSort, key: PaymentSortKey): PaymentSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "paid_on" || key === "usd" ? "desc" : "asc" };
}
