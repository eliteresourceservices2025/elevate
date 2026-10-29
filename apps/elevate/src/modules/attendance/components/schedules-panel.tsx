"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { useConfirm } from "@/components/confirm-dialog";
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
import { endSchedule, assignSchedule, correctSchedule } from "../schedule-actions";
import { describeSchedule, WEEKDAYS } from "../schedule";
import type { ScheduleListRow } from "../queries";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Manila", "Europe/London", "Australia/Sydney", "UTC"];

type RunFn = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) => void;

/** The shift form for the people ticked in the list (in a modal, so its fields start fresh each time it opens). */
function SetScheduleForm({ picked, today, run, pending, onDone }: { picked: string[]; today: string; run: RunFn; pending: boolean; onDone: () => void }) {
  const dialog = useFormDialog();
  const [from, setFrom] = useState(today);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [zone, setZone] = useState("");
  const preview = useMemo(
    () =>
      zone
        ? describeSchedule(
            { effectiveFrom: from, effectiveTo: null, startTime: start, endTime: end, weekdays: days, breakMinutes: Number(breakMinutes) || 0, zone },
            from,
          )
        : null,
    [from, start, end, days, breakMinutes, zone],
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => assignSchedule({ employeeIds: picked, effectiveFrom: from, startTime: start, endTime: end, weekdays: days, breakMinutes, zone }),
          `Schedule set for ${picked.length} ${picked.length === 1 ? "person" : "people"}.`,
          () => {
            onDone();
            dialog?.close(true);
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="sc-from" label="Starts on" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        <TextField id="sc-break" label="Unpaid break (minutes)" type="number" min="0" max="240" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} hint="Taken out of the scheduled hours." />
        <TextField id="sc-start" label="Shift starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        <TextField id="sc-end" label="Shift ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required hint="An end before the start means the shift ends the next day." />
      </div>
      <TextField id="sc-zone" label="Time zone" list="sc-zones" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Each person's client zone" />
      <datalist id="sc-zones">
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Working days</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((w) => (
            <label key={w.n} htmlFor={`sc-day-${w.n}`} className="flex items-center gap-1.5 text-sm">
              <input id={`sc-day-${w.n}`} type="checkbox" className="size-4 accent-primary" checked={days.includes(w.n)} onChange={(e) => setDays((d) => (e.target.checked ? [...d, w.n] : d.filter((x) => x !== w.n)))} />
              {w.short}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">The other days are rest days.</p>
      </fieldset>
      <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
        <p className="font-medium">Shift preview</p>
        {preview ? (
          <>
            <p className="mt-1">{preview.days}: {preview.client} ({preview.zone})</p>
            <p className="text-muted-foreground">Manila: {preview.manila}. Unpaid break: {breakMinutes || 0} min.</p>
          </>
        ) : (
          <p className="mt-1 text-muted-foreground">Choose a time zone to confirm the Manila conversion. Leaving it blank uses each person&apos;s client zone.</p>
        )}
      </div>
      <Button type="submit" disabled={pending || picked.length === 0 || days.length === 0}>
        Set schedule for {picked.length} {picked.length === 1 ? "person" : "people"}
      </Button>
    </form>
  );
}

/** HR: give people shifts (one at a time or many at once), and see who has none. Times are in the schedule's zone, shown in Manila too. */
export function SchedulesPanel({ rows, withoutSchedule, today }: { rows: ScheduleListRow[]; withoutSchedule: number; today: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<"needs" | "current" | "upcoming" | "all">("needs");
  // Correcting a recent schedule in place (a mistake), with a reason.
  const [fix, setFix] = useState<ScheduleListRow | null>(null);
  const [fixStart, setFixStart] = useState("09:00");
  const [fixEnd, setFixEnd] = useState("17:00");
  const [fixBreak, setFixBreak] = useState("60");
  const [fixDays, setFixDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [fixZone, setFixZone] = useState("");
  const [fixReason, setFixReason] = useState("");
  const openFix = (r: ScheduleListRow) => {
    if (!r.correctable) return;
    setFix(r);
    setFixStart(r.correctable.startTime);
    setFixEnd(r.correctable.endTime);
    setFixBreak(String(r.correctable.breakMinutes));
    setFixDays(r.correctable.weekdays);
    setFixZone("");
    setFixReason("");
  };

  const counts = useMemo(
    () => ({ needs: withoutSchedule, current: rows.filter((r) => r.current).length, upcoming: rows.filter((r) => r.upcoming).length, all: rows.length }),
    [rows, withoutSchedule],
  );

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesView = view === "all" || (view === "needs" && !r.current) || (view === "current" && Boolean(r.current)) || (view === "upcoming" && Boolean(r.upcoming));
      return matchesView && (q === "" || r.name.toLowerCase().includes(q) || (r.team ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, view]);

  const paged = usePaged(shown, `${filter}|${view}`);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(success);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const askToEnd = async (r: ScheduleListRow) => {
    const proceed = await confirm({
      title: `End ${r.name}'s schedule today?`,
      description: "After today, ELEVATE will no longer use this schedule to flag late arrivals, absences, early leaves, or extra hours. The history stays recorded.",
      confirmLabel: "End schedule today",
      cancelLabel: "Keep schedule",
      destructive: true,
    });
    if (!proceed) return;
    run(() => endSchedule({ employeeId: r.employeeId, endDate: today }), "Schedule ended. The person was notified.");
  };

  return (
    <div className="space-y-6">
      {fix ? (
        <FormDialog
          label="Correct schedule"
          title={`Correct the recent schedule for ${fix.name}`}
          description="Use this only for a recent mistake. Older schedule history is kept; set a new dated schedule instead."
          size="xl"
          open
          onOpenChange={(open) => !open && setFix(null)}
          hideTrigger
        >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => correctSchedule({ employeeId: fix.employeeId, startTime: fixStart, endTime: fixEnd, weekdays: fixDays, breakMinutes: fixBreak, zone: fixZone, reason: fixReason }),
              "Schedule corrected.",
              () => setFix(null),
            );
          }}
        >
          <p className="text-sm text-muted-foreground">
            This rewrites the {fix.correctable && fix.correctable.count > 1 ? `${fix.correctable.count} schedule entries` : "schedule entry"} that started in the last 7 days, keeping their dates. Identical touching entries are joined, and your reason is audited.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField id="fx-start" label="Shift starts" type="time" value={fixStart} onChange={(e) => setFixStart(e.target.value)} required />
            <TextField id="fx-end" label="Shift ends" type="time" value={fixEnd} onChange={(e) => setFixEnd(e.target.value)} required />
            <TextField id="fx-break" label="Unpaid break (minutes)" type="number" min="0" max="240" value={fixBreak} onChange={(e) => setFixBreak(e.target.value)} />
            <TextField id="fx-zone" label="Time zone" list="sc-zones" value={fixZone} onChange={(e) => setFixZone(e.target.value)} placeholder="Keep each entry's zone" />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((w) => (
                <label key={w.n} htmlFor={`fx-day-${w.n}`} className="flex items-center gap-1.5 text-sm">
                  <input id={`fx-day-${w.n}`} type="checkbox" className="size-4 accent-primary" checked={fixDays.includes(w.n)} onChange={(e) => setFixDays((d) => (e.target.checked ? [...d, w.n] : d.filter((x) => x !== w.n)))} />
                  {w.short}
                </label>
              ))}
            </div>
          </fieldset>
          <TextField id="fx-reason" label="Why is this being corrected?" value={fixReason} onChange={(e) => setFixReason(e.target.value)} required maxLength={300} hint="For example: two clients, one shift. No client or patient details." />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || fixDays.length === 0 || fixReason.trim().length < 5}>
              Correct schedule
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFix(null)}>
              Cancel
            </Button>
          </div>
        </form>
        </FormDialog>
      ) : null}

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
                <FormDialog label={`Set schedule for ${picked.size}`} title="Set a schedule" description="Times are in the schedule's time zone. Choosing a new schedule ends an existing schedule the day before, while keeping its history." size="xl">
                  <SetScheduleForm picked={[...picked]} today={today} run={run} pending={pending} onDone={() => setPicked(new Set())} />
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
                <TableHead>Schedule</TableHead>
                <TableHead>In Manila</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell data-select="">
                    <input type="checkbox" aria-label={`Select ${r.name}`} className="size-4 accent-primary" checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} />
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell label="Team">{r.team ?? "No team"}</TableCell>
                  <TableCell label="Schedule">
                    {r.current ? (
                      <span>
                        {r.current.days}, {r.current.client}
                        <span className="block text-xs text-muted-foreground">from {formatDateOnly(r.current.effectiveFrom)}</span>
                      </span>
                    ) : (
                      <Badge variant="outline">No schedule</Badge>
                    )}
                    {r.upcoming ? (
                      <span className="block text-xs text-muted-foreground">
                        Then from {formatDateOnly(r.upcoming.effectiveFrom)}: {r.upcoming.days}, {r.upcoming.client}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell label="In Manila">{r.current?.manila ?? "-"}</TableCell>
                  <TableCell label="" className="flex flex-wrap justify-end gap-1">
                    {!r.current ? (
                      <FormDialog
                        label="Set schedule"
                        title={`Set a schedule for ${r.name}`}
                        description="Times are in the schedule's time zone. This person's attendance checks start from the effective date you choose."
                        variant="outline"
                        triggerSize="sm"
                        size="xl"
                      >
                        <SetScheduleForm picked={[r.employeeId]} today={today} run={run} pending={pending} onDone={() => setPicked(new Set())} />
                      </FormDialog>
                    ) : null}
                    {r.correctable ? (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => openFix(r)}>
                        Correct
                      </Button>
                    ) : null}
                    {r.current ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => void askToEnd(r)}>
                        End today
                      </Button>
                    ) : null}
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
