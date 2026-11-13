import { Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/status-chip";
import { cn } from "@/lib/utils";
import { formatDollars } from "../calc";
import type { InvoiceShow } from "../list-options";
import type { InvoiceState } from "../service";

// The tiles, the search and filter chips, and the status chips of the invoices list. Server components: the search is a plain GET form.

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg bg-muted/60 p-2.5 sm:p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{value}</p>
      <p className="hidden text-xs text-muted-foreground sm:block">{note}</p>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "November 2026" from "2026-11". */
export const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export function InvoiceSummaryTiles({ billedCents, month, issuedCount, liveCount, hiddenCount }: { billedCents: bigint; month: string; issuedCount: number; liveCount: number; hiddenCount: number }) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Invoice summary">
      <Tile label={`Billed in ${monthLabel(month).split(" ")[0]}`} value={`$${formatDollars(billedCents)}`} note={plural(issuedCount, "live invoice issued", "live invoices issued")} />
      <Tile label="Live invoices" value={String(liveCount)} note="Not void, replaced or archived" />
      <Tile label="Kept out of the list" value={String(hiddenCount)} note="Void, replaced or archived" />
    </div>
  );
}

const CHIP = "inline-flex h-8 items-center rounded-full px-3 text-sm font-medium transition-colors pointer-coarse:h-11";

export function InvoiceFilters({ show, q }: { show: InvoiceShow; q: string }) {
  const items: { show: InvoiceShow; label: string }[] = [
    { show: "live", label: "Live" },
    { show: "all", label: "All" },
    { show: "test", label: "Test" },
  ];
  const href = (s: InvoiceShow) => {
    const query = new URLSearchParams();
    if (s !== "live") query.set("show", s);
    if (q) query.set("q", q);
    const text = query.toString();
    return text ? `/invoices?${text}` : "/invoices";
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action="/invoices" method="get" role="search" className="flex min-w-60 flex-1 items-center gap-2 sm:max-w-sm">
        {show !== "live" ? <input type="hidden" name="show" value={show} /> : null}
        <label className="sr-only" htmlFor="invoice-search">
          Search invoices by number or client
        </label>
        <Input id="invoice-search" name="q" defaultValue={q} placeholder="Number or client" maxLength={80} className="h-(--control-h)" />
        <Button type="submit" variant="outline" className="h-(--control-h)">
          <Search className="size-4" aria-hidden />
          Search
        </Button>
      </form>
      <nav aria-label="Filter invoices" className="flex items-center gap-2">
        {items.map((i) => (
          <Link key={i.show} href={href(i.show)} aria-current={show === i.show ? "page" : undefined} className={cn(CHIP, show === i.show ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** The state of an invoice in the one status look; a live real invoice shows nothing. */
export function InvoiceStateChips({ state, isTest }: { state: InvoiceState; isTest: boolean }) {
  return (
    <>
      {isTest ? <StatusChip tone="warning">Test</StatusChip> : null}
      {state === "voided" ? <StatusChip tone="danger">Void</StatusChip> : null}
      {state === "superseded" ? <StatusChip tone="neutral">Replaced</StatusChip> : null}
      {state === "archived" ? <StatusChip tone="neutral">Archived</StatusChip> : null}
    </>
  );
}
