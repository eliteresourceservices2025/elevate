"use client"

import * as React from "react"
import { useDragScroll } from "@/components/use-drag-scroll"
import { cn } from "@/lib/utils"

/**
 * A table wider than its box scrolls sideways inside this container, with edge shadows that show there is more to see
 * (see .scroll-shadow-x). The shadows fade into the colour of whatever the table sits on: a card by default; for a table that
 * sits straight on the page pass containerClassName="[--shadow-cover:var(--background)]".
 * `stack` turns each row into a card below the tablet width (the first cell is the card title, every other cell shows its `label`),
 * for a list people work through on a phone. Keep a plain scrolling table for a dense comparison.
 * Inside #main every table gets the tinted header and striped rows from globals.css; `plain` opts this table out (data-plain).
 * `stickyHeader` keeps the header row in view while the page scrolls, from the xl width up: there the box clips instead of scrolling sideways (a
 * scroll box would stop `position: sticky`), so use it only on a table that fits a wide laptop. Below xl it scrolls sideways as usual (cards on a phone).
 * `dragScroll` lets a mouse user grab the table and drag it sideways (see useDragScroll); the box then takes keyboard focus so the arrow
 * keys scroll it too, and `scrollLabel` names it for a screen reader. Use it on a wide table people read across, like the pay run sheet.
 */
function Table({ className, containerClassName, plain = false, stack = false, stickyHeader = false, dragScroll = false, scrollLabel, ...props }: React.ComponentProps<"table"> & { containerClassName?: string; plain?: boolean; stack?: boolean; stickyHeader?: boolean; dragScroll?: boolean; scrollLabel?: string }) {
  const box = useDragScroll<HTMLDivElement>(dragScroll)
  return (
    <div
      ref={box}
      data-slot="table-container"
      {...(dragScroll ? { role: "region", "aria-label": scrollLabel ?? "Scrollable table" } : {})}
      className={cn(
        "scroll-shadow-x relative w-full rounded-xl border bg-card shadow-sm in-[.scroll-shadow-x]:rounded-none in-[.scroll-shadow-x]:border-0 in-[.scroll-shadow-x]:shadow-none",
        stickyHeader ? "overflow-x-auto xl:overflow-x-clip" : "overflow-x-auto",
        dragScroll && "outline-none focus-visible:ring-2 focus-visible:ring-ring data-scrollable:cursor-grab data-dragging:cursor-grabbing data-dragging:select-none",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        data-plain={plain ? "" : undefined}
        data-stack={stack ? "" : undefined}
        className={cn("w-full caption-bottom text-sm", stickyHeader && "xl:[&_thead_th]:sticky xl:[&_thead_th]:top-0 xl:[&_thead_th]:z-10 xl:[&_thead_th]:bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))]", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, label, ...props }: React.ComponentProps<"td"> & { label?: string }) {
  return (
    <td
      data-slot="table-cell"
      data-label={label}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
