import { CATEGORY_LABELS, MIN_CATEGORY_COUNT, SAFEVOICE_CATEGORIES, type SafevoiceCategory } from "./constants";

// Counts for people who must never see individual reports (the Executive) and for the handlers' own overview. Pure.
// A small group could point at one person, so: a category with fewer than MIN_CATEGORY_COUNT reports is never shown with its number.
// And because the hidden number could be worked out by subtraction, the hidden categories are shown only as one combined row, and only
// when that combined count is itself at least the minimum; the overall total is shown only when nothing is hidden or the hidden part
// is at least the minimum. (Complementary suppression.)

export type PublishedStats = {
  rows: { category: SafevoiceCategory; label: string; count: number }[];
  /** The combined count of categories that each have fewer than the minimum, or null when it is too small to show. */
  otherCategories: number | null;
  /** True when at least one category is being held back. */
  someHidden: boolean;
  /** All reports, or null when showing it would let a hidden count be worked out. */
  total: number | null;
};

export function publishableStats(counts: Partial<Record<string, number>>): PublishedStats {
  const rows: PublishedStats["rows"] = [];
  let hiddenSum = 0;
  let visibleSum = 0;
  for (const category of SAFEVOICE_CATEGORIES) {
    // eslint-disable-next-line security/detect-object-injection -- `category` comes from the fixed list
    const count = counts[category] ?? 0;
    if (count >= MIN_CATEGORY_COUNT) {
      // eslint-disable-next-line security/detect-object-injection -- `category` comes from the fixed list
      rows.push({ category, label: CATEGORY_LABELS[category], count });
      visibleSum += count;
    } else hiddenSum += count;
  }
  const someHidden = SAFEVOICE_CATEGORIES.some((c) => {
    // eslint-disable-next-line security/detect-object-injection -- fixed list
    const count = counts[c] ?? 0;
    return count > 0 && count < MIN_CATEGORY_COUNT;
  });
  const otherCategories = hiddenSum >= MIN_CATEGORY_COUNT ? hiddenSum : null;
  const total = hiddenSum === 0 || hiddenSum >= MIN_CATEGORY_COUNT ? visibleSum + hiddenSum : null;
  rows.sort((a, b) => b.count - a.count);
  return { rows, otherCategories, someHidden, total };
}
