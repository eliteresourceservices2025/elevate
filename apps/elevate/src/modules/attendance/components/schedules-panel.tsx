"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TextField } from "@/components/form-fields";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientPager, usePaged } from "@/components/client-pager";
import { formatDateOnly } from "@/lib/time";
import { setDailyCaps } from "@/modules/org/actions";
import { endSchedules, setDayHours } from "../schedule-actions";
import { AddScheduleForm, useRun, type RunFn } from "./schedule-forms";
import { ScheduleChips } from "./schedule-chips";
import type { ScheduleClient, ScheduleListRow } from "../queries";

type ScheduleListClients = ScheduleClient[];

const isCurrent = (r: ScheduleListRow) => r.entries.some((e) => e.status === "current");
const isUpcoming = (r: ScheduleListRow) => r.entries.some((e) => e.status === "upcoming");

/** For contractors with no fixed schedule: their usual hours per day, and hours for specific days when a day differs. */
function HoursPerDayForm({ picked, today, run, pending, onDone }: { picked: string[]; today: string; run: RunFn; pending: boolean; onDone: () => void }) {
  const dialog = useFormDialog();
  const [usual, setUsual] = useState("");
  const [rows, setRows] = useState<{ date: string; hours: string }[]>([{ date: today, hours: "" }]);
  const people = `${picked.length} ${picked.length === 1 ? "person" : "people"}`;
  const filled = rows.filter((r) => r.date !== "");
  const bad = filled.some((r) => r.hours.trim() !== "" && !(Number(r.hours) >= 0.25 && Number(r.hours) <= 16)) || (usual.trim() !== "" && !(Number(usual) >= 0.25 && Number(usual) <= 16));
  const nothing = usual.trim() === "" && filled.length === 0;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            if (usual.trim() !== "") {
              const r = await setDailyCaps({ employeeIds: picked, minutes: Math.round(Number(usual) * 60) });
              if (!r.ok) return r;
            }
            if (filled.length > 0) {
              const r = await setDayHours({ employeeIds: picked, days: filled.map((d) => ({ date: d.date, minutes: d.hours.trim() === "" ? null : Math.round(Number(d.hours) * 60) })) });
              if (!r.ok) return r;
            }
            return { ok: true };
          },
          `Hours saved for ${people}.`,
          () => {
            onDone();
            dialog?.close(true);
          },
        );
      }}
    >
      <p className="rounded-lg border bg-muted/40 p-3 text-sm">
        For contractors with no fixed schedule. The clock warns them and stops after these hours, and the extra hours prompt follows them. Anyone who has a fixed schedule follows the schedule instead, so end it first.
      </p>
      <TextField id="hp-usual" label="Usual hours per day" type="number" min="0.25" max="16" step="0.25" value={usual} onChange={(e) => setUsual(e.target.value)} hint="Used on every day that has no hours of its own. Leave empty to keep what is set now." />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Hours for specific days (optional)</legend>
        <p className="text-xs text-muted-foreground">For a day that is different, such as 4 hours today and 6 tomorrow. Leave the hours empty to go back to the usual hours for that day.</p>
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <TextField id={`hp-date-${i}`} label="Day" type="date" value={r.date} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
            <TextField id={`hp-hours-${i}`} label="Hours" type="number" min="0.25" max="16" step="0.25" value={r.hours} onChange={(e) => setRows((all) => all.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove day ${i + 1}`} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={rows.length >= 31} onClick={() => setRows((all) => [...all, { date: "", hours: "" }])}>
          Add a day
        </Button>
      </fieldset>
      <Button type="submit" disabled={pending || picked.length === 0 || nothing || bad}>
        Save hours for {people}
      </Button>
    </form>
  );
}

/** Set a schedule: shift patterns, or just hours per day for a contractor with no fixed schedule. */
function SetScheduleForm({ picked, today, clients, run, pending, onDone }: { picked: string[]; today: string; clients: ScheduleListClients; run: RunFn; pending: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<"fixed" | "hours">("fixed");
  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap gap-4" aria-label="Kind of schedule">
        <label htmlFor="sc-mode-fixed" className="flex items-center gap-2 text-sm">
          <input id="sc-mode-fixed" type="radio" name="sc-mode" className="size-4 accent-primary" checked={mode === "fixed"} onChange={() => setMode("fixed")} />
          Fixed shifts (start and end times)
        </label>
        <label htmlFor="sc-mode-hours" className="flex items-center gap-2 text-sm">
          <input id="sc-mode-hours" type="radio" name="sc-mode" className="size-4 accent-primary" checked={mode === "hours"} onChange={() => setMode("hours")} />
          Hours per day only (no fixed schedule)
        </label>
      </fieldset>
      {mode === "fixed" ? <AddScheduleForm people={picked} today={today} clients={clients} onDone={onDone} /> : <HoursPerDayForm picked={picked} today={today} run={run} pending={pending} onDone={onDone} />}
    </div>
  );
}

/** Ends the current schedule of the people ticked in the list, on a date up to a week back. Their days are rebuilt afterwards. */
function EndSchedulesForm({ picked, today, run, pending, onDone }: { picked: string[]; today: string; run: RunFn; pending: boolean; onDone: () => void }) {
  const dialog = useFormDialog();
  const [endDate, setEndDate] = useState(today);
  const [includeUpcoming, setIncludeUpcoming] = useState(false);
  const earliest = useMemo(() => new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10), [today]);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        let message = "Schedules ended.";
        run(
          async () => {
            const result = await endSchedules({ employeeIds: picked, endDate, includeUpcoming });
            if (result.ok) message = `Ended ${result.data.ended} ${result.data.ended === 1 ? "schedule" : "schedules"}${result.data.skipped > 0 ? `. ${result.data.skipped} had no schedule to end.` : "."}`;
            return result;
          },
          () => message,
          () => {
            onDone();
            dialog?.close(true);
          },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        Anyone clocked in now follows the change as soon as you save. Every current schedule ends after the day you choose. From the next day, ELEVATE no longer uses it to flag late arrivals, absences, early leaves or extra hours. Their days are rebuilt, the history stays recorded, and each person is notified. People with no schedule are skipped. Earlier days keep the schedule they had.
      </p>
      <TextField id="es-date" label="Last day of the schedule" type="date" value={endDate} min={earliest} onChange={(e) => setEndDate(e.target.value)} required hint="Up to 7 days back. Today is the usual choice." />
      <label htmlFor="es-upcoming" className="flex items-center gap-2 text-sm">
        <input id="es-upcoming" type="checkbox" className="size-4 accent-primary" checked={includeUpcoming} onChange={(e) => setIncludeUpcoming(e.target.checked)} />
        Also remove schedules that start after that day
      </label>
      <Button type="submit" variant="destructive" disabled={pending || picked.length === 0 || !endDate}>
        End schedule for {picked.length} {picked.length === 1 ? "person" : "people"}
      </Button>
    </form>
  );
}

/** HR: give people shifts (one at a time or many at once), and see who has none. Times are in the schedule's zone, shown in Manila too. */
export function SchedulesPanel({ rows, withoutSchedule, today, clients }: { rows: ScheduleListRow[]; withoutSchedule: number; today: string; clients: ScheduleListClients }) {
  const { run, pending } = useRun();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"needs" | "current" | "upcoming" | "all">("needs");

  const counts = useMemo(
    () => ({ needs: withoutSchedule, current: rows.filter(isCurrent).length, upcoming: rows.filter(isUpcoming).length, all: rows.length }),
    [rows, withoutSchedule],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesView = view === "all" || (view === "needs" && !isCurrent(r)) || (view === "current" && isCurrent(r)) || (view === "upcoming" && isUpcoming(r));
      return matchesView && (q === "" || r.name.toLowerCase().includes(q) || (r.team ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, view]);

  const paged = usePaged(shown, `${filter}|${view}`);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <section aria-label="Schedules" className="space-y-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Schedule workspace</h2>
              <p className="text-sm text-muted-foreground">Start with people who need a schedule, then review active shifts and planned changes.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-filter" className="text-xs">Find a person or team</Label>
              <Input id="sc-filter" className="h-8 w-56" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
          <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <TabsList className="min-w-max">
                <TabsTrigger value="needs">Needs setup <Badge variant="secondary">{counts.needs}</Badge></TabsTrigger>
                <TabsTrigger value="current">Current <Badge variant="secondary">{counts.current}</Badge></TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming changes <Badge variant="secondary">{counts.upcoming}</Badge></TabsTrigger>
                <TabsTrigger value="all">All people <Badge variant="secondary">{counts.all}</Badge></TabsTrigger>
              </TabsList>
            </div>
          </Tabs>
          {picked.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
              <p className="text-sm font-medium">{picked.size} {picked.size === 1 ? "person" : "people"} selected</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear selection</Button>
                <FormDialog label={`Set schedule for ${picked.size}`} title="Set a schedule" description="Times are in the schedule's time zone. By default the new shifts are added to what each person already has. Anyone clocked in now follows the change as soon as you save." size="xl">
                  <SetScheduleForm picked={[...picked]} today={today} clients={clients} run={run} pending={pending} onDone={() => setPicked(new Set())} />
                </FormDialog>
                <FormDialog label={`End schedule for ${picked.size}`} title="End schedules" description="Ends the current schedule of everyone selected." variant="outline" size="md">
                  <EndSchedulesForm picked={[...picked]} today={today} run={run} pending={pending} onDone={() => setPicked(new Set())} />
                </FormDialog>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">{shown.length === 0 ? "No people match this view." : `Showing ${shown.length} ${view === "needs" ? "people who need a schedule" : "people"}.`}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={shown.length === 0}
              onClick={() => setPicked((p) => (shown.every((r) => p.has(r.employeeId)) ? new Set([...p].filter((id) => !shown.some((r) => r.employeeId === id))) : new Set([...p, ...shown.map((r) => r.employeeId)])))}
            >
              {shown.length > 0 && shown.every((r) => picked.has(r.employeeId)) ? `Unselect all ${shown.length} shown` : `Select all ${shown.length} shown`}
            </Button>
          </div>
        </div>
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>This week</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell data-select="">
                    <input type="checkbox" aria-label={`Select ${r.name}`} className="size-4 accent-primary" checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/schedules/${r.employeeId}`} className="text-primary underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell label="Team">{r.team ?? "No team"}</TableCell>
                  <TableCell label="This week">
                    {r.entries.length > 0 ? (
                      <ScheduleChips chips={r.chips} nextChange={r.nextChange} />
                    ) : (
                      <>
                        <Badge variant="outline">No schedule</Badge>
                        <span className="block text-xs text-muted-foreground">{r.dailyCapMinutes ? `Daily hours: ${r.dailyCapMinutes / 60} h` : "No daily hours set: company default"}</span>
                        {r.dayHours.length > 0 ? <span className="block text-xs text-muted-foreground">Coming up: {r.dayHours.map((d) => `${formatDateOnly(d.date)} ${d.minutes / 60} h`).join(", ")}</span> : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell label="" className="text-right">
                    {!isCurrent(r) ? (
                      <FormDialog
                        label="Set schedule"
                        title={`Set a schedule for ${r.name}`}
                        description="Times are in the schedule's time zone. This person's attendance checks start from the effective date you choose."
                        variant="outline"
                        triggerSize="sm"
                        size="xl"
                      >
                        <SetScheduleForm picked={[r.employeeId]} today={today} clients={clients} run={run} pending={pending} onDone={() => setPicked(new Set())} />
                      </FormDialog>
                    ) : (
                      <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/schedules/${r.employeeId}`} />}>
                        Manage
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ClientPager info={paged.info} onPage={paged.setPage} onSize={paged.setPageSize} label="people" />
      </section>
    </div>
  );
}
