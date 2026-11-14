import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { RUN_STEPS } from "../runs-list";

// Four dots joined by lines: prepared, in review, approved, paid. The words are in the label for a screen reader and in the title for a mouse.
export function RunProgress({ step }: { step: 0 | 1 | 2 | 3 | 4 }) {
  if (step === 0) return <span className="text-muted-foreground">-</span>;
  const label = `Step ${step} of ${RUN_STEPS.length}: ${RUN_STEPS[step - 1].toLowerCase()}`;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center">
      {RUN_STEPS.map((name, i) => (
        <Fragment key={name}>
          {i > 0 ? <span aria-hidden className={cn("h-0.5 w-4", step > i ? "bg-primary" : "bg-border")} /> : null}
          <span aria-hidden className={cn("size-2.5 rounded-full", step > i ? "bg-primary" : "bg-border")} />
        </Fragment>
      ))}
    </span>
  );
}
