"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = { key: string; label: ReactNode; href: string };

/**
 * The tab bar of a page whose tabs are addresses (`?tab=...`): underlined links in one row that scrolls sideways on a narrow screen,
 * instead of wrapping onto several lines. The current tab is marked with aria-current and scrolled into view on arrival, so a later tab
 * is never hidden off the edge. The bar has no vertical scroll (the 1px overlap of the underline is padded, not overflowed).
 */
export function TabNav({ label, items, current, className }: { label: string; items: TabItem[]; current: string; className?: string }) {
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = bar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active || !bar.current) return;
    // Scroll only the bar sideways: scrollIntoView would also move the page.
    const left = active.offsetLeft - (bar.current.clientWidth - active.offsetWidth) / 2;
    bar.current.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [current]);

  return (
    <nav ref={bar} aria-label={label} className={cn("-mt-2 flex gap-6 overflow-x-auto overflow-y-hidden border-b pb-px", className)}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 py-2.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring",
            t.key === current ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
