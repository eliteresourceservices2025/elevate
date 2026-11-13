import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunStatus } from "../constants";

// Where a run is on its way: Prepare, Review (someone else checks it), Approve, Pay. A finished step has a tick, the current one is filled.

const STEPS = ["Prepare", "Review", "Approve", "Pay"] as const;
/** How many steps are finished in each status. */
const DONE: Partial<Record<RunStatus, number>> = { draft: 0, in_review: 1, approved: 3, paid: 4 };

export function RunSteps({ status }: { status: RunStatus }) {
  if (status === "cancelled") return null;
  const done = DONE[status] ?? 0;
  return (
    <ol aria-label="Where this run is" className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
      {STEPS.map((label, i) => {
        const state = i < done ? "done" : i === done ? "current" : "todo";
        return (
          <li key={label} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full border text-xs font-medium",
                state === "done" && "border-transparent bg-success-surface text-success",
                state === "current" && "border-transparent bg-primary text-primary-foreground",
                state === "todo" && "text-muted-foreground",
              )}
              aria-hidden
            >
              {state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn(state === "current" ? "font-semibold" : "text-muted-foreground")}>
              {label}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (now)" : ""}</span>
            </span>
            {i < STEPS.length - 1 ? <span className="mx-1 h-px w-5 bg-border" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
