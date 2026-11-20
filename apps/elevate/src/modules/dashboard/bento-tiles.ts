import type { ReactNode } from "react";

/** One tile of a bento view. `span` is the number of the six columns it takes on a wide screen; `rows: 2` makes it two rows tall. */
export type TileDef = {
  id: string;
  label: string;
  span: 1 | 2 | 3 | 4 | 6;
  rows?: 2;
  render: () => ReactNode;
};

/** A person's own choices for one view: tile ids to hide, and tile ids to put first (in that order). Only a preference, never a permission. */
export type TileLayout = { hidden: string[]; order: string[] };

/**
 * The tiles to show, in order: hidden ones removed, ordered ones first, the rest in their default order. Ids that are not tiles of this
 * view (a tile that was removed, or never existed) are ignored, so an old saved layout can never break the page.
 */
export function arrangeTiles(tiles: readonly TileDef[], layout: TileLayout | null): TileDef[] {
  if (!layout) return [...tiles];
  const hidden = new Set(layout.hidden);
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const first: TileDef[] = [];
  const placed = new Set<string>();
  for (const id of layout.order) {
    const t = byId.get(id);
    if (!t || hidden.has(id) || placed.has(id)) continue;
    first.push(t);
    placed.add(id);
  }
  return [...first, ...tiles.filter((t) => !placed.has(t.id) && !hidden.has(t.id))];
}
