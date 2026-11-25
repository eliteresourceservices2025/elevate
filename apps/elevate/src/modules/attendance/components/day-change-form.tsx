"use client";

import { useState } from "react";
import { useFormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDateOnly } from "@/lib/time";
import type { PersonSchedule } from "../queries";
import { allOff, clientsThatDay, wholeDayFor, workedMinutes, type UsualShift } from "../day-change";
import { setDayChange } from "../schedule-actions";
import { addDays, isoWeekday, isValidTime } from "../schedule";
import { useRun } from "./schedule-forms";

type Times = { startTime: string; endTime: string; breakMinutes: string; clientHours: string };
type Row = { mode: "keep" | "different" | "off"; times: Times[] };

const hours = (minutes: number) => `${Math.round((minutes / 60) * 100) / 100} h`;
const toTimes = (s: { startTime: string; endTime: string; breakMinutes: number; allottedMinutesPerDay?: number | null }): Times => ({ startTime: s.startTime, endTime: s.endTime, breakMinutes: String(s.breakMinutes), clientHours: s.allottedMinutesPerDay ? String(s.allottedMinutesPerDay / 60) : "" });
const toShift = (t: Times) => ({ startTime: t.startTime, endTime: t.endTime, breakMinutes: Number(t.breakMinutes) || 0, allottedMinutesPerDay: t.clientHours.trim() === "" ? undefined : Math.round(Number(t.clientHours) * 60) });

function TimeFields({ id, value, onChange }: { id: string; value: Times; onChange: (v: Times) => void }) {
  const set = (patch: Partial<Times>) => onChange({ ...value, ...patch });
  const worked = isValidTime(value.startTime) && isValidTime(value.endTime) ? workedMinutes([toShift(value)]) : 0;
  // A client limit shorter than the shift stops the clock early: easy to miss when a shift is stretched to a full day.
  const limit = value.clientHours.trim() === "" ? null : Number(value.clientHours) * 60;
  return (
    <div className="space-y-2">
    <div className="grid gap-2 sm:grid-cols-4">
      <TextField id={`${id}-start`} label="From" type="time" value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} required />
      <TextField id={`${id}-end`} label="To" type="time" value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} required />
      <TextField id={`${id}-break`} label="Break (minutes)" type="number" min="0" max="240" value={value.breakMinutes} onChange={(e) => set({ breakMinutes: e.target.value })} />
      <TextField id={`${id}-hours`} label="Client hours" type="number" min="0.25" max="16" step="any" value={value.clientHours} onChange={(e) => set({ clientHours: e.target.value })} />
    </div>
    {limit !== null && limit > 0 && limit < worked ? (
      <Alert variant="warning">
        <AlertDescription>The clock stops after {hours(limit)} for this client, before this shift ends ({hours(worked)} of work). Change the client hours if they should work all of it.</AlertDescription>
      </Alert>
    ) : null}
    </div>
  );
}

/** Change one day: quick choices first (the whole day for one client, everyone off), or each client's shifts by hand. */
export function DayChangeForm({ data }: { data: PersonSchedule }) {
  const dialog = useFormDialog();
  const { run, pending } = useRun();
  const [date, setDate] = useState(data.today);
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState<Record<string, Row>>({});
  const [whole, setWhole] = useState<Times | null>(null);
  const [reason, setReason] = useState("");

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const weekday = valid ? isoWeekday(date) : 0;
  const inForce = data.entries.filter((e) => valid && e.from <= date && (e.to === null || e.to >= date));
  const usual: UsualShift[] = inForce.filter((e) => e.weekdays.includes(weekday)).map((e) => ({ clientId: e.clientId, startTime: e.startTime, endTime: e.endTime, breakMinutes: e.breakMinutes, zone: e.zone, allottedMinutes: e.allottedMinutes }));
  const nameOf = (id: string | null) => data.clients.find((c) => c.id === id)?.name ?? inForce.find((e) => e.clientId === id)?.clientName ?? "No client";
  const onDay = valid ? clientsThatDay(usual, date) : [];
  const [extra, setExtra] = useState<string[]>([]);
  const customClients = [...onDay.map((id) => id ?? ""), ...extra.filter((id) => !onDay.some((x) => (x ?? "") === id))];

  const usualFor = (id: string) => usual.filter((s) => (s.clientId ?? "") === id);
  const rowFor = (id: string): Row => custom[id] ?? { mode: usualFor(id).length > 0 ? "keep" : "different", times: usualFor(id).length > 0 ? usualFor(id).map((s) => toTimes({ ...s, allottedMinutesPerDay: s.allottedMinutes })) : [toTimes({ startTime: "09:00", endTime: "17:00", breakMinutes: 0 })] };
  const setRow = (id: string, row: Row) => setCustom((all) => ({ ...all, [id]: row }));
  const pick = (value: string) => {
    setChoice(value);
    if (value.startsWith("whole:")) {
      const id = value.slice(6) || null;
      const made = wholeDayFor(usual, id, date).find((c) => (c.clientId || null) === id);
      setWhole(made?.shifts[0] ? toTimes(made.shifts[0]) : null);
    }
  };

  const payload = (() => {
    if (choice === "off") return allOff(usual, date);
    if (choice.startsWith("whole:") && whole) return onDay.map((id) => ({ clientId: id ?? "", shifts: (id ?? "") === choice.slice(6) ? [toShift(whole)] : [] }));
    if (choice === "custom") return customClients.flatMap((id) => (rowFor(id).mode === "keep" ? [] : [{ clientId: id, shifts: rowFor(id).mode === "off" ? [] : rowFor(id).times.map(toShift) }]));
    return [];
  })();
  const complete = payload.length > 0 && payload.every((c) => c.shifts.every((s) => isValidTime(s.startTime) && isValidTime(s.endTime)));

  // What the day comes to: changed clients from the payload, the rest as usual.
  const result = onDay
    .map((id) => id ?? "")
    .concat(payload.map((c) => c.clientId).filter((id) => !onDay.some((x) => (x ?? "") === id)))
    .map((id) => {
      const changed = payload.find((c) => c.clientId === id);
      const shifts = changed ? changed.shifts : usualFor(id);
      return { id, text: shifts.length === 0 ? "off" : hours(workedMinutes(shifts)), minutes: workedMinutes(shifts) };
    });
  const usualTotal = workedMinutes(usual);
  const alreadyChanged = data.changedDays.some((c) => c.date === date);

  const option = (value: string, label: string) => (
    <label key={value} htmlFor={`dc-${value}`} className="flex items-center gap-2 rounded-lg border p-2 text-sm has-checked:border-primary has-checked:bg-primary/5">
      <input id={`dc-${value}`} type="radio" name="dc-choice" className="size-4 accent-primary" checked={choice === value} onChange={() => pick(value)} />
      {label}
    </label>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => setDayChange({ employeeId: data.employeeId, date, reason, clients: payload }), "Day saved. The person was told.", () => dialog?.close(true));
      }}
    >
      {data.clockedIn ? (
        <Alert variant="warning">
          <AlertDescription>This person is clocked in now. Their clock follows the new hours as soon as you save.</AlertDescription>
        </Alert>
      ) : null}
      <TextField
        id="dc-date"
        label="Day (in the client's calendar)"
        type="date"
        min={addDays(data.today, -7)}
        max={addDays(data.today, 120)}
        value={date}
        onChange={(e) => {
          setDate(e.target.value);
          setChoice("");
          setCustom({});
          setExtra([]);
        }}
        required
      />
      {valid && inForce.length === 0 ? <p className="text-sm text-muted-foreground">They have no fixed schedule that day. Use hours per day instead.</p> : null}
      {inForce.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            Usual for {formatDateOnly(date)}: {usual.length === 0 ? "rest day" : usual.map((s) => `${nameOf(s.clientId)} ${s.startTime} to ${s.endTime}`).join(", ")}.
            {alreadyChanged ? " This day is already changed: saving replaces that change." : ""}
          </p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">What changes</legend>
            {onDay.length > 1 ? onDay.map((id) => option(`whole:${id ?? ""}`, `Whole day for ${nameOf(id)}, others off`)) : null}
            {usual.length > 0 ? option("off", onDay.length > 1 ? "Day off for all clients" : "Day off") : null}
            {option("custom", "Custom hours")}
          </fieldset>
        </>
      ) : null}
      {choice.startsWith("whole:") && whole ? (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{nameOf(choice.slice(6) || null)} that day</legend>
          <TimeFields id="dc-whole" value={whole} onChange={setWhole} />
        </fieldset>
      ) : null}
      {choice === "custom" ? (
        <div className="space-y-3">
          {customClients.map((id) => {
            const row = rowFor(id);
            const mine = usualFor(id);
            return (
              <fieldset key={id || "none"} className="space-y-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{nameOf(id || null)}</legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(mine.length > 0 ? (["keep", "different", "off"] as const) : (["different", "keep"] as const)).map((mode) => (
                    <label key={mode} htmlFor={`dc-${id}-${mode}`} className="flex items-center gap-2">
                      <input id={`dc-${id}-${mode}`} type="radio" name={`dc-mode-${id}`} className="size-4 accent-primary" checked={row.mode === mode} onChange={() => setRow(id, { ...row, mode })} />
                      {mode === "keep" ? (mine.length > 0 ? "Keep" : "Do not add") : mode === "different" ? "Different hours" : "Off"}
                    </label>
                  ))}
                </div>
                {row.mode === "different" ? row.times.map((t, i) => <TimeFields key={i} id={`dc-${id}-${i}`} value={t} onChange={(v) => setRow(id, { ...row, times: row.times.map((x, j) => (j === i ? v : x)) })} />) : null}
              </fieldset>
            );
          })}
          {data.clients.some((c) => !customClients.includes(c.id)) ? (
            <div className="space-y-1.5">
              <Label htmlFor="dc-add">Add a shift that day for</Label>
              <NativeSelect id="dc-add" value="" onChange={(e) => e.target.value && setExtra((all) => [...all, e.target.value])}>
                <option value="">Choose a client</option>
                {data.clients
                  .filter((c) => !customClients.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
          ) : null}
        </div>
      ) : null}
      {complete ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
          Result for {formatDateOnly(date)}: {result.map((r) => `${nameOf(r.id || null)} ${r.text}`).join(", ")}. Total {hours(result.reduce((n, r) => n + r.minutes, 0))} (usual {hours(usualTotal)}).
        </p>
      ) : null}
      <TextField id="dc-reason" label="Why is this day different?" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={300} hint="No client or patient details." />
      <Button type="submit" disabled={pending || !complete || reason.trim().length < 5}>
        Save day
      </Button>
    </form>
  );
}
