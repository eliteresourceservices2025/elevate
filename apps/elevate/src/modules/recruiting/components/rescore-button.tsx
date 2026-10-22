"use client";

import { Button } from "@/components/ui/button";
import { rescoreOpening, type RescoreResult } from "../actions";
import { useRun } from "./use-run";

/** Scores the job's applicants again with its current keywords (after the keyword lists were changed). */
export function RescoreButton({ openingId }: { openingId: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      title="Read the resumes again and update every keyword match with the job's current keywords"
      onClick={() => run<RescoreResult>(() => rescoreOpening({ openingId }), (d) => (d ? `Scored ${d.scored} of ${d.looked}.${d.unreadable ? ` ${d.unreadable} resumes could not be read (for example scans).` : ""}${d.remaining ? ` ${d.remaining} more are waiting: press the button again.` : ""}` : "Done."))}
    >
      {pending ? "Scoring..." : "Re-score resumes"}
    </Button>
  );
}
