import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateOnly } from "@/lib/time";
import { formatDays } from "../ledger";
import type { PersonTimeOff } from "../queries";

const ENTRY_LABELS = {
  award: "Prize awarded",
  usage: "Used",
  reversal: "Returned (request cancelled)",
  adjustment: "Correction",
  expiry: "Expired",
  opening_balance: "Opening balance",
} as const;

/** Balance cards and the full ledger, line by line. */
export function BalanceView({ data, empty }: { data: PersonTimeOff; empty?: string }) {
  return (
    <div className="space-y-6">
      {data.cards.length === 0 || data.lines.length === 0 ? <p className="text-muted-foreground">{empty ?? "No prize days yet."}</p> : null}
      <ul className="grid gap-4 sm:grid-cols-2">
        {data.cards.map((c) => (
          <li key={c.leaveTypeId} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{c.leaveTypeName}</p>
            <p className="text-3xl font-bold" aria-label={`${c.leaveTypeName} balance: ${formatDays(c.balance)}`}>
              {formatDays(c.balance)}
            </p>
            {c.expiring.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-sm">
                {c.expiring.map((e) => (
                  <li key={e.expiresOn} className="text-muted-foreground">
                    <Badge variant="secondary">Expiring</Badge> {formatDays(e.days)} must be used by {formatDateOnly(e.expiresOn)}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>

      <section aria-label="History" className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        {data.lines.length === 0 ? (
          <p className="text-muted-foreground">Nothing yet. Every award, use, correction and expiry appears here.</p>
        ) : (
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>What</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">{formatDateOnly(l.effectiveOn)}</TableCell>
                    <TableCell>
                      {ENTRY_LABELS[l.entryType]}
                      <div className="text-xs text-muted-foreground">
                        {l.leaveTypeName}
                        {l.expiresOn ? ` · use by ${formatDateOnly(l.expiresOn)}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{l.days > 0 ? `+${l.days}` : l.days}</TableCell>
                    <TableCell>{l.reason ?? ""}</TableCell>
                    <TableCell>{l.by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
