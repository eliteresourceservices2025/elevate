"use client";

import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { updateRunPeople } from "../actions";

// Buttons that fix a checklist row in one click (client side: they run a server action).

/** The same step as "Update people" in the Fill or update menu: bring the draft run in line with the Rates tab. */
export function UpdatePeopleFix({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        run(
          () => updateRunPeople({ runId }),
          (d) => (d && d.added + d.updated + d.removed === 0 ? "The run already matches the Rates tab." : `Run updated: ${d?.added ?? 0} added, ${d?.updated ?? 0} moved to a newer rate, ${d?.removed ?? 0} taken off.`),
        )
      }
    >
      Update people
    </Button>
  );
}
