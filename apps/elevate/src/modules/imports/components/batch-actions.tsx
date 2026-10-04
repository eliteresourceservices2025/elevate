"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { commitImport, discardImport, rollbackImport, signOffImport } from "../actions";

export function BatchActions({ batchId, status, errors, signedOff }: { batchId: string; status: string; errors: number; signedOff: boolean }) {
  const { run, pending } = useRun();
  const [skip, setSkip] = useState(false);
  const [confirm, setConfirm] = useState<"commit" | "rollback" | null>(null);

  if (status === "preview")
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Commit</h2>
        <p className="text-sm text-muted-foreground">Committing creates the people (and updates the ones already in ELEVATE). No emails are sent and nobody gets an account. Invitations are sent later, in waves.</p>
        {errors > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Skip the {errors} {errors === 1 ? "row" : "rows"} with errors and commit the rest
          </label>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {confirm === "commit" ? (
            <>
              <Button disabled={pending || (errors > 0 && !skip)} onClick={() => run(() => commitImport({ batchId, skipErrors: skip }), (d) => `Committed: ${(d as { created: number; updated: number } | undefined)?.created ?? 0} created, ${(d as { updated: number } | undefined)?.updated ?? 0} updated.`)}>
                Yes, commit now
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Never mind
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirm("commit")} disabled={errors > 0 && !skip}>
              Commit this import
            </Button>
          )}
          <Button variant="outline" disabled={pending} onClick={() => run(() => discardImport({ batchId }), "Discarded. The uploaded data was removed.")}>
            Discard
          </Button>
        </div>
        {errors > 0 && !skip ? <p className="text-xs text-muted-foreground">Fix the file and upload it again, or tick the box above.</p> : null}
      </div>
    );

  if (status === "committed")
    return (
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">After the commit</h2>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/imports/${batchId}/reconciliation`} target="_blank" rel="noreferrer" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-secondary/50">
            Reconciliation report (PDF)
          </a>
          {!signedOff ? (
            <Button variant="outline" disabled={pending} onClick={() => run(() => signOffImport({ batchId }), "Signed off.")}>
              Sign off the reconciliation
            </Button>
          ) : null}
          {confirm === "rollback" ? (
            <>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => rollbackImport({ batchId }), (d) => `Rolled back: ${(d as { archived: number } | undefined)?.archived ?? 0} people archived.`)}>
                Yes, roll back
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Never mind
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirm("rollback")}>
              Roll back
            </Button>
          )}
        </div>
        {confirm === "rollback" ? <p className="text-sm text-muted-foreground">People this import created are archived (not deleted), unless they have signed in or have activity. Changes it made to people who were already in ELEVATE are not undone.</p> : null}
      </div>
    );
  return null;
}
