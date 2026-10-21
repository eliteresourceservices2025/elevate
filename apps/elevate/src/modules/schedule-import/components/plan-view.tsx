"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toCsv } from "@/lib/csv";
import { ClientPager, usePaged } from "@/components/client-pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applyScheduleImport, discardScheduleImport, rememberScheduleImportMatch, type ApplyOutcome } from "../actions";
import type { Decision, Plan, PlanRow } from "../plan";
import { ImportOutcome, rememberOutcome } from "./import-outcome";

export type Targets = { people: { id: string; label: string }[]; clients: { id: string; label: string }[] };

type Tab = "update" | "unchanged" | "decisions" | "gone";
type Edit = { breakMinutes: string; hoursPerWeek: string };

const ASSIGNMENT: Record<PlanRow["assignment"], string> = { add: "Add the client", keep: "Keep the client", change_client: "End the old client, add this one" };
const SCHEDULE: Record<PlanRow["schedule"], string> = { add: "Add the schedule", same: "Same schedule", change: "Replace the schedule", shared: "Schedule set with the other client row", unset: "Schedule not set: set it on Schedules" };

const today = () => new Date().toISOString().slice(0, 10);

/** The preview of an attendance sheet and the apply step: choose rows, adjust the assumed break and the estimated hours, tick who to end. */
export function PlanView({ batchId, plan, digest, targets }: { batchId: string; plan: Plan; digest: string; targets: Targets | null }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(plan.totals.update > 0 ? "update" : plan.totals.needsDecision > 0 ? "decisions" : "unchanged");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null);

  // Rows that change something start ticked unless they need a look first (an attention note).
  const [picked, setPicked] = useState<Set<string>>(() => new Set(plan.rows.filter((r) => r.status === "update" && r.attention.length === 0).map((r) => r.key)));
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [ending, setEnding] = useState<Set<string>>(new Set());
  const [endDate, setEndDate] = useState(today());
  const [ackBackdated, setAckBackdated] = useState(false);
  // The closest record is pre-selected where there is a clear one; a person still presses the button.
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(plan.decisions.flatMap((d) => (d.suggestion ? [[d.key, d.suggestion.id]] : []))));

  const rows = plan.rows.filter((r) => (tab === "update" ? r.status === "update" : tab === "unchanged" ? r.status === "unchanged" : false));
  const pagedRows = usePaged(rows, tab);
  const pagedDecisions = usePaged(plan.decisions, tab);
  const pagedGone = usePaged(plan.notOnSheet, tab);
  const paged = tab === "decisions" ? pagedDecisions : tab === "gone" ? pagedGone : pagedRows;

  const chosen = useMemo(() => plan.rows.filter((r) => picked.has(r.key)), [plan.rows, picked]);
  const backdatedChosen = chosen.filter((r) => r.backdated);
  const impact = backdatedChosen.reduce(
    (t, r) => ({
      attendanceDays: t.attendanceDays + (r.impact?.attendanceDays ?? 0),
      approvals: t.approvals + (r.impact?.approvals ?? 0),
      leaveRequests: t.leaveRequests + (r.impact?.leaveRequests ?? 0),
      extraHoursRequests: t.extraHoursRequests + (r.impact?.extraHoursRequests ?? 0),
    }),
    { attendanceDays: 0, approvals: 0, leaveRequests: 0, extraHoursRequests: 0 },
  );

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: "update", label: "Would change", n: plan.totals.update },
    { id: "unchanged", label: "Already matches", n: plan.totals.unchanged },
    { id: "decisions", label: "Needs a person", n: plan.totals.needsDecision },
    { id: "gone", label: "On a client but not on the sheet", n: plan.totals.notOnSheet },
  ];

  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleEnd = (id: string) =>
    setEnding((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const edit = (key: string, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [key]: { ...(e[key] ?? { breakMinutes: "", hoursPerWeek: "" }), ...patch } }));

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

  async function remember(d: Decision) {
    const targetId = choice[d.key];
    if (!targetId || d.kind === "other") return;
    setPending(true);
    try {
      const r = await rememberScheduleImportMatch({ kind: d.kind, sheetValue: d.kind === "person" ? d.sheetName : d.sheetClient, targetId });
      if (!r.ok) return void toast.error(r.error);
      toast.success("Matched and remembered for next time.");
      router.refresh();
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setPending(false);
    }
  }

  /** The "needs a person" and "not on the sheet" lists as a CSV, so they can be worked through or sent to whoever knows. */
  function exportList() {
    const csv = toCsv(
      ["List", "On the sheet", "Client", "Detail"],
      [
        ...plan.decisions.map((d) => ["Needs a person", d.sheetName, d.sheetClient, d.reasons.join(" ")]),
        ...plan.notOnSheet.map((g) => ["On a client but not on the sheet", g.personName, g.clientName, `Assigned since ${g.assignmentStart}`]),
      ],
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "schedule-import-to-review.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function apply() {
    const bad = chosen.find((r) => {
      const e = edits[r.key];
      return (e?.breakMinutes !== undefined && e.breakMinutes !== "" && !(Number.isInteger(Number(e.breakMinutes)) && Number(e.breakMinutes) >= 0 && Number(e.breakMinutes) <= 240)) ||
        (e?.hoursPerWeek !== undefined && e.hoursPerWeek !== "" && !(Number(e.hoursPerWeek) > 0 && Number(e.hoursPerWeek) <= 80));
    });
    if (bad) return void toast.error(`Check the break and hours for ${bad.personName}.`);
    const summary = `${chosen.length} ${chosen.length === 1 ? "person" : "people"} will get the shown client and schedule${ending.size ? `, and ${ending.size} assignment${ending.size === 1 ? "" : "s"} will end on ${endDate}` : ""}. Continue?`;
    if (!window.confirm(summary)) return;
    setPending(true);
    try {
      const r = await applyScheduleImport({
        batchId,
        digest,
        accepted: chosen.map((row) => {
          const e = edits[row.key];
          return {
            key: row.key,
            ...(e?.breakMinutes ? { breakMinutes: Number(e.breakMinutes) } : {}),
            ...(e?.hoursPerWeek ? { hoursPerWeek: Number(e.hoursPerWeek) } : {}),
          };
        }),
        endAssignmentIds: [...ending],
        endDate: ending.size ? endDate : null,
        acknowledgeBackdated: ackBackdated,
      });
      if (!r.ok) return void toast.error(r.error);
      rememberOutcome(batchId, r.data);
      setOutcome(r.data);
      toast.success("Applied.");
    } catch {
      toast.error("No connection. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (outcome) return <ImportOutcome outcome={outcome} />;

  const canApply = chosen.length > 0 || ending.size > 0;

  return (
    <div className="space-y-5">
      <p role="note" className="rounded-xl border border-warning/40 bg-warning-surface p-3 text-sm">
        Review before applying. Unpaid breaks are <strong>assumed</strong> from the shift length and hours per week are <strong>estimated</strong> from the schedule: the sheet does
        not say, so change them where you know better. Worked hours are never read from the sheet and clock events are never changed.
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
                <TableHead>Choose the right record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedDecisions.rows.map((d) => (
                <TableRow key={d.key}>
                  <TableCell className="font-medium">{d.sheetName}</TableCell>
                  <TableCell>{d.sheetClient}</TableCell>
                  <TableCell>{d.reasons.join(" ")}</TableCell>
                  <TableCell>
                    {targets && d.kind !== "other" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {d.suggestion ? <span className="w-full text-xs text-muted-foreground">Closest match, selected for you: {d.suggestion.label}. Check it, then confirm.</span> : null}
                        <NativeSelect aria-label={`Choose the ${d.kind} for ${d.kind === "person" ? d.sheetName : d.sheetClient}`} value={choice[d.key] ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [d.key]: e.target.value }))} className="max-w-64">
                          <option value="">Choose a {d.kind}</option>
                          {(d.kind === "person" ? targets.people : targets.clients).map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </NativeSelect>
                        <Button size="sm" variant="outline" disabled={!choice[d.key] || pending} onClick={() => remember(d)}>
                          Match and remember
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Fix on the sheet or in People, then upload again.</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : tab === "gone" ? (
        plan.notOnSheet.length === 0 ? (
          <p className="rounded-xl border p-6 text-sm text-muted-foreground">Everyone currently on these clients is on the sheet.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Currently assigned to a client that is on the sheet, but not on the sheet. They may have left or moved. Tick the ones to end. Nothing is ended unless you tick it.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="end-date" className="font-medium">
                Last day
              </label>
              <Input id="end-date" type="date" max={today()} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 w-40" />
              <span className="text-muted-foreground">{ending.size} ticked</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>End</TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Assigned since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedGone.rows.map((g) => (
                  <TableRow key={g.assignmentId}>
                    <TableCell>
                      <input type="checkbox" aria-label={`End ${g.personName}'s assignment to ${g.clientName}`} className="size-4 accent-primary" checked={ending.has(g.assignmentId)} onChange={() => toggleEnd(g.assignmentId)} />
                    </TableCell>
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
              {tab === "update" ? <TableHead>Apply</TableHead> : null}
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
                {tab === "update" ? (
                  <TableCell>
                    <input type="checkbox" aria-label={`Apply ${r.personName}`} className="size-4 accent-primary" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">
                  {r.personName}
                  {r.sheetName !== r.personName ? <span className="block text-xs text-muted-foreground">sheet: {r.sheetName}</span> : null}
                </TableCell>
                <TableCell>
                  {r.clientName}
                  {r.siblingClientNames.length > 0 ? <span className="block text-xs text-muted-foreground">Also: {r.siblingClientNames.join(", ")}</span> : null}
                </TableCell>
                <TableCell>
                  {r.startTime}–{r.endTime}
                  <span className="block text-xs text-muted-foreground">
                    {r.zone}, {r.weekdayLabel}
                  </span>
                </TableCell>
                <TableCell>
                  {tab === "update" ? (
                    <Input aria-label={`Unpaid break in minutes for ${r.personName}`} inputMode="numeric" className="h-8 w-20" placeholder={String(r.breakMinutes)} value={edits[r.key]?.breakMinutes ?? ""} onChange={(e) => edit(r.key, { breakMinutes: e.target.value })} />
                  ) : (
                    `${r.breakMinutes} min`
                  )}
                </TableCell>
                <TableCell>
                  {tab === "update" ? (
                    <Input aria-label={`Hours per week for ${r.personName}`} inputMode="decimal" className="h-8 w-20" placeholder={String(r.hoursPerWeek)} value={edits[r.key]?.hoursPerWeek ?? ""} onChange={(e) => edit(r.key, { hoursPerWeek: e.target.value })} />
                  ) : (
                    r.hoursPerWeek
                  )}
                </TableCell>
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
                    <span key={a} className="mt-1 block text-warning">
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

      {backdatedChosen.length > 0 ? (
        <section aria-label="Backdated changes" className="space-y-2 rounded-xl border border-warning/40 bg-warning-surface p-4 text-sm">
          <h2 className="font-semibold">{backdatedChosen.length} chosen {backdatedChosen.length === 1 ? "change starts" : "changes start"} more than 7 days back</h2>
          <p>
            From those dates there are already {impact.attendanceDays} attendance days, {impact.approvals} approved hours records, {impact.leaveRequests} leave requests and{" "}
            {impact.extraHoursRequests} extra-hours requests. Attendance days will be recalculated from clock events with the new schedule, so late, absent and extra-hours flags
            may change. A day that was already approved and now differs is marked &ldquo;changed after approval&rdquo; and must be approved again. Exports already made are not
            rewritten.
          </p>
          <label htmlFor="ack-backdated" className="flex items-start gap-2">
            <input id="ack-backdated" type="checkbox" className="mt-0.5 size-4 accent-primary" checked={ackBackdated} onChange={(e) => setAckBackdated(e.target.checked)} />
            <span>I have reviewed this and want to apply the backdated changes.</span>
          </label>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button onClick={apply} disabled={pending || !canApply || (backdatedChosen.length > 0 && !ackBackdated)}>
          Apply {chosen.length} {chosen.length === 1 ? "change" : "changes"}
          {ending.size > 0 ? ` and end ${ending.size}` : ""}
        </Button>
        <Button variant="outline" onClick={discard} disabled={pending}>
          Discard this upload
        </Button>
        {plan.decisions.length + plan.notOnSheet.length > 0 ? (
          <Button variant="outline" onClick={exportList} disabled={pending}>
            Download the lists to review (CSV)
          </Button>
        ) : null}
      </div>
    </div>
  );
}
