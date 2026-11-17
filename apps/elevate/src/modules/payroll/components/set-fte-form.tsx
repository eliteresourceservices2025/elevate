"use client";

import { useMemo, useState } from "react";
import { useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { setLineFtes } from "../actions";
import { formatFte, parseFte } from "../fte";
import type { RateRow } from "../queries";

// The Set FTE table: every live monthly rate with its default FTE count (1, 0.5, 0 or Not set), grouped by client, so the counts from the
// payroll sheet can be typed in one sitting. The live total at the top is the total FTE the run will use if every line is on it, to compare
// with the sheet. Saving sends only the rates that changed (choosing "Not set" clears a count); each one is a same-date correction, so nothing
// gets a new date.

const CHOICES = ["1", "0.5", "0"] as const;

export function SetFteForm({ rows }: { rows: RateRow[] }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const live = useMemo(
    () =>
      rows
        .filter((r) => !r.ended && !r.unreadable && r.basis === "monthly")
        .sort((a, b) => (a.clientName ?? "").localeCompare(b.clientName ?? "") || a.name.localeCompare(b.name)),
    [rows],
  );
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(live.map((r) => [r.lineKey, r.fte ?? ""])));
  const [onlyEmpty, setOnlyEmpty] = useState(false);

  const total = live.reduce((sum, r) => sum + (parseFte(values[r.lineKey] ?? "") ?? 0), 0); // eslint-disable-line security/detect-object-injection
  const notSet = live.filter((r) => (values[r.lineKey] ?? "") === "").length; // eslint-disable-line security/detect-object-injection
  const changed = live.filter((r) => (values[r.lineKey] ?? "") !== (r.fte ?? "")); // eslint-disable-line security/detect-object-injection
  const shown = onlyEmpty ? live.filter((r) => (values[r.lineKey] ?? "") === "") : live; // eslint-disable-line security/detect-object-injection

  const groups = new Map<string, RateRow[]>();
  for (const r of shown) groups.set(r.clientName ?? "No client", [...(groups.get(r.clientName ?? "No client") ?? []), r]);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (changed.length === 0) return;
        run(
          () => setLineFtes({ rows: changed.map((r) => ({ lineKey: r.lineKey, fte: values[r.lineKey] })) }), // eslint-disable-line security/detect-object-injection
          (data) => {
            // What the server really did: a rate can be skipped (it ended, was removed, or already had that count).
            const done = data?.changed ?? changed.length;
            const skipped = data?.skipped ?? 0;
            return `FTE saved for ${done} ${done === 1 ? "rate" : "rates"}.${skipped > 0 ? ` ${skipped} ${skipped === 1 ? "was" : "were"} left as they were (ended, removed or already that count).` : ""}`;
          },
          () => dialog?.close(true),
        );
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
        <p>
          Total FTE of these rates: <span className="font-semibold tabular-nums">{formatFte(total)}</span>
          {notSet > 0 ? <span className="text-muted-foreground"> · {notSet} not set</span> : null}
        </p>
        <label className="flex min-h-8 items-center gap-2 pointer-coarse:min-h-11">
          <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="size-4" />
          Show only the ones not set
        </label>
      </div>

      {shown.length === 0 ? <p className="text-sm text-muted-foreground">Every rate has an FTE.</p> : null}
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        {[...groups.entries()].map(([client, list]) => (
          <section key={client} aria-label={client} className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{client}</h3>
            <ul className="divide-y rounded-lg border">
              {list.map((r) => (
                <li key={r.lineKey} className="flex items-center justify-between gap-3 px-3 py-2">
                  <label htmlFor={`fte-${r.lineKey}`} className="min-w-0 text-sm">
                    <span className="font-medium">{r.name}</span>
                    {r.alias ? <span className="block truncate text-xs text-muted-foreground">{r.alias}</span> : null}
                  </label>
                  <NativeSelect
                    id={`fte-${r.lineKey}`}
                    className="w-28"
                    value={values[r.lineKey] ?? ""} // eslint-disable-line security/detect-object-injection
                    onChange={(e) => setValues({ ...values, [r.lineKey]: e.target.value })}
                  >
                    <option value="">Not set</option>
                    {[...CHOICES, ...(r.fte && !(CHOICES as readonly string[]).includes(r.fte) ? [r.fte] : [])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Button type="submit" disabled={pending || changed.length === 0}>
        Save FTE{changed.length > 0 ? ` (${changed.length})` : ""}
      </Button>
    </form>
  );
}
