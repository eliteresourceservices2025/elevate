"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { discardScheduleImport } from "../actions";
import type { Plan, PlanRow } from "../plan";

type Tab = "update" | "unchanged" | "decisions" | "gone";

const ASSIGNMENT: Record<PlanRow["assignment"], string> = { add: "Add the client", keep: "Keep the client", change_client: "Change client" };
const SCHEDULE: Record<PlanRow["schedule"], string> = { add: "Add the schedule", same: "Same schedule", change: "Change the schedule" };

/** The read-only preview of an attendance sheet: what each person would get, and what needs a person's decision. */
export function PlanView({ batchId, plan }: { batchId: string; plan: Plan }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(plan.totals.update > 0 ? "update" : plan.totals.needsDecision > 0 ? "decisions" : "unchanged");
  const [pending, setPending] = useState(false);

  const rows = plan.rows.filter((r) => (tab === "update" ? r.status === "update" : tab === "unchanged" ? r.status === "unchanged" : false));
  // One pager per list (hooks cannot be conditional); the current tab decides which one is shown.
  const pagedRows = usePaged(rows, tab);
  const pagedDecisions = usePaged(plan.decisions, tab);
  const pagedGone = usePaged(plan.notOnSheet, tab);
  const paged = tab === "decisions" ? pagedDecisions : tab === "gone" ? pagedGone : pagedRows;

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "update", label: "Would change", n: plan.totals.update },
    { id: "unchanged", label: "Already matches", n: plan.totals.unchanged },
    { id: "decisions", label: "Needs a person", n: plan.totals.needsDecision },
    { id: "gone", label: "On a client but not on the sheet", n: plan.totals.notOnSheet },
  ];

  async function discard() {
    if (!window.confirm("Discard this upload? Its rows are deleted.")) return;
    setPending(true);
    try {
      const r = await discardScheduleImport({ batchId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Discarded.");
      router.push("/settings/import-schedules");
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <p role="note" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        This is a <strong>preview</strong>. Nothing has been changed in ELEVATE. Unpaid breaks are <strong>assumed</strong> from the shift length and hours per week
        are <strong>estimated</strong> from the schedule: the sheet does not say. Worked hours are never read from the sheet.
      </p>

      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Show">
        {tabs.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "true" : undefined} className="rounded-full border px-3 py-1 hover:bg-secondary/50 aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground">
              {t.label}: {t.n}
            </button>
          </li>
        ))}
      </ul>
      {plan.totals.backdated > 0 ? (
        <p className="text-sm text-muted-foreground">
          {plan.totals.backdated} {plan.totals.backdated === 1 ? "person starts" : "people start"} more than 7 days back. The ordinary screens refuse that; applying it will need
          the impact review (a later phase).
        </p>
      ) : null}

      {tab === "decisions" ? (
        plan.decisions.length === 0 ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">Everyone on the sheet could be matched.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>On the sheet</TableHead>
                <TableHead>Client on the sheet</TableHead>
                <TableHead>Why a person has to decide</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedDecisions.rows.map((d) => (
                <TableRow key={d.key}>
                  <TableCell className="font-medium">{d.sheetName}</TableCell>
                  <TableCell>{d.sheetClient}</TableCell>
                  <TableCell>{d.reasons.join(" ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : tab === "gone" ? (
        plan.notOnSheet.length === 0 ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">Everyone currently on these clients is on the sheet.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Currently assigned to a client that is on the sheet, but not on the sheet. They may have left or moved. Nothing is ended automatically.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Assigned since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedGone.rows.map((g, i) => (
                  <TableRow key={`${g.personName}-${g.clientName}-${i}`}>
                    <TableCell className="font-medium">{g.personName}</TableCell>
                    <TableCell>{g.clientName}</TableCell>
                    <TableCell>{g.assignmentStart}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Proposed shift</TableHead>
              <TableHead>Break (assumed)</TableHead>
              <TableHead>Hours per week (estimate)</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Now in ELEVATE</TableHead>
              <TableHead>What happens</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">
                  {r.personName}
                  {r.sheetName !== r.personName ? <span className="block text-xs text-muted-foreground">sheet: {r.sheetName}</span> : null}
                </TableCell>
                <TableCell>{r.clientName}</TableCell>
                <TableCell>
                  {r.startTime}–{r.endTime}
                  <span className="block text-xs text-muted-foreground">
                    {r.zone}, {r.weekdayLabel}
                  </span>
                </TableCell>
                <TableCell>{r.breakMinutes} min</TableCell>
                <TableCell>{r.hoursPerWeek}</TableCell>
                <TableCell>
                  {r.firstDay}
                  {r.backdated ? <Badge variant="outline" className="ml-1">backdated</Badge> : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.current.clientName ? `${r.current.clientName}${r.current.assignmentHours !== null ? `, ${r.current.assignmentHours} h/week` : ""}` : "No client"}
                  <br />
                  {r.current.shift ?? "No schedule"}
                </TableCell>
                <TableCell className="text-xs">
                  {ASSIGNMENT[r.assignment]}; {SCHEDULE[r.schedule]}
                  {r.hoursNote === "fill" ? "; fill hours per week" : r.hoursNote === "differs" ? "; hours differ" : ""}
                  {r.attention.map((a) => (
                    <span key={a} className="mt-1 block text-amber-700 dark:text-amber-400">
                      {a}
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="rows" />

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button variant="outline" onClick={discard} disabled={pending}>
          Discard this upload
        </Button>
        <span className="text-xs text-muted-foreground">Applying the changes comes in the next phase.</span>
      </div>
    </div>
  );
}
