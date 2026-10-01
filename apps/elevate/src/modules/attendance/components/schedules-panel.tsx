"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClientPager, usePaged } from "@/components/client-pager";
import { formatDateOnly } from "@/lib/time";
import { endSchedule, assignSchedule } from "../schedule-actions";
import { WEEKDAYS } from "../schedule";
import type { ScheduleListRow } from "../queries";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Manila", "Europe/London", "Australia/Sydney", "UTC"];

/** HR: give people shifts (one at a time or many at once), and see who has none. Times are in the schedule's zone, shown in Manila too. */
export function SchedulesPanel({ rows, withoutSchedule, today }: { rows: ScheduleListRow[]; withoutSchedule: number; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [onlyNone, setOnlyNone] = useState(false);
  const [from, setFrom] = useState(today);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [zone, setZone] = useState("");

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => (!onlyNone || !r.current) && (q === "" || r.name.toLowerCase().includes(q) || (r.team ?? "").toLowerCase().includes(q)));
  }, [rows, filter, onlyNone]);

  const paged = usePaged(shown, `${filter}|${onlyNone}`);

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

  return (
    <div className="space-y-6">
      <form
        className="space-y-4 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => assignSchedule({ employeeIds: [...picked], effectiveFrom: from, startTime: start, endTime: end, weekdays: days, breakMinutes, zone }),
            `Schedule set for ${picked.size} ${picked.size === 1 ? "person" : "people"}.`,
            () => setPicked(new Set()),
          );
        }}
      >
        <div>
          <h2 className="text-lg font-semibold">Set a schedule</h2>
          <p className="text-sm text-muted-foreground">
            Pick people in the list below, then set the shift. Times are in the schedule&apos;s time zone (leave it empty to use each person&apos;s client zone), and everyone also sees them in Manila time. A schedule they already have ends the day before.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField id="sc-from" label="Starts on" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          <TextField id="sc-start" label="Shift starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          <TextField id="sc-end" label="Shift ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} required hint="An end before the start means the shift ends the next day." />
          <TextField id="sc-break" label="Unpaid break (minutes)" type="number" min="0" max="240" value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} hint="Taken out of the scheduled hours." />
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
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || picked.size === 0 || days.length === 0}>
            Set schedule for {picked.size} {picked.size === 1 ? "person" : "people"}
          </Button>
          {picked.size > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setPicked(new Set())}>
              Clear selection
            </Button>
          ) : null}
        </div>
      </form>

      <section aria-label="Schedules" className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">
            People <span className="text-sm font-normal text-muted-foreground">({withoutSchedule} with no schedule)</span>
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="sc-filter" className="text-xs">
                Find a person or team
              </Label>
              <Input id="sc-filter" className="h-8 w-56" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <label htmlFor="sc-none" className="flex items-center gap-1.5 pb-1 text-sm">
              <input id="sc-none" type="checkbox" className="size-4 accent-primary" checked={onlyNone} onChange={(e) => setOnlyNone(e.target.checked)} />
              Only people with no schedule
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPicked((p) => (shown.every((r) => p.has(r.employeeId)) ? new Set() : new Set([...p, ...shown.map((r) => r.employeeId)])))}
            >
              {shown.length > 0 && shown.every((r) => picked.has(r.employeeId)) ? `Unselect all ${shown.length} matching` : `Select all ${shown.length} matching`}
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Person</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>In Manila</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.rows.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <input type="checkbox" aria-label={`Select ${r.name}`} className="size-4 accent-primary" checked={picked.has(r.employeeId)} onChange={() => toggle(r.employeeId)} />
                  </TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.team ?? "No team"}</TableCell>
                  <TableCell>
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
                  <TableCell>{r.current?.manila ?? "-"}</TableCell>
                  <TableCell>
                    {r.current ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => endSchedule({ employeeId: r.employeeId, endDate: today }), "Schedule ended.")}>
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
