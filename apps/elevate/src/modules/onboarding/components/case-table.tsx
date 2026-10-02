import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { paginate } from "@/lib/pagination";
import { formatDateOnly } from "@/lib/time";
import { LEAVING_LABELS, type LeavingReason } from "../constants";
import type { CaseRow, MyTask } from "../queries";

const STATUS: Record<string, string> = { open: "In progress", completed: "Completed", cancelled: "Cancelled" };

/** A paged list of cases with their progress. `paging` carries the address values for this list. */
export function CaseTable({ rows, kind, page, pageSize, basePath }: { rows: CaseRow[]; kind: "onboarding" | "offboarding"; page: number; pageSize: number; basePath: string }) {
  const { rows: shown, info } = paginate(rows, page, pageSize);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>{kind === "onboarding" ? "Start date" : "Last working day"}</TableHead>
              {kind === "offboarding" ? <TableHead>Reason</TableHead> : null}
              <TableHead>Progress</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/${kind}/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {r.name}
                  </Link>
                  {r.position ? <p className="text-xs text-muted-foreground">{r.position}</p> : null}
                </TableCell>
                <TableCell>{formatDateOnly(r.date)}</TableCell>
                {kind === "offboarding" ? <TableCell>{r.reason ? LEAVING_LABELS[r.reason as LeavingReason] : ""}</TableCell> : null}
                <TableCell>
                  {r.done} of {r.total} done
                  {r.overdue > 0 && r.status === "open" ? <Badge variant="destructive" className="ml-2">{r.overdue} late</Badge> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={r.status === "open" ? "secondary" : "outline"}>{STATUS[r.status] ?? r.status}</Badge>
                  {r.accessRemoved && r.status === "open" ? <span className="ml-2 text-xs text-muted-foreground">Access removed</span> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PagerLinks info={info} basePath={basePath} label="cases" />
    </div>
  );
}

export function MyTasks({ tasks }: { tasks: MyTask[] }) {
  if (tasks.length === 0) return null;
  return (
    <section aria-label="My tasks" className="space-y-2">
      <h2 className="text-lg font-semibold">Your tasks</h2>
      <ul className="divide-y rounded-xl border bg-card">
        {tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <Link href={`/${t.kind}/${t.caseId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {t.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                Due {formatDateOnly(t.dueOn)} {t.overdue ? <Badge variant="destructive">Late</Badge> : null}
              </p>
            </div>
            {t.href ? (
              <Link href={t.href} className="text-sm text-primary underline-offset-2 hover:underline">
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
