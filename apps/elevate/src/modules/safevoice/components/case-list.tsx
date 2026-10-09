import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, OUTCOME_LABELS, STATUS_LABELS, caseReference } from "../constants";
import type { CaseFilter, CaseRow } from "../queries";
import type { PublishedStats } from "../stats";
import type { PageInfo } from "@/lib/pagination";

const FILTER_LABELS: Record<CaseFilter, string> = { open: "Open", new: "New", in_review: "In review", awaiting_reporter: "Waiting for reporter", closed: "Closed", all: "All" };

export function CaseFilters({ current }: { current: CaseFilter }) {
  return (
    <nav aria-label="Filter cases" className="flex flex-wrap gap-2 text-sm">
      {(Object.keys(FILTER_LABELS) as CaseFilter[]).map((f) => (
        <Link key={f} href={f === "open" ? "/safe-voice-cases" : `/safe-voice-cases?status=${f}`} aria-current={f === current ? "true" : undefined} className={cn("rounded-full border px-3 py-1", f === current ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary/50")}>
          {/* eslint-disable-next-line security/detect-object-injection -- `f` is from the fixed filter list */}
          {FILTER_LABELS[f]}
        </Link>
      ))}
    </nav>
  );
}

export function CaseList({ rows, info, filter }: { rows: CaseRow[]; info: PageInfo; filter: CaseFilter }) {
  if (info.total === 0) return <p className="text-sm text-muted-foreground">No cases here.</p>;
  return (
    <div className="space-y-2">
      <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Last activity</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/safe-voice-cases/${r.id}`} className="font-mono font-medium text-primary underline-offset-2 hover:underline">
                    {caseReference(r.id)}
                  </Link>
                </TableCell>
                <TableCell>{CATEGORY_LABELS[r.category]}</TableCell>
                <TableCell>{r.createdDay}</TableCell>
                <TableCell>{r.lastActivityDay}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "closed" ? "outline" : "secondary"}>{r.status === "closed" && r.outcome ? `Closed: ${OUTCOME_LABELS[r.outcome]}` : STATUS_LABELS[r.status]}</Badge>
                  {r.needsReply ? <Badge variant="destructive" className="ml-2">Needs a reply</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PagerLinks info={info} basePath="/safe-voice-cases" query={{ status: filter === "open" ? undefined : filter }} label="cases" />
    </div>
  );
}

export function StatsCard({ stats }: { stats: PublishedStats }) {
  return (
    <section aria-label="Counts by category" className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">Reports by category</h2>
      {stats.rows.length === 0 && stats.otherCategories === null ? (
        <p className="text-sm text-muted-foreground">No category has enough reports to show yet.</p>
      ) : (
        <ul className="divide-y text-sm">
          {stats.rows.map((r) => (
            <li key={r.category} className="flex justify-between py-1.5">
              <span>{r.label}</span>
              <span className="font-medium tabular-nums">{r.count}</span>
            </li>
          ))}
          {stats.otherCategories !== null ? (
            <li className="flex justify-between py-1.5">
              <span>Other categories (each with fewer than 5)</span>
              <span className="font-medium tabular-nums">{stats.otherCategories}</span>
            </li>
          ) : null}
          {stats.total !== null ? (
            <li className="flex justify-between py-1.5 font-semibold">
              <span>All reports</span>
              <span className="tabular-nums">{stats.total}</span>
            </li>
          ) : null}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Counts only. Categories with fewer than 5 reports are not shown, so a small group cannot point to one person.</p>
    </section>
  );
}
