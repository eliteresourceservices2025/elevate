import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { getKpis } from "../queries";
import type { Lens } from "../lens";

/** The numbers at the top of a view. Each card opens the page it comes from. */
export async function KpiCards({ lens }: { lens: Lens }) {
  const kpis = await getKpis(lens);
  if (kpis.length === 0) return null;
  return (
    <section aria-label="Key numbers">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <li key={k.id}>
            <Link href={k.href} className="block h-full rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              <p className="mt-1 font-heading text-3xl font-bold tabular-nums">{k.value === null ? "—" : k.value.toLocaleString("en-US")}</p>
              {k.hint ? <p className="mt-1 text-xs text-muted-foreground">{k.hint}</p>  : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function KpiCardsSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Skeleton className="h-[5.5rem] rounded-xl" />
        </li>
      ))}
    </ul>
  );
}
