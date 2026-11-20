import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A compact dashboard tile for the bento grid: tight padding, a small heading with an optional link, and rows that never stretch
 * to fill space. `label` is the region's accessible name. `tone="gold"` is the one celebratory tile (the brand gold as a border, never as text).
 */
export function Tile({ label, title, icon, href, hrefLabel, tone, className, children }: { label: string; title: ReactNode; icon?: ReactNode; href?: string; hrefLabel?: string; tone?: "gold" | "primary"; className?: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex h-full min-w-0 flex-col rounded-2xl border bg-card p-3.5 shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none",
        tone === "gold" && "border-brand-gold ring-1 ring-brand-gold/40",
        tone === "primary" && "border-primary/60 ring-1 ring-primary/20",
        className,
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {href ? (
          <Link href={href} className="shrink-0 rounded-md text-xs text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Minutes as hours with one decimal, e.g. 26.5 h. */
export const hoursLabel = (minutes: number) => `${(Math.round(minutes / 6) / 10).toString()} h`;

/** Rows of a tile, divided by hairlines. */
export function TileList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-border/70 text-sm", className)}>{children}</ul>;
}

export function TileRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("flex min-w-0 items-center gap-2 py-1.5 first:pt-0", className)}>{children}</li>;
}

/** What a tile says when it has nothing to show. */
export function TileNote({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {icon}
      {children}
    </p>
  );
}

/** Small right-aligned text at the end of a row. */
export function RowMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("ml-auto shrink-0 text-xs text-muted-foreground", className)}>{children}</span>;
}

/** Two-letter initials in a circle. */
export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground", className)}>
      {letters}
    </span>
  );
}
