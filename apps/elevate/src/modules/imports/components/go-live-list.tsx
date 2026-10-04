"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { setGoLiveStep } from "../golive-actions";
import type { GoLiveRow } from "../golive-queries";

/** The checklist. Automatic rows show a status; manual rows have a button to tick them off. */
export function GoLiveList({ rows }: { rows: GoLiveRow[] }) {
  const { run, pending } = useRun();
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="font-medium">{r.title}</p>
            <p className="text-sm text-muted-foreground">{r.detail}</p>
            {r.note ? <p className="mt-1 text-xs text-muted-foreground">{r.note}</p> : null}
            {r.doneAt ? <p className="mt-1 text-xs text-muted-foreground">Done on {r.doneAt.toISOString().slice(0, 10)}.</p> : null}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={r.done ? "secondary" : "outline"}>{r.done ? "Done" : r.kind === "auto" ? "Not yet" : "To do"}</Badge>
            {r.kind === "manual" ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setGoLiveStep({ key: r.key, done: !r.done }), r.done ? "Marked as not done." : "Marked as done.")}>
                {r.done ? "Undo" : "Mark done"}
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
