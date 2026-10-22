import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatDays } from "../ledger";
import type { PersonTimeOff } from "../queries";
import { CalendarDays } from "lucide-react";

const ENTRY_LABELS = {
  award: "Prize awarded",
  usage: "Used",
  reversal: "Returned (request cancelled)",
  adjustment: "Correction",
  expiry: "Expired",
  opening_balance: "Opening balance",
} as const;

/** Balance cards and the full ledger, line by line (a list; the days column is a plain figure in the same font as the rest). */
export function BalanceView({ data, empty }: { data: PersonTimeOff; empty?: string }) {
  return (
    <div className="space-y-6">
      {data.cards.length === 0 || data.lines.length === 0 ? <EmptyState icon={CalendarDays} title={empty ?? "No prize days yet."} /> : null}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((c) => (
          <li key={c.leaveTypeId} className="rounded-2xl border bg-card p-5 shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none">
            <p className="text-xs font-medium text-muted-foreground">{c.leaveTypeName}</p>
            <p className="mt-1 font-heading text-4xl font-bold tabular-nums" aria-label={`${c.leaveTypeName} balance: ${formatDays(c.balance)}`}>
              {formatDays(c.balance)}
            </p>
            {c.expiring.length > 0 ? (
              <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
                {c.expiring.map((e) => (
                  <li key={e.expiresOn} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <Badge variant="warning">Expiring</Badge>
                    <span>
                      {formatDays(e.days)} must be used by {formatDateOnly(e.expiresOn)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      {data.lines.length > 0 ? (
        <section aria-label="History" className="space-y-3">
          <h2 className="text-lg font-semibold">History</h2>
          <div className="overflow-clip rounded-2xl border bg-card shadow-sm">
            <ul className="divide-y md:hidden">
              {data.lines.map((l) => (
                <li key={l.id} className="space-y-1 px-4 py-3.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{ENTRY_LABELS[l.entryType]}</p>
                    <p className={cn("font-semibold tabular-nums", l.days > 0 ? "text-success" : "text-foreground")}>{l.days > 0 ? `+${l.days}` : l.days}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {l.leaveTypeName}
                    {l.expiresOn ? ` · use by ${formatDateOnly(l.expiresOn)}` : ""}
                  </p>
                  {l.reason ? <p className="text-muted-foreground">{l.reason}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {formatDateOnly(l.effectiveOn)} · {l.by}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table plain containerClassName="rounded-none border-0 shadow-none">
                <TableHeader className="bg-secondary/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Date</TableHead>
                    <TableHead className="px-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">What</TableHead>
                    <TableHead className="px-5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">Days</TableHead>
                    <TableHead className="px-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Why</TableHead>
                    <TableHead className="px-5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="px-5 py-3 whitespace-nowrap">{formatDateOnly(l.effectiveOn)}</TableCell>
                      <TableCell className="px-5 py-3 whitespace-normal">
                        <span className="font-medium">{ENTRY_LABELS[l.entryType]}</span>
                        <span className="block text-xs text-muted-foreground">
                          {l.leaveTypeName}
                          {l.expiresOn ? ` · use by ${formatDateOnly(l.expiresOn)}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className={cn("px-5 py-3 text-right font-semibold tabular-nums", l.days > 0 ? "text-success" : "")}>{l.days > 0 ? `+${l.days}` : l.days}</TableCell>
                      <TableCell className="px-5 py-3 whitespace-normal text-muted-foreground">{l.reason ?? ""}</TableCell>
                      <TableCell className="px-5 py-3 whitespace-normal text-muted-foreground">{l.by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
