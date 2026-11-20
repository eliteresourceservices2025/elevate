import { History } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { HISTORY_LABELS as H } from "../constants";
import type { HistoryRow } from "../history-queries";

// One row per change. Old and new values sit side by side; single facts (reason, note, counts) are listed below them.
// Server component: it only prints what the query already decrypted for this page.

function Details({ row }: { row: HistoryRow }) {
  if (row.unreadable) return <Alert variant="warning" className="rounded-lg p-2 text-sm">{H.unreadableHint}</Alert>;
  if (row.changes.length === 0 && row.facts.length === 0) return <span className="text-muted-foreground">-</span>;
  return (
    <div className="space-y-2">
      {row.changes.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{H.details}</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="pr-3 font-medium">{H.field}</th>
              <th scope="col" className="pr-3 font-medium">{H.before}</th>
              <th scope="col" className="font-medium">{H.after}</th>
            </tr>
          </thead>
          <tbody>
            {row.changes.map((c) => (
              <tr key={c.label} className="align-top">
                <th scope="row" className="pr-3 text-left font-normal">{c.label}</th>
                <td className="pr-3 tabular-nums text-muted-foreground">{c.before ?? H.none}</td>
                <td className="tabular-nums">{c.after ?? H.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {row.facts.length > 0 ? (
        <dl className="space-y-0.5 text-sm">
          {row.facts.map((f) => (
            <div key={f.label} className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{f.label}:</dt>
              <dd className="whitespace-pre-wrap break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  if (rows.length === 0) return <EmptyState icon={History} title={H.emptyTitle} description={H.emptyDescription} />;
  return (
    <Table stack>
      <TableHeader>
        <TableRow>
          <TableHead>{H.what}</TableHead>
          <TableHead>{H.when}</TableHead>
          <TableHead>{H.who}</TableHead>
          <TableHead>{H.person}</TableHead>
          <TableHead>{H.run}</TableHead>
          <TableHead>{H.details}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.actionLabel}</TableCell>
            <TableCell label={H.when} className="whitespace-nowrap">
              <time dateTime={r.at}>{formatInZone(r.at, DEFAULT_TIMEZONE)}</time>
            </TableCell>
            <TableCell label={H.who}>{r.actorName}</TableCell>
            <TableCell label={H.person}>{r.personName ?? "-"}</TableCell>
            <TableCell label={H.run}>
              {r.runId && r.runLabel ? (
                <Link href={`/payroll/${r.runId}`} className="underline underline-offset-2">
                  {r.runLabel}
                </Link>
              ) : (
                "-"
              )}
            </TableCell>
            <TableCell label={H.details} className="min-w-72">
              <Details row={r} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
