import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { TrainingRowActions } from "@/modules/learn/components/training-actions";
import { listTrainingStatus } from "@/modules/learn/queries";

export const metadata: Metadata = { title: "Training status" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const TRACK: Record<string, string> = { full: "Full", essentials: "Essentials", refresher: "Refresher" };

export default async function TrainingPage({ searchParams }: PageProps<"/training">) {
  const params = await searchParams;
  const filters = { state: one(params.state), q: one(params.q) };
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const { rows, counts, info, canSeeResults, canManage } = await orNotFound(listTrainingStatus(filters, paging));

  const chips: { label: string; state?: string; n: number }[] = [
    { label: "Everyone", n: counts.people },
    { label: "Overdue", state: "overdue", n: counts.overdue },
    { label: "Not yet", state: "open", n: counts.open + counts.overdue },
    { label: "Passed", state: "passed", n: counts.passed },
    { label: "Not assigned", state: "none", n: counts.none },
  ];

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Training status</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          HIPAA training for each person: passed, not yet, or overdue. {canSeeResults ? "As HR you also see tries and the latest score." : "Scores stay with the person and HR."}
        </p>
      </div>

      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        {chips.map((c) => (
          <li key={c.label}>
            <Link href={c.state ? `/training?state=${c.state}` : "/training"} aria-current={filters.state === c.state ? "true" : undefined} className="rounded-full border px-3 py-1 hover:bg-secondary/50 aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground">
              {c.label}: {c.n}
            </Link>
          </li>
        ))}
      </ul>

      <form method="get" action="/training" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" aria-label="Search the list">
        <div className="space-y-1">
          <Label htmlFor="t-q">Search</Label>
          <Input id="t-q" name="q" defaultValue={filters.q ?? ""} placeholder="Name or team" className="w-60" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-state">Status</Label>
          <NativeSelect id="t-state" name="state" defaultValue={filters.state ?? ""}>
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
            <option value="open">Not yet</option>
            <option value="passed">Passed</option>
            <option value="none">Not assigned</option>
          </NativeSelect>
        </div>
        <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-secondary/50">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">No one matches. {counts.people === 0 ? "Training is shown for people with an ELEVATE account." : ""}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Track</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Certificate until</TableHead>
              {canSeeResults ? <TableHead>Tries</TableHead> : null}
              {canSeeResults ? <TableHead>Latest score</TableHead> : null}
              {canManage ? <TableHead>Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.team ?? "-"}</TableCell>
                <TableCell>{r.track ? TRACK[r.track] ?? r.track : "-"}</TableCell>
                <TableCell>
                  <span className={r.state === "overdue" ? "font-medium text-destructive" : r.state === "passed" ? "font-medium" : undefined}>{r.label}</span>
                </TableCell>
                <TableCell>{r.dueText ? `${r.dueOn} (${r.dueText})` : "-"}</TableCell>
                <TableCell>{r.certificateEndsOn ?? "-"}</TableCell>
                {canSeeResults ? <TableCell>{r.attempts ?? "-"}</TableCell> : null}
                {canSeeResults ? <TableCell>{r.lastScore === null ? "-" : `${r.lastScore}%`}</TableCell> : null}
                {canManage ? (
                  <TableCell>
                    <TrainingRowActions userId={r.userId} assignmentId={r.state === "open" || r.state === "overdue" ? r.assignmentId : null} canAssign={canManage} canGrant={canManage} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PagerLinks info={info} basePath="/training" query={{ state: filters.state, q: filters.q }} label="people" />
    </div>
  );
}
