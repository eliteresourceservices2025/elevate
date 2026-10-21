import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One dashboard block: a card with a heading, an optional count and link, and rows separated by hairlines.
 * `label` is the region's accessible name (the tests and screen readers find a panel by it). It fades in as it loads (not with reduced motion).
 */
export function Panel({ label, title, count, href, hrefLabel, className, children }: { label: string; title: ReactNode; count?: number; href?: string; hrefLabel?: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn("rounded-2xl border bg-card shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none", className)}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {title}
          {count !== undefined ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">{count}</span> : null}
        </h2>
        {href ? (
          <Link href={href} className="rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Rows of a panel, divided by hairlines. */
export function PanelList({ children, className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul className={cn("divide-y divide-border/70", className)} {...props}>
      {children}
    </ul>
  );
}

/** What a panel says when it has nothing to show. */
export function PanelNote({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 px-5 pt-1 pb-5 text-sm text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

/** Interactive row styling shared by the link rows of the panels. */
export const ROW_LINK = "flex items-start gap-3 px-5 py-3.5 outline-none transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
