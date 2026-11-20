import { Cake } from "lucide-react";
import { cn } from "@/lib/utils";
import { celebrationRows } from "@/modules/people/celebrations";
import { orFallback } from "../or-fallback";
import { getAnniversariesTile, getBirthdaysTile, getNewJoinersTile } from "../people-strip-queries";
import { Initials, RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

const KIND_LABEL = { Bday: "Birthday", Anniv: "Anniversary", New: "New" } as const;

/**
 * One tile for the manager views: this month's birthdays (two), an anniversary and a new joiner. Month and day only, never the year;
 * people who hid their birthday are already left out by the query. `tall` is for a tile that spans two rows (it sizes itself inside the cell).
 */
export async function CelebrationsTile({ tall }: { tall?: boolean }) {
  return guarded("Celebrations", async () => {
    const [birthdays, anniversaries, joiners] = await Promise.all([
      orFallback(async () => (await getBirthdaysTile()).celebrants, []),
      orFallback(() => getAnniversariesTile(), []),
      orFallback(() => getNewJoinersTile(), []),
    ]);
    const rows = celebrationRows(birthdays, anniversaries, joiners);
    return (
      <Tile label="Celebrations" title="Celebrations" icon={<Cake className="size-4 text-primary" aria-hidden />} tone="gold" className={cn(tall && "lg:absolute lg:inset-0")}>
        {rows.length === 0 ? (
          <TileNote>Nothing to celebrate this month yet.</TileNote>
        ) : (
          <TileList className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((r, i) => (
              <TileRow key={`${r.kind}-${r.name}-${i}`}>
                <Initials name={r.name} className={r.today ? "bg-accent text-accent-foreground" : undefined} />
                <span className="min-w-0 flex-1 truncate">
                  {r.name} <span className="text-xs text-muted-foreground">{KIND_LABEL[r.kind]}</span>
                </span>
                <RowMeta className={r.today ? "font-medium text-foreground" : undefined}>{r.meta}</RowMeta>
              </TileRow>
            ))}
          </TileList>
        )}
      </Tile>
    );
  });
}
