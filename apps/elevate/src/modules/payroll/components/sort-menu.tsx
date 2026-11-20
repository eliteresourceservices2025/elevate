"use client";

import { ArrowUpDown, Check, ChevronDown, Layers } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// "Sort: Client, then name" with a menu of every way to order the list, and a switch that groups the list by client. Every choice is a
// link to the same page with the sort in the address (?sort=, ?group=client), so it can be shared and survives a refresh.

export type SortOptionLink = { value: string; label: string; href: string; active: boolean };

export function SortMenu({ current, options, groupHref, grouped = false, groupLabel = "Group by client" }: { current: string; options: SortOptionLink[]; groupHref?: string; grouped?: boolean; groupLabel?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {groupHref ? (
      <Link
        href={groupHref}
        scroll={false}
        aria-pressed={grouped}
        className={cn(
          "inline-flex h-(--control-h-sm) items-center gap-1.5 rounded-lg border px-3 text-sm pointer-coarse:h-11",
          grouped ? "border-transparent bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
        )}
      >
        <Layers className="size-4" aria-hidden />
        {groupLabel}
      </Link>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" className="pointer-coarse:h-11" aria-label={`Sort the list. Now: ${current}`} />}>
          <ArrowUpDown className="size-4" aria-hidden />
          Sort: {current}
          <ChevronDown className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {options.map((o) => (
            <DropdownMenuItem key={o.value} render={<Link href={o.href} scroll={false} className="flex w-full items-center gap-2" />} className={o.active ? "font-semibold" : undefined}>
              <span className="flex size-4 shrink-0 items-center justify-center">{o.active ? <Check aria-hidden /> : null}</span>
              {o.label}
            </DropdownMenuItem>
          ))}
          {groupHref ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={groupHref} scroll={false} className="flex w-full items-center gap-2" />}>
                <span className="flex size-4 shrink-0 items-center justify-center">{grouped ? <Check aria-hidden /> : null}</span>
                {groupLabel}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
