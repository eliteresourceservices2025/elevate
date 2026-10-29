"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = { key: string; label: ReactNode; href: string; onClick?: () => void };

/**
 * The tab bar for addressable page sections (`?tab=...`). It shares the filled, rounded treatment of the interactive Tabs component,
 * while keeping native links, URL history, and a single horizontal scroll row on narrow screens.
 */
export function TabNav({ label, items, current, className }: { label: string; items: TabItem[]; current: string; className?: string }) {
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = bar.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!active || !bar.current) return;
    // Scroll only the bar sideways: scrollIntoView would also move the page.
    const activeBounds = active.getBoundingClientRect();
    const barBounds = bar.current.getBoundingClientRect();
    const left = bar.current.scrollLeft + activeBounds.left - barBounds.left - (bar.current.clientWidth - activeBounds.width) / 2;
    bar.current.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [current]);

  return (
    <nav ref={bar} aria-label={label} className={cn("-mx-1 -mt-2 overflow-x-auto overflow-y-hidden px-1 pb-1", className)}>
      <div className="inline-flex min-h-11 min-w-max items-center gap-1 rounded-xl bg-muted p-1 text-muted-foreground">
        {items.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === current ? "page" : undefined}
            onClick={t.onClick}
            className={cn(
              "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap outline-none transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50",
              t.key === current ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
