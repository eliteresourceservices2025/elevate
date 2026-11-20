import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { arrangeTiles, type TileDef, type TileLayout } from "../bento-tiles";

// Full class strings, so Tailwind sees every one. Two columns below the wide breakpoint, six from `lg`.
const SPAN: Record<TileDef["span"], string> = {
  1: "",
  2: "col-span-2 sm:col-span-1 lg:col-span-2",
  3: "col-span-2 lg:col-span-3",
  4: "col-span-2 lg:col-span-4",
  6: "col-span-2 lg:col-span-6",
};

/** A tile two rows tall is full width on a tablet; on a wide screen it must size itself inside the cell (see BirthdaysTile: `lg:absolute lg:inset-0`). */
const TALL = "col-span-2 lg:col-span-2 lg:row-span-2 lg:relative";

/**
 * One view as a bento grid: six columns on a wide screen with every row full, two on a tablet, tiles compact and never stretching to fill
 * space. Each tile is its own `Suspense`, and each tile component wraps itself in `guarded()`, so one slow tile never freezes the rest.
 * `layout` is the person's own hide and reorder choice; it only filters and sorts the tiles the view already allows.
 */
export function BentoView({ tiles, layout = null }: { tiles: readonly TileDef[]; layout?: TileLayout | null }) {
  return (
    <div className="grid grid-flow-dense grid-cols-2 gap-3 lg:grid-cols-6">
      {arrangeTiles(tiles, layout).map((t) => (
        <div key={t.id} className={cn("min-w-0 empty:hidden", t.rows ? TALL : SPAN[t.span])}>
          <Suspense fallback={<Skeleton className="h-full min-h-32 rounded-2xl" />}>{t.render()}</Suspense>
        </div>
      ))}
    </div>
  );
}
