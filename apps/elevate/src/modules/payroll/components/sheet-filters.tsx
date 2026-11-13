import Link from "next/link";
import { cn } from "@/lib/utils";

// Chips above the sheet that show only some of the lines: everyone, the ones that need attention, the ones nobody has checked yet, or the
// people with one kind of problem. The choice is in the address (?focus=...), so it can be shared and survives a refresh.

export type SheetChip = { key: string; label: string; count: number };

export function SheetFilters({ runId, active, chips, shown, total, sizeQuery }: { runId: string; active: string | undefined; chips: SheetChip[]; shown: number; total: number; sizeQuery: string }) {
  const href = (key: string) => (key === "all" ? `/payroll/${runId}${sizeQuery ? `?${sizeQuery}` : ""}#pay-sheet` : `/payroll/${runId}?focus=${key}${sizeQuery ? `&${sizeQuery}` : ""}#pay-sheet`);
  return (
    <nav aria-label="Filter the sheet" className="space-y-1">
      <ul className="flex flex-wrap items-center gap-2">
        {chips.map((c) => {
          const on = (active ?? "all") === c.key;
          return (
            <li key={c.key}>
              <Link
                href={href(c.key)}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm pointer-coarse:min-h-11",
                  on ? "border-transparent bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
                )}
              >
                {c.label}
                <span className={cn("tabular-nums", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{c.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {active ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing {shown} of {total} {total === 1 ? "line" : "lines"}.
        </p>
      ) : null}
    </nav>
  );
}
