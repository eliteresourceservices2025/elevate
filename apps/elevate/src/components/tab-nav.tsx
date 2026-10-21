import Link from "next/link";
import { cn } from "@/lib/utils";

export type TabItem = { key: string; label: string; href: string };

/**
 * The tab bar of a page whose tabs are addresses (`?tab=...`): underlined links in one row that scrolls sideways on a narrow screen,
 * instead of wrapping onto several lines. The current tab is marked with aria-current.
 */
export function TabNav({ label, items, current, className }: { label: string; items: TabItem[]; current: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("-mt-2 flex gap-6 overflow-x-auto border-b", className)}>
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
