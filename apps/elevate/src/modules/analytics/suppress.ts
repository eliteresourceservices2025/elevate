import { MIN_GROUP } from "./constants";

// Small-group suppression. Pure. The rule: a group, or a cell of a breakdown, built from fewer than MIN_GROUP people is never shown
// with its number. Hidden groups are merged into "Other"; if "Other" itself would be small (and so would reveal a hidden group
// by subtraction), the smallest visible group is merged into it as well until "Other" is large enough.

export const isSmall = (size: number | null | undefined): boolean => size === null || size === undefined || size < MIN_GROUP;

export type Sized = { size: number };

export type Grouped<T extends Sized> = {
  visible: T[];
  /** The merged remainder. Only its total size and how many groups it holds are meant for the screen, never who they are. */
  other: { size: number; members: number; items: T[] } | null;
};

export function groupWithOther<T extends Sized>(groups: T[]): Grouped<T> {
  const visible = groups.filter((g) => !isSmall(g.size)).sort((a, b) => b.size - a.size);
  const merged = groups.filter((g) => isSmall(g.size));
  let otherSize = merged.reduce((n, g) => n + g.size, 0);
  while (merged.length > 0 && isSmall(otherSize) && visible.length > 0) {
    const g = visible.pop() as T; // the smallest visible group
    merged.push(g);
    otherSize += g.size;
  }
  if (merged.length === 0) return { visible, other: null };
  // Even after merging everything there is too little to show: nothing is returned.
  if (isSmall(otherSize)) return { visible: [], other: null };
  return { visible, other: { size: otherSize, members: merged.length, items: merged } };
}

/** The number to show for a cell, or null when its group is too small. */
export function shown(value: number, groupSize: number | null | undefined): number | null {
  return isSmall(groupSize) ? null : value;
}

export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
