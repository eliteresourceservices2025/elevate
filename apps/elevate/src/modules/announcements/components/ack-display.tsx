import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { describeDue, type DueState } from "../due";
import type { PendingItem } from "../queries";
import type { StatusRow } from "../service";

/** Small badge for an item the viewer still has to acknowledge. */
export function DueBadge({ due, dueOn, today }: { due: DueState; dueOn: string | null; today: string }) {
  if (due === "none") return <Badge variant="outline">Acknowledgment needed</Badge>;
  return <Badge variant={due === "overdue" ? "destructive" : "secondary"}>{describeDue(dueOn, today)}</Badge>;
}

export function AckedBadge({ at }: { at: Date }) {
  return (
    <Badge variant="outline" className="gap-1">
      <CheckCircle2 className="size-3" aria-hidden />
      Acknowledged {formatInZone(at, DEFAULT_TIMEZONE, "MMM d")}
    </Badge>
  );
}

/** Banner at the top of every page while something is waiting. It never blocks: it only points. */
export function AckBanner({ items, today }: { items: PendingItem[]; today: string }) {
  if (items.length === 0) return null;
  const overdue = items.some((i) => i.due === "overdue");
  const shown = items.slice(0, 3);
  return (
    <div
      role="region"
      aria-label="Acknowledgments needed"
      className={`border-b px-4 py-2 text-sm sm:px-6 ${overdue ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="size-4" aria-hidden />
          {items.length === 1 ? "1 item needs your acknowledgment" : `${items.length} items need your acknowledgment`}
        </span>
        <ul className="flex flex-wrap gap-x-3">
          {shown.map((i) => (
            <li key={`${i.kind}-${i.versionId ?? i.id}`}>
              <Link href={i.link} className="underline underline-offset-4">
                {i.title}
              </Link>
              {i.dueOn ? <span className="ml-1 text-xs">({describeDue(i.dueOn, today)})</span> : null}
            </li>
          ))}
          {items.length > shown.length ? (
            <li>
              <Link href="/announcements" className="underline underline-offset-4">
                and {items.length - shown.length} more
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/** Who acknowledged and who has not. Not-yet people come first so HR sees who to follow up with. */
export function StatusTable({ rows }: { rows: StatusRow[] }) {
  const done = rows.filter((r) => r.acknowledgedAt).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{done}</span> of {rows.length} acknowledged
        {rows.some((r) => !r.hasAccount && !r.acknowledgedAt) ? ". People without an ELEVATE account yet are marked and cannot acknowledge until they sign in." : "."}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nobody is expected to acknowledge this yet.</p>
      ) : (
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <Link href={`/people/${r.employeeId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.name}
                    </Link>{" "}
                    <span className="text-muted-foreground">{r.employeeNumber}</span>
                  </TableCell>
                  <TableCell>{r.team ?? "No team"}</TableCell>
                  <TableCell>
                    {r.acknowledgedAt ? (
                      <AckedBadge at={r.acknowledgedAt} />
                    ) : r.hasAccount ? (
                      <Badge variant="secondary">Not acknowledged</Badge>
                    ) : (
                      <Badge variant="outline">Not acknowledged (no account yet)</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
