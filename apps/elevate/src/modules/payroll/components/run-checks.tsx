import { Alert } from "@/components/ui/alert";
import type { RunCheck } from "../checks";
import { CHECK_LABELS, OWN_LINE_OF_SUBMITTER } from "../constants";

// The checks before review (and, once sent, before approval). They name a person and what to look at, never an amount.

function CheckList({ checks, mine }: { checks: RunCheck[]; mine: boolean }) {
  return (
    <ul className="mt-1 list-disc space-y-0.5 pl-5">
      {checks.map((c, i) => (
        <li key={`${c.code}-${c.runLineId ?? c.employeeId}-${i}`}>
          <span className="font-medium">{c.name}</span>: {c.code === "own_line_unconfirmed" && !mine ? OWN_LINE_OF_SUBMITTER : CHECK_LABELS[c.code]}
          {c.detail ? ` (${c.detail})` : ""}
        </li>
      ))}
    </ul>
  );
}

export function RunChecks({
  blocking,
  warnings,
  unreadableCount,
  stage = "draft",
  checksAreMine = true,
}: {
  blocking: RunCheck[];
  warnings: RunCheck[];
  unreadableCount: number;
  /** "review": the run was sent, so blocking checks stop the approval rather than the sending. */
  stage?: "draft" | "review";
  /** False when the "own line" check is about the person who sent the run, not the viewer. */
  checksAreMine?: boolean;
}) {
  if (blocking.length === 0 && warnings.length === 0 && unreadableCount === 0) {
    return (
      <Alert variant="success" className="rounded-lg p-3 text-sm">
        No problems found. Checks run each time the page opens.
      </Alert>
    );
  }
  return (
    <div className="space-y-3">
      {unreadableCount > 0 ? (
        <Alert variant="destructive" className="rounded-lg p-3 text-sm">
          {unreadableCount} {unreadableCount === 1 ? "line" : "lines"} can&apos;t be read, so no totals are shown. This usually means a problem with the encryption key. Tell the system owner.
        </Alert>
      ) : null}
      {blocking.length > 0 ? (
        <Alert variant="destructive" className="rounded-lg p-3 text-sm">
          <p className="font-medium">{stage === "review" ? "These stop the approval. Send the run back to have them fixed" : "Fix these before sending the run for review"}</p>
          <CheckList checks={blocking} mine={checksAreMine} />
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert variant="warning" className="rounded-lg p-3 text-sm">
          <p className="font-medium">Look at these. They don&apos;t stop the run.</p>
          <CheckList checks={warnings} mine={checksAreMine} />
        </Alert>
      ) : null}
    </div>
  );
}
