"use client";

import { MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly, formatInZone } from "@/lib/time";
import { MINUTE, formatDuration } from "../clock";
import { FLAG_HELP } from "../flag-labels";
import { CLEAN_FLAGS, flagSeverity, worstSeverity } from "../flag-severity";
import { markTestDay, reopenApprovedHours } from "../hours-actions";
import type { ReviewDay, ReviewRow } from "../hours-queries";
import { useRun } from "./use-run";

const hours = (minutes: number) => (minutes ? formatDuration(minutes * MINUTE) : "-");

/** The two Jibble system checks are shown as one line: they are about the screenshot tool, not about the person's hours. */
const JIBBLE_FLAGS = new Set(["no_screenshots", "jibble_mismatch"]);

const SEVERITY_ORDER = { blocked: 0, review: 1, clean: 2 } as const;

/** What the reviewer sees for a day: one badge. Fix needed (blocks approval or probably wrong), Check (look first), or OK. Clicking it explains each flag. */
function DaySignal({ day, label }: { day: ReviewDay; label: (flag: string) => string }) {
  const severity = worstSeverity(day.flags);
  const checks = day.flags.filter((f) => flagSeverity(f) === "review").length;
  const changed = day.state === "changed";
  const badge = changed ? (
    <Badge variant="destructive">Changed after approval</Badge>
  ) : severity === "blocked" ? (
    <Badge variant="destructive">Fix needed</Badge>
  ) : severity === "review" ? (
    <Badge variant="warning">{checks > 1 ? `Check · ${checks}` : "Check"}</Badge>
  ) : (
    <Badge variant="outline">OK</Badge>
  );
  if (day.flags.length === 0 && !changed) return <span className="inline-flex"><Badge variant="outline">OK</Badge></span>;

  const sorted = [...day.flags].sort((a, b) => SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)] || a.localeCompare(b));
  const shown = sorted.filter((f) => !JIBBLE_FLAGS.has(f));
  const jibble = sorted.filter((f) => JIBBLE_FLAGS.has(f));
  return (
    <Popover>
      <PopoverTrigger className="inline-flex rounded-full focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Why: ${formatDateOnly(day.date)}`}>
        {badge}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="font-medium">{formatDateOnly(day.date)}</p>
        <ul className="space-y-2">
          {changed ? (
            <li>
              <span className="font-medium text-destructive">Changed after approval.</span> A correction changed this day after it was approved. Approve it again.
            </li>
          ) : null}
          {shown.map((f) => (
            <li key={f}>
              <span className={flagSeverity(f) === "blocked" ? "font-medium text-destructive" : "font-medium"}>{label(f)}.</span> {FLAG_HELP.get(f) ?? ""}
            </li>
          ))}
          {jibble.length > 0 ? (
            <li>
              <span className="font-medium">Jibble check:</span> {jibble.map((f) => label(f).toLowerCase()).join("; ")}. This is about the screenshot tool, not the hours.
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ApprovalState({ day }: { day: ReviewDay }) {
  if (day.state === "approved") return <Badge variant="default">Approved</Badge>;
  if (day.state === "changed") return null; // already said by the signal
  return <Badge variant="outline">{day.finished ? "Not approved" : "Day not over"}</Badge>;
}

/** Takes an approval back (a day, or the whole week) with a reason. The days show as not approved again until approved again. */
export function ReopenDialog({ employeeId, name, from, to, open, onOpenChange }: { employeeId: string; name: string; from: string; to: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { run, pending } = useRun();
  const [reason, setReason] = useState("");
  const what = from === to ? formatDateOnly(from) : `${formatDateOnly(from)} to ${formatDateOnly(to)}`;
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run<{ reopened: number }>(
              () => reopenApprovedHours({ employeeId, from, to, reason }),
              (d) => `Reopened ${d?.reopened ?? 0} ${(d?.reopened ?? 0) === 1 ? "day" : "days"} for ${name}. They need approving again.`,
              () => (onOpenChange(false), setReason("")),
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Reopen {name}&apos;s hours</DialogTitle>
            <DialogDescription>
              {what}. The approved days show as not approved again and leave the payroll export until you approve them again. Nothing is deleted: the reason is kept in the history. Days already in an approved or paid payroll run cannot be reopened here.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            Why is it being reopened?
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={300} required autoFocus rows={3} placeholder="For example: approved by mistake, the week was empty" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || reason.trim().length < 5}>
              Reopen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Reopen week" for a person's whole week, with its own button. */
export function ReopenWeekButton({ employeeId, name, from, to }: { employeeId: string; name: string; from: string; to: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Reopen week: ${name}, ${formatDateOnly(from)} to ${formatDateOnly(to)}`}>
        Reopen week
      </Button>
      <ReopenDialog employeeId={employeeId} name={name} from={from} to={to} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Marks a day "test only" (someone tried the clock). It leaves this list and appears under "Marked test only". */
function MarkTestDialog({ employeeId, date, name, open, onOpenChange }: { employeeId: string; date: string; name: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () => markTestDay({ employeeId, date, note }),
              () => "Marked test only. It is left out of review and payroll.",
              () => (onOpenChange(false), setNote("")),
            );
          }}
        >
          <DialogHeader>
            <DialogTitle>Mark {formatDateOnly(date)} as test only</DialogTitle>
            <DialogDescription>
              {name} was only trying the clock. The day stays in the clock history but is left out of review, the payroll export and the not-approved counts.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            Why is this a test?
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={200} required autoFocus rows={2} placeholder="For example: testing the time clock" />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || note.trim().length < 3}>
              Mark as test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The ⋯ menu of a day: fix a forgotten clock-out, take the approval back, or mark it as a test. Nothing is shown when none applies. */
function DayActions({ row, day, canMarkTest }: { row: ReviewRow; day: ReviewDay; canMarkTest: boolean }) {
  const [dialog, setDialog] = useState<"reopen" | "test" | null>(null);
  const canFix = day.flags.includes("long_session") || day.flags.includes("open_session");
  if (!canFix && !day.canReopen && !canMarkTest) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${formatDateOnly(day.date)}`} />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canFix ? <DropdownMenuItem render={<Link href={`/team-attendance?fix=${row.employeeId}&date=${day.date}`} />}>Fix clock-out</DropdownMenuItem> : null}
          {day.canReopen ? <DropdownMenuItem onClick={() => setDialog("reopen")}>Reopen this day</DropdownMenuItem> : null}
          {canMarkTest ? <DropdownMenuItem onClick={() => setDialog("test")}>Mark as test</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {day.canReopen ? <ReopenDialog employeeId={row.employeeId} name={row.name} from={day.date} to={day.date} open={dialog === "reopen"} onOpenChange={(o) => setDialog(o ? "reopen" : null)} /> : null}
      {canMarkTest ? <MarkTestDialog employeeId={row.employeeId} date={day.date} name={row.name} open={dialog === "test"} onOpenChange={(o) => setDialog(o ? "test" : null)} /> : null}
    </>
  );
}

const GRID = "md:grid-cols-[9.5rem_9.5rem_4.5rem_4.5rem_6.5rem_minmax(0,1fr)_2.25rem]";

function extraText(day: ReviewDay) {
  if (!day.extraMinutes) return { main: "-", sub: null as string | null };
  const main = `+${formatDuration(day.extraMinutes * MINUTE)}`;
  if (day.approvedExtraMinutes >= day.extraMinutes) return { main, sub: "approved" };
  if (day.approvedExtraMinutes === 0) return { main, sub: "not approved" };
  return { main, sub: `${formatDuration(day.approvedExtraMinutes * MINUTE)} approved` };
}

/** A person's days of the week: when they worked, how long, and one status each. On a phone each day is a small card. */
export function DayList({ row, canMarkTest, previewMode, label }: { row: ReviewRow; canMarkTest: boolean; previewMode: boolean; label: (flag: string) => string }) {
  return (
    <div className="mt-2 text-xs">
      <div className={`hidden gap-x-3 px-1 pb-1 font-medium text-muted-foreground md:grid ${GRID}`} aria-hidden>
        <span>Day</span>
        <span>In to out</span>
        <span className="text-right">Worked</span>
        <span className="text-right">Break</span>
        <span className="text-right">Extra</span>
        <span>Status</span>
        <span />
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {row.days.map((d) => {
          const extra = extraText(d);
          return (
            <li key={d.date} className={`grid gap-x-3 gap-y-1 px-2 py-2 md:items-center ${GRID}`}>
              <span>
                <span className="block font-medium">
                  {d.weekday}, {formatDateOnly(d.date)}
                </span>
                <span className="block text-muted-foreground">{d.scheduledMinutes !== null ? `Scheduled ${hours(d.scheduledMinutes)}` : d.hasSchedule ? "Rest day" : "No schedule"}</span>
              </span>
              <span>
                <span className="text-muted-foreground md:hidden">In to out: </span>
                {d.firstIn ? formatInZone(d.firstIn, row.zone, "h:mm a") : "-"} to {d.lastOut ? formatInZone(d.lastOut, row.zone, "h:mm a") : "-"}
              </span>
              <span className="md:text-right">
                <span className="text-muted-foreground md:hidden">Worked: </span>
                <span className="font-medium">{hours(d.workedMinutes)}</span>
              </span>
              <span className="md:text-right">
                <span className="text-muted-foreground md:hidden">Break: </span>
                {hours(d.breakMinutes)}
              </span>
              <span className="md:text-right">
                <span className="text-muted-foreground md:hidden">Extra: </span>
                {extra.main}
                {extra.sub ? <span className="block text-muted-foreground">{extra.sub}</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                <DaySignal day={d} label={label} />
                <ApprovalState day={d} />
              </span>
              <span className="justify-self-end">{previewMode ? null : <DayActions row={row} day={d} canMarkTest={canMarkTest} />}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The week's review status for one person, as a count of days: how many to fix, how many to check, or Ready. */
export function WeekSignal({ row }: { row: ReviewRow }) {
  const blocked = row.days.filter((d) => worstSeverity(d.flags) === "blocked").length;
  const review = row.days.filter((d) => worstSeverity(d.flags) === "review").length;
  if (blocked > 0) return <Badge variant="destructive">{blocked} {blocked === 1 ? "day" : "days"} to fix</Badge>;
  if (review > 0) return <Badge variant="warning">{review} {review === 1 ? "day" : "days"} to check</Badge>;
  return <span className="text-muted-foreground">{row.flags.some((f) => !CLEAN_FLAGS.has(f)) ? "Check" : "Ready"}</span>;
}
