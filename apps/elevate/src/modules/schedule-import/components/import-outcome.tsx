"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { ApplyOutcome } from "../actions";

const key = (batchId: string) => `schedule-import-outcome:${batchId}`;

/** Keeps the result in this tab only, so the page can show it again after the data refresh that follows an apply. Counts and sheet names, no ids. */
export function rememberOutcome(batchId: string, outcome: ApplyOutcome) {
  try {
    sessionStorage.setItem(key(batchId), JSON.stringify(outcome));
  } catch {
    // Storage can be blocked; the page then shows the plain "already applied" notice.
  }
}

/** What an apply did, and the rows that were skipped (to fix on the person's profile). */
export function ImportOutcome({ outcome }: { outcome: ApplyOutcome }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div role="status" className="rounded-xl border border-green-600/40 bg-green-600/10 p-4 text-sm">
        <p className="font-medium">The import was applied.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{outcome.assignmentsAdded} client assignments added</li>
          <li>{outcome.schedulesAdded} schedules set (the previous one closed the day before)</li>
          <li>{outcome.hoursUpdated} hours per week filled in or corrected</li>
          <li>{outcome.assignmentsEnded + outcome.endedByTick} assignments ended</li>
          <li>{outcome.skipped.length} skipped</li>
        </ul>
        <p className="mt-2 text-muted-foreground">Attendance days for these people are being recalculated from their clock events. Days already approved that now differ will show &ldquo;changed after approval&rdquo; and need approving again.</p>
      </div>
      {outcome.skipped.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Skipped: fix these on the person&apos;s profile</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {outcome.skipped.map((s) => (
              <li key={s.key} className="p-3">
                <span className="font-medium">{s.sheetName}</span> ({s.sheetClient}): {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button onClick={() => router.push("/settings/import-schedules")}>Back to uploads</Button>
    </div>
  );
}

/** Shown when an upload is no longer a preview (applied, discarded or expired) instead of a "page not found". */
export function FinishedBatch({ batchId, status }: { batchId: string; status: string }) {
  const router = useRouter();
  // Read from this tab only; the server render and first paint see nothing, so there is no mismatch.
  const raw = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return sessionStorage.getItem(key(batchId));
      } catch {
        return null;
      }
    },
    () => null,
  );
  let outcome: ApplyOutcome | null = null;
  try {
    outcome = raw ? (JSON.parse(raw) as ApplyOutcome) : null;
  } catch {
    outcome = null;
  }
  if (outcome) return <ImportOutcome outcome={outcome} />;
  const text =
    status === "applied"
      ? "This upload was applied. Its rows have been removed."
      : status === "discarded"
        ? "This upload was discarded or expired. Upload the sheet again to start over."
        : "This upload is no longer available. Upload the sheet again.";
  return (
    <div className="space-y-4">
      <p role="status" className="rounded-xl border bg-card p-4 text-sm">
        {text}
      </p>
      <Button onClick={() => router.push("/settings/import-schedules")}>Back to uploads</Button>
    </div>
  );
}
