import { FieldHint } from "@/components/field-hint";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WORKSHEET_LABELS as L } from "../constants";
import { PAYROLL_HINTS } from "../hints";
import type { Worksheet } from "../runs";

// Peso totals for the whole run, and client hours and total payable compensation for each client. Withheld when any line can't be read.

export function RunTotals({ sheet }: { sheet: Worksheet }) {
  if (!sheet.totals || !sheet.byClient) return null;
  const t = sheet.totals;
  return (
    <section aria-labelledby="run-totals" className="space-y-3">
      <h2 id="run-totals" className="text-lg font-semibold">
        {L.totals}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {/* Gross is not what is paid: Total payable compensation is. The explanation sits beside each name, and the one to pay from is marked. */}
        <div className="rounded-xl border bg-card p-3">
          <dt className="flex items-center gap-1 text-xs text-muted-foreground">
            {L.grossTotal}
            <FieldHint label={L.grossTotal}>{PAYROLL_HINTS.grossPay}</FieldHint>
          </dt>
          <dd className="text-xl font-semibold tabular-nums">{t.gross}</dd>
          <p className="text-xs text-muted-foreground">{L.grossNote}</p>
        </div>
        <div className="rounded-xl border-2 border-primary bg-primary/5 p-3">
          <dt className="flex items-center gap-1 text-xs font-medium text-foreground">
            {L.netTotal}
            <FieldHint label={L.netTotal}>{PAYROLL_HINTS.totalPayable}</FieldHint>
            <Badge className="ml-auto">{L.payThis}</Badge>
          </dt>
          <dd className="text-xl font-semibold tabular-nums">{t.net}</dd>
        </div>
        <div className="rounded-xl border bg-card p-3">
          <dt className="text-xs text-muted-foreground">{L.fteTotal}</dt>
          <dd className="text-xl font-semibold tabular-nums">{t.fte}</dd>
        </div>
      </dl>
      <Table stack>
        <TableHeader>
          <TableRow>
            <TableHead>{L.byClient}</TableHead>
            <TableHead className="text-right">{L.lines}</TableHead>
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
