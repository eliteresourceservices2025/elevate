import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { getKpis } from "../queries";
import type { Lens } from "../lens";
import { guarded } from "./guard";

/** The numbers at the top of a view. Each card opens the page it comes from. */
export async function KpiCards({ lens }: { lens: Lens }) {
  return guarded("Key numbers", async () => {
    const kpis = await getKpis(lens);
    if (kpis.length === 0) return null;
    return (
      <section aria-label="Key numbers">
        <div className="overflow-clip rounded-2xl border bg-card shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none">
        {/* Each cell draws its right and bottom hairline; the list is pulled out by 1px so the outer edge's lines are clipped away. */}
        <ul className="-mr-px -mb-px grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <li key={k.id} className="border-r border-b">
              <Link href={k.href} className="block h-full px-5 py-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
                <p className={cn("mt-1 font-heading text-3xl font-bold tabular-nums", k.id === "approvals" && k.value ? "text-primary" : undefined)}>{k.value === null ? "—" : k.value.toLocaleString("en-US")}</p>
                {k.hint ? <p className="mt-0.5 text-xs text-muted-foreground">{k.hint}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
        </div>
      </section>
    );
  });
}

export function KpiCardsSkeleton() {
  return (
    <Skeleton className="h-[5.75rem] rounded-2xl" aria-hidden />
  );
}
