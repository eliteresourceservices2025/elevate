import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WORKSHEET_LABELS as L } from "../constants";
import type { Worksheet } from "../runs";

// Peso and dollar totals for the whole run, and FTE, client hours and net pay for each client. Withheld when any line can't be read.

export function RunTotals({ sheet }: { sheet: Worksheet }) {
  if (!sheet.totals || !sheet.byClient) return null;
  const t = sheet.totals;
  return (
    <section aria-labelledby="run-totals" className="space-y-3">
      <h2 id="run-totals" className="text-lg font-semibold">
        {L.totals}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [`${L.gross} (pesos)`, t.gross],
          [L.dollarTotal, t.dollarAllowance],
          [`${L.dollarAllowancePesos} (pesos)`, t.dollarAllowancePesos],
          [`${L.net} (pesos)`, t.net],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{L.byClient}</TableHead>
            <TableHead className="text-right">{L.lines}</TableHead>
            <TableHead className="text-right">{L.fte}</TableHead>
            <TableHead className="text-right">{L.clientHours}</TableHead>
            <TableHead className="text-right">{L.net}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sheet.byClient.map((c) => (
            <TableRow key={c.clientId ?? "none"}>
              <TableCell label={L.client} className="font-medium">
                {c.clientName}
              </TableCell>
              <TableCell label={L.lines} className="text-right tabular-nums">
                {c.lines}
              </TableCell>
              <TableCell label={L.fte} className="text-right tabular-nums">
                {c.fte}
              </TableCell>
              <TableCell label={L.clientHours} className="text-right tabular-nums">
                {c.clientHours}
              </TableCell>
              <TableCell label={L.net} className="text-right tabular-nums">
                {c.net}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
