import { GENDERS, GENDER_LABELS, MIN_GROUP, RELIGIONS, RELIGION_LABELS } from "./constants";

// The combined counts HR may see. Pure (no database, no encryption) so the minimum-group rule is unit tested.

export type Group = { key: string; label: string; count: number };
export type SummaryBlock = { gender: Group[]; religion: Group[] };

const tally = (keys: (string | null)[], labels: Record<string, string>, order: readonly string[]): Group[] => {
  const counts = new Map<string, number>();
  for (const k of keys) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  // A group under the minimum is dropped, and neither the dropped groups nor a total is shown, so nobody can be worked out.
  return order.filter((k) => (counts.get(k) ?? 0) >= MIN_GROUP).map((k) => ({ key: k, label: labels[k] ?? k, count: counts.get(k)! }));
};

export function summarizeAnswers(genders: (string | null)[], religions: (string | null)[]): SummaryBlock {
  return { gender: tally(genders, GENDER_LABELS, GENDERS), religion: tally(religions, RELIGION_LABELS, RELIGIONS) };
}
