"use client";

import { useState } from "react";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/time";
import type { PersonHours } from "../queries";
import { setDayHours } from "../schedule-actions";
import { addDays, isoWeekday, WEEKDAYS } from "../schedule";
import { useRun } from "./schedule-forms";

const hoursText = (minutes: number) => (minutes === 0 ? "Off" : `${minutes / 60} h`);
const goodHours = (v: string) => v.trim() !== "" && Number(v) >= 0.25 && Number(v) <= 16;

/**
 * The week of someone with no fixed schedule: each day's hours (their usual hours unless HR set that day). HR changes days and the usual hours,
 * then saves once. Dates are the person's own days.
 */
export function HoursWeek({ employeeId, today, hours, canManage }: { employeeId: string; today: string; hours: PersonHours; canManage: boolean }) {
  const { run, pending } = useRun();
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const savedUsual = hours.usualMinutes === null ? "" : String(hours.usualMinutes / 60);
  const [usual, setUsual] = useState(savedUsual);

  const set = (date: string) => (date in edits ? edits[date] : (hours.days.find((d) => d.date === date)?.minutes ?? null));
  const usualMinutes = goodHours(usual) ? Math.round(Number(usual) * 60) : hours.defaultMinutes;
  const total = hours.days.reduce((sum, d) => sum + (set(d.date) ?? (isoWeekday(d.date) <= 5 ? usualMinutes : 0)), 0);
  const usualChanged = usual !== savedUsual;
  const dirty = Object.keys(edits).length > 0 || usualChanged;
  const editable = (date: string) => canManage && date >= addDays(today, -31) && date <= addDays(today, 120);

  const edit = (date: string, minutes: number | null) => {
    setEdits((all) => ({ ...all, [date]: minutes }));
    setSelected(null);
  };
  // The action skips someone who had a fixed schedule on any of those days: say so instead of "saved".
  const unlessSkipped = async (input: Parameters<typeof setDayHours>[0]) => {
    const r = await setDayHours(input);
    return r.ok && r.data.skipped.length > 0 ? { ok: false, error: "Nothing saved: they had a fixed schedule on one of those days." } : r;
  };
  const save = () =>
    run(
      () => unlessSkipped({ employeeIds: [employeeId], days: Object.entries(edits).map(([date, minutes]) => ({ date, minutes })), ...(usualChanged ? { usualMinutes: usual.trim() === "" ? null : Math.round(Number(usual) * 60) } : {}) }),
      "Hours saved.",
      () => setEdits({}),
    );
  const copy = () =>
    run(
      () => unlessSkipped({ employeeIds: [employeeId], days: hours.days.map((d) => ({ date: addDays(d.date, 7), minutes: d.minutes })) }),
      "Copied to next week.",
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm">
          <span className="font-medium">No fixed schedule.</span> <span className="text-muted-foreground">Days are the person&apos;s own. A weekend with nothing set is not expected work, though the clock still allows the usual hours.</span>
        </p>
        {canManage ? (
          <div className="w-44">
            <TextField id="hw-usual" label="Usual hours per day" type="number" min="0.25" max="16" step="0.25" value={usual} placeholder={String(hours.defaultMinutes / 60)} onChange={(e) => setUsual(e.target.value)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Usual hours per day: {usualMinutes / 60}</p>
        )}
      </div>
      <ol aria-label="Hours this week" className="grid gap-1.5 sm:grid-cols-7">
        {hours.days.map((d) => {
          const minutes = set(d.date);
          const label = `${WEEKDAYS[isoWeekday(d.date) - 1]?.short} ${Number(d.date.slice(8))}`;
          const body = (
            <>
              <span className="block text-xs">{label}</span>
              <span className="block text-base font-semibold">{minutes === null ? (isoWeekday(d.date) <= 5 ? hoursText(usualMinutes) : "-") : hoursText(minutes)}</span>
              <span className="block text-xs text-muted-foreground">
                {d.date in edits ? "not saved" : minutes === null ? "usual" : "set"}
                {d.date === today ? ", today" : ""}
              </span>
            </>
          );
          const box = `block w-full rounded-lg border bg-card p-2 text-center ${minutes === null ? "" : "border-primary"}`;
          return (
            <li key={d.date}>
              {editable(d.date) ? (
                <button
                  type="button"
                  aria-pressed={selected === d.date}
                  className={`${box} hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring`}
                  onClick={() => {
                    setSelected(d.date);
                    setValue(minutes ? String(minutes / 60) : "");
                  }}
                >
                  {body}
                </button>
              ) : (
                <div className={box}>{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      {selected ? (
        <div role="group" aria-label={`Hours for ${formatDateOnly(selected)}`} className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="w-32">
            <TextField id="hw-value" label={`Hours on ${formatDateOnly(selected)}`} type="number" min="0.25" max="16" step="0.25" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button type="button" size="sm" disabled={!goodHours(value)} onClick={() => edit(selected, Math.round(Number(value) * 60))}>
            Set hours
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => edit(selected, 0)}>
            Day off
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => edit(selected, null)}>
            Back to usual
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-muted-foreground">Week total: {total / 60} h</p>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending || dirty || addDays(hours.days[6].date, 7) > addDays(today, 120) || hours.days[0].date < addDays(today, -31)} onClick={copy}>
              Copy to next week
            </Button>
            <Button type="button" size="sm" disabled={pending || !dirty || (usual.trim() !== "" && !goodHours(usual))} onClick={save}>
              Save changes
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
