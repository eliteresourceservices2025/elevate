"use client";

import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { useFormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { setDayHours } from "../schedule-actions";
import { addDays, isoWeekday, WEEKDAYS } from "../schedule";
import { useRun } from "./schedule-forms";

const goodHours = (v: string) => Number(v) >= 0.25 && Number(v) <= 16;

/** The dates from `from` to `to` that fall on the chosen weekdays (152 at most). */
function datesIn(from: string, to: string, weekdays: number[]): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return out;
  for (let d = from; d <= to && out.length <= 152; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/** Hours per day for several people over a range of dates. Shows what would be replaced and who is skipped before saving. */
export function HoursRangeForm({ picked, today, onDone }: { picked: string[]; today: string; onDone: () => void }) {
  const dialog = useFormDialog();
  const confirm = useConfirm();
  const { run, pending } = useRun();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 6));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [kind, setKind] = useState<"hours" | "off" | "usual">("hours");
  const [value, setValue] = useState("");
  const [alsoUsual, setAlsoUsual] = useState(false);
  const [usual, setUsual] = useState("");

  const dates = datesIn(from, to, weekdays);
  const people = `${picked.length} ${picked.length === 1 ? "person" : "people"}`;
  const minutes = kind === "off" ? 0 : kind === "usual" ? null : Math.round(Number(value) * 60);
  const ready = picked.length > 0 && dates.length > 0 && dates.length <= 152 && (kind !== "hours" || goodHours(value)) && (!alsoUsual || goodHours(usual));
  const input = { employeeIds: picked, days: dates.map((date) => ({ date, minutes })), ...(alsoUsual ? { usualMinutes: Math.round(Number(usual) * 60) } : {}) };

  const submit = async () => {
    let skipped: string[] = [];
    let replaced = 0;
    const check = await setDayHours({ ...input, preview: true });
    if (check.ok) ({ skipped, replaced } = check.data);
    if (check.ok && (skipped.length > 0 || replaced > 0)) {
      const proceed = await confirm({
        title: "Save these hours?",
        description: [replaced > 0 ? `${replaced} day values already set will be replaced.` : "", skipped.length > 0 ? `Skipped because they have a fixed schedule (use Change a day for them): ${skipped.join(", ")}.` : ""].join(" "),
        confirmLabel: "Save hours",
        cancelLabel: "Go back",
      });
      if (!proceed) return;
    }
    run(
      () => setDayHours(input),
      skipped.length === picked.length ? "Nothing changed: everyone picked has a fixed schedule." : `Hours saved for ${picked.length - skipped.length} of ${people}.`,
      () => {
        onDone();
        dialog?.close(true);
      },
    );
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="rounded-lg border bg-muted/40 p-3 text-sm">For people with no fixed schedule. The clock stops after these hours, and a day off refuses clock-in unless extra or make-up hours are approved.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="hr-from" label="From" type="date" min={addDays(today, -31)} value={from} onChange={(e) => setFrom(e.target.value)} required />
        <TextField id="hr-to" label="To" type="date" max={addDays(today, 120)} value={to} onChange={(e) => setTo(e.target.value)} required />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">On these days</legend>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((w) => (
            <label key={w.n} htmlFor={`hr-day-${w.n}`} className="flex items-center gap-1.5 text-sm">
              <input id={`hr-day-${w.n}`} type="checkbox" className="size-4 accent-primary" checked={weekdays.includes(w.n)} onChange={(e) => setWeekdays((d) => (e.target.checked ? [...d, w.n] : d.filter((x) => x !== w.n)))} />
              {w.short}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-1 text-sm font-medium">Set to</legend>
        {(
          [
            ["hours", "Hours"],
            ["off", "Day off"],
            ["usual", "Back to usual"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} htmlFor={`hr-kind-${k}`} className="flex items-center gap-2 text-sm">
            <input id={`hr-kind-${k}`} type="radio" name="hr-kind" className="size-4 accent-primary" checked={kind === k} onChange={() => setKind(k)} />
            {label}
          </label>
        ))}
        {kind === "hours" ? (
          <div className="w-32">
            <TextField id="hr-value" label="Hours a day" type="number" min="0.25" max="16" step="0.25" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        ) : null}
      </fieldset>
      <div className="space-y-2">
        <label htmlFor="hr-usual-on" className="flex items-center gap-2 text-sm">
          <input id="hr-usual-on" type="checkbox" className="size-4 accent-primary" checked={alsoUsual} onChange={(e) => setAlsoUsual(e.target.checked)} />
          Also change their usual hours per day
        </label>
        {alsoUsual ? (
          <div className="w-44">
            <TextField id="hr-usual" label="Usual hours per day" type="number" min="0.25" max="16" step="0.25" value={usual} onChange={(e) => setUsual(e.target.value)} />
          </div>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {dates.length > 152 ? "Choose 152 days at most." : `${dates.length} ${dates.length === 1 ? "day" : "days"} for ${people}.`}
      </p>
      <Button type="submit" disabled={pending || !ready}>
        Save hours for {people}
      </Button>
    </form>
  );
}
