"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { useFormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateOnly } from "@/lib/time";
import { assignSchedule, removeSchedule, replaceSchedule, updateSchedule } from "../schedule-actions";
import { addDays, describeSchedule, isValidTime, WEEKDAYS } from "../schedule";
import type { ScheduleEntry } from "../schedule-view";

export const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Manila", "Europe/London", "Australia/Sydney", "UTC"];

export type RunFn = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string | (() => string), after?: () => void) => void;
/** `timeZone` is missing only for a client the person has left. */
type Client = { id: string; name: string; timeZone?: string };

/** Runs an action, says how it went and refreshes the page. */
export function useRun(): { run: RunFn; pending: boolean } {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run: RunFn = (fn, success, after) =>
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
        toast.success(typeof success === "function" ? success() : success);
        after?.();
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });
  return { run, pending };
}

export type ShiftValues = { clientId: string; startTime: string; endTime: string; weekdays: number[]; breakMinutes: string; clientHours: string };

const blankShift = (): ShiftValues => ({ clientId: "", startTime: "09:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: "60", clientHours: "" });
const fromEntry = (e: ScheduleEntry): ShiftValues => ({ clientId: e.clientId ?? "", startTime: e.startTime, endTime: e.endTime, weekdays: e.weekdays, breakMinutes: String(e.breakMinutes), clientHours: e.allottedMinutes ? String(e.allottedMinutes / 60) : "" });
const toInput = (v: ShiftValues) => ({ clientId: v.clientId, startTime: v.startTime, endTime: v.endTime, weekdays: v.weekdays, breakMinutes: v.breakMinutes, allottedMinutesPerDay: v.clientHours.trim() === "" ? "" : Math.round(Number(v.clientHours) * 60) });

/** The fields of one shift pattern. `id` keeps the labels of several rows apart. */
function ShiftFields({ id, value, onChange, clients, zone, from }: { id: string; value: ShiftValues; onChange: (v: ShiftValues) => void; clients: Client[]; zone: string; from: string }) {
  const set = (patch: Partial<ShiftValues>) => onChange({ ...value, ...patch });
  // With no zone typed, the shift takes the client's, so the preview can use it too.
  const previewZone = zone || (clients.find((c) => c.id === value.clientId)?.timeZone ?? "");
  const preview = useMemo(
    () => (previewZone && from && isValidTime(value.startTime) && isValidTime(value.endTime) ? describeSchedule({ effectiveFrom: from, effectiveTo: null, startTime: value.startTime, endTime: value.endTime, weekdays: value.weekdays, breakMinutes: 0, zone: previewZone }, from) : null),
    [previewZone, from, value.startTime, value.endTime, value.weekdays],
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-client`}>Client</Label>
          <NativeSelect id={`${id}-client`} value={value.clientId} onChange={(e) => set({ clientId: e.target.value })}>
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <TextField id={`${id}-start`} label="Shift starts" type="time" value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} required />
        <TextField id={`${id}-end`} label="Shift ends" type="time" value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} required />
        <TextField id={`${id}-hours`} label="Client hours per day" type="number" min="0.25" max="16" step="0.25" value={value.clientHours} onChange={(e) => set({ clientHours: e.target.value })} />
        <TextField id={`${id}-break`} label="Unpaid break (minutes)" type="number" min="0" max="240" value={value.breakMinutes} onChange={(e) => set({ breakMinutes: e.target.value })} />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Working days</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((w) => (
            <label key={w.n} htmlFor={`${id}-day-${w.n}`} className="flex items-center gap-1.5 text-sm">
              <input
                id={`${id}-day-${w.n}`}
                type="checkbox"
                className="size-4 accent-primary"
                checked={value.weekdays.includes(w.n)}
                onChange={(e) => set({ weekdays: e.target.checked ? [...value.weekdays, w.n] : value.weekdays.filter((x) => x !== w.n) })}
              />
              {w.short}
            </label>
          ))}
        </div>
      </fieldset>
      {preview ? <p className="text-xs text-muted-foreground">In Manila: {preview.manila} (shift times in {preview.zone})</p> : null}
    </div>
  );
}

const zoneHint = "Leave empty to use each client's own time zone. Shift times and days are in this zone.";

function ZoneField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <>
      <TextField id={id} label="Time zone" list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} hint={zoneHint} />
      <datalist id={`${id}-list`}>
        {ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

function ClockedInNote() {
  return (
    <Alert variant="warning">
      <AlertDescription>This person is clocked in now. Their clock follows the new hours as soon as you save.</AlertDescription>
    </Alert>
  );
}

/** One or more shift patterns for the chosen people, added to what they have (or replacing everything from the start date). */
export function AddScheduleForm({ people, today, clients, clockedIn, onDone }: { people: string[]; today: string; clients: Client[]; clockedIn?: boolean; onDone?: () => void }) {
  const dialog = useFormDialog();
  const { run, pending } = useRun();
  const [mode, setMode] = useState<"add" | "replace_all">("add");
  const [from, setFrom] = useState(today);
  const [zone, setZone] = useState("");
  const [rows, setRows] = useState<{ key: number; value: ShiftValues }[]>([{ key: 0, value: blankShift() }]);
  const who = people.length === 1 ? "1 person" : `${people.length} people`;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => assignSchedule({ employeeIds: people, effectiveFrom: from, zone, mode, shifts: rows.map((r) => toInput(r.value)) }),
          `Schedule saved for ${who}.`,
          () => {
            onDone?.();
            dialog?.close(true);
          },
        );
      }}
    >
      {clockedIn ? <ClockedInNote /> : null}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">When saving</legend>
        <label htmlFor="as-add" className="flex items-center gap-2 text-sm">
          <input id="as-add" type="radio" name="as-mode" className="size-4 accent-primary" checked={mode === "add"} onChange={() => setMode("add")} />
          Add to their current schedules
        </label>
        <label htmlFor="as-replace" className="flex items-center gap-2 text-sm">
          <input id="as-replace" type="radio" name="as-mode" className="size-4 accent-primary" checked={mode === "replace_all"} onChange={() => setMode("replace_all")} />
          Replace all their schedules from the start date
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="as-from" label="Starts on" type="date" min={addDays(today, -7)} value={from} onChange={(e) => setFrom(e.target.value)} required />
        <ZoneField id="as-zone" value={zone} onChange={setZone} placeholder="Each client's time zone" />
      </div>
      {rows.map((r, i) => (
        <fieldset key={r.key} className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">Shift {i + 1}</legend>
          <ShiftFields id={`as-${r.key}`} value={r.value} onChange={(value) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, value } : x)))} clients={clients} zone={zone} from={from} />
          {rows.length > 1 ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>
              Remove shift {i + 1}
            </Button>
          ) : null}
        </fieldset>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={rows.length >= 14}
        onClick={() => setRows((all) => [...all, { key: Math.max(...all.map((x) => x.key)) + 1, value: { ...all[all.length - 1].value, weekdays: [] } }])}
      >
        Add another shift pattern
      </Button>
      <p className="text-xs text-muted-foreground">Use one shift pattern for each different time or client. Their hours must not overlap.</p>
      <Button type="submit" disabled={pending || people.length === 0 || rows.some((r) => r.value.weekdays.length === 0)}>
        Save schedule for {who}
      </Button>
    </form>
  );
}

/** Fix one entry in place (a recent mistake), or replace it from a date. */
export function ChangeScheduleForm({ kind, entry, today, clients, clockedIn, onDone }: { kind: "edit" | "replace"; entry: ScheduleEntry; today: string; clients: Client[]; clockedIn: boolean; onDone: () => void }) {
  const { run, pending } = useRun();
  const [value, setValue] = useState(() => fromEntry(entry));
  const [zone, setZone] = useState(entry.zone);
  const [from, setFrom] = useState(entry.from > today ? entry.from : today);
  const [reason, setReason] = useState("");
  // A client the person is no longer assigned to still shows, so saving does not silently change it.
  const options = entry.clientId && !clients.some((c) => c.id === entry.clientId) ? [...clients, { id: entry.clientId, name: entry.clientName ?? "Former client" }] : clients;
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => (kind === "edit" ? updateSchedule({ scheduleId: entry.id, zone, reason, ...toInput(value) }) : replaceSchedule({ scheduleId: entry.id, effectiveFrom: from, zone, ...toInput(value) })),
          kind === "edit" ? "Schedule corrected." : "Schedule replaced.",
          onDone,
        );
      }}
    >
      {clockedIn ? <ClockedInNote /> : null}
      <p className="text-sm text-muted-foreground">
        {kind === "edit" ? "Fixes a mistake in this schedule only, keeping its dates. Your reason is recorded." : "This schedule ends the day before the date below and the new one starts. Their other schedules stay."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {kind === "replace" ? <TextField id="cs-from" label="New hours start on" type="date" min={addDays(today, -7)} value={from} onChange={(e) => setFrom(e.target.value)} required /> : null}
        <ZoneField id="cs-zone" value={zone} onChange={setZone} placeholder="Keep the zone" />
      </div>
      <ShiftFields id="cs" value={value} onChange={setValue} clients={options} zone={zone} from={kind === "replace" ? from : entry.from} />
      {kind === "edit" ? <TextField id="cs-reason" label="Why is this being corrected?" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} hint="No client or patient details." /> : null}
      <Button type="submit" disabled={pending || value.weekdays.length === 0 || (kind === "edit" && reason.trim().length < 5)}>
        {kind === "edit" ? "Save correction" : "Replace schedule"}
      </Button>
    </form>
  );
}

export function RemoveScheduleForm({ entry, today, clockedIn, onDone }: { entry: ScheduleEntry; today: string; clockedIn: boolean; onDone: () => void }) {
  const { run, pending } = useRun();
  const upcoming = entry.status === "upcoming";
  const [lastDay, setLastDay] = useState(today);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => removeSchedule({ scheduleId: entry.id, lastDay }), upcoming || lastDay < entry.from ? "Schedule removed." : "Schedule ended.", onDone);
      }}
    >
      {clockedIn ? <ClockedInNote /> : null}
      <p className="text-sm">
        {entry.clientName ? `${entry.clientName}: ` : ""}
        {entry.days}, {entry.clientRange} ({entry.zone})
      </p>
      {upcoming ? (
        <p className="text-sm text-muted-foreground">It starts {formatDateOnly(entry.from)}, so it will simply not apply. Their other schedules stay.</p>
      ) : (
        <TextField id="rs-date" label="Last day it applies" type="date" min={addDays(today, -7)} value={lastDay} onChange={(e) => setLastDay(e.target.value)} required hint="Added by mistake? Choose the day before it started and it will not apply at all. Their other schedules stay. A day with no schedule left is a rest day, when they cannot clock in." />
      )}
      <Button type="submit" variant="destructive" disabled={pending || !lastDay}>
        Remove schedule
      </Button>
    </form>
  );
}
