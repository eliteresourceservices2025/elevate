"use client";

import { FieldHint } from "@/components/field-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "Paying from" and "Last cutoff paid" on the Rates forms: a few pay cutoffs to tap instead of a bare date box. The value is still a plain date
// (the first or last day of the cutoff), so the server and the history are unchanged. A date typed under "Pick another date" replaces the choice.

export type PickerOption = { value: string; label: string };

export function CutoffPicker({
  id,
  legend,
  hint,
  options,
  value,
  onChange,
  note,
}: {
  /** Also the id of the date box, so a test or a label can reach it. */
  id: string;
  legend: string;
  hint: string;
  options: PickerOption[];
  value: string;
  onChange: (next: string) => void;
  /** A short line under the choices (what happens, in plain words). */
  note?: string;
}) {
  const custom = value !== "" && !options.some((o) => o.value === value);
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
        {legend}
        <FieldHint label={legend}>{hint}</FieldHint>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex min-h-(--control-h) cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <input type="radio" name={`${id}-choice`} className="size-4 accent-primary" checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <details open={custom || options.length === 0} className="text-sm">
        <summary className="cursor-pointer text-muted-foreground underline-offset-2 hover:underline">Pick another date</summary>
        <div className="mt-2 space-y-1">
          <Label htmlFor={id}>Date</Label>
          <Input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} required />
          <p className="text-xs text-muted-foreground">Usually leave this. Use it only when something starts or stops part-way through a cutoff.</p>
        </div>
      </details>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </fieldset>
  );
}
