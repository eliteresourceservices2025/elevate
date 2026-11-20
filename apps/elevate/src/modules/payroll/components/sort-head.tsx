import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { SortHeader } from "../sort";

// A column title that sorts the sheet when clicked. It is a plain link (the sort is in the address), shows an arrow for the current sort,
// and the cell it sits in carries aria-sort. Clicking the current sort turns it the other way.

export type SortLink = { href: string; state: "up" | "down" | null };
export type SortLinks = Partial<Record<SortHeader, SortLink>>;

export const ariaSortOf = (links: SortLinks | undefined, header: SortHeader): "ascending" | "descending" | undefined => {
  const state = links?.[header]?.state;
  return state === "up" ? "ascending" : state === "down" ? "descending" : undefined;
};

export function SortHead({ header, links, children }: { header: SortHeader; links: SortLinks | undefined; children: ReactNode }) {
  const link = links?.[header];
  if (!link) return <>{children}</>;
  const Icon = link.state === "up" ? ArrowUp : link.state === "down" ? ArrowDown : ArrowUpDown;
  return (
    <Link href={link.href} scroll={false} className="group/sort inline-flex items-center gap-1 rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      {children}
      <Icon className={link.state ? "size-3.5 shrink-0 text-foreground" : "size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover/sort:opacity-100"} aria-hidden />
      <span className="sr-only">{link.state === "up" ? ", sorted up. Click to sort the other way" : link.state === "down" ? ", sorted down. Click to sort the other way" : ". Click to sort by this"}</span>
    </Link>
  );
}
