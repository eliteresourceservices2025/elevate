import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CHECK_LABELS, OWN_LINE_OF_SUBMITTER } from "../constants";
import { groupReadiness, type ReadinessItem, type ReadinessPerson } from "../readiness";
import type { RunCheck } from "../checks";

// The readiness screen: what is left to do before the run goes for review (and, once sent, before approval), grouped by person. "Must fix"
// stops the run; "Review" does not, but waiting suggestions, missing client hours, missing payout details and part-period pay come first
// and are marked, because they are the ones that get missed. Each person links to their row in the sheet. Names and wording only, never an amount.

const text = (c: ReadinessItem, mine: boolean) => (c.code === "own_line_unconfirmed" && !mine ? OWN_LINE_OF_SUBMITTER : CHECK_LABELS[c.code]) + (c.detail ? ` (${c.detail})` : "");

function Items({ items, tone, mine }: { items: ReadinessItem[]; tone: "must" | "review"; mine: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {items.map((c, i) => (
        <li key={`${c.code}-${i}`} className="flex items-start gap-2 text-sm">
          <Badge variant={tone === "must" ? "destructive" : c.priority ? "warning" : "outline"} className="mt-0.5 shrink-0">
            {tone === "must" ? "Must fix" : c.priority ? "Check first" : "Review"}
          </Badge>
          <span className={c.priority || tone === "must" ? "font-medium" : undefined}>{text(c, mine)}</span>
        </li>
      ))}
    </ul>
  );
}

function PersonCard({ person, mine, href }: { person: ReadinessPerson; mine: boolean; href: string | undefined }) {
  return (
    <li className="rounded-lg border bg-card p-3" data-readiness-person={person.name}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{person.name}</h3>
        {href ? (
          <Link href={href} className="inline-flex min-h-8 items-center text-sm underline underline-offset-2 pointer-coarse:min-h-11">
            Go to this line
          </Link>
        ) : null}
      </div>
      <div className="space-y-2">
        <Items items={person.must} tone="must" mine={mine} />
        <Items items={person.review} tone="review" mine={mine} />
      </div>
    </li>
  );
}

export function RunReadiness({
  blocking,
  warnings,
  unreadableCount,
  stage = "draft",
  checksAreMine = true,
  lineHrefs,
}: {
  blocking: RunCheck[];
  warnings: RunCheck[];
  unreadableCount: number;
  /** "review": the run was sent, so blocking checks stop the approval rather than the sending. */
  stage?: "draft" | "review";
  /** False when the "own line" check is about the person who sent the run, not the viewer. */
  checksAreMine?: boolean;
  /** Where each run line sits in the sheet (page and anchor), by run line id. */
  lineHrefs: Record<string, string>;
}) {
  const r = groupReadiness(blocking, warnings);
  if (r.mustCount === 0 && r.reviewCount === 0 && unreadableCount === 0) {
    return (
      <section aria-label="Run readiness">
        <Alert variant="success" className="rounded-lg p-3 text-sm">
          Ready: no problems found. Checks run each time the page opens.
        </Alert>
      </section>
    );
  }
  const attention = r.people.filter((p) => p.must.length > 0 || p.review.some((c) => c.priority));
  const other = r.people.filter((p) => !attention.includes(p));
  const hrefOf = (p: ReadinessPerson) => (p.runLineId ? lineHrefs[p.runLineId] : undefined);

  return (
    <section aria-label="Run readiness" className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-base font-semibold">Before you send this run</h2>
        <Badge variant={r.mustCount + unreadableCount > 0 ? "destructive" : "success"}>{r.mustCount + unreadableCount} must fix</Badge>
        <Badge variant={r.reviewCount > 0 ? "warning" : "outline"}>{r.reviewCount} to review</Badge>
        <Badge variant="outline">
          {r.peopleCount} {r.peopleCount === 1 ? "person" : "people"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {stage === "review" ? "Must-fix items stop the approval: send the run back to have them fixed. " : "Fix the must-fix items before sending the run for review. "}
        Review items don&apos;t stop the run, but look at them: the ones marked Check first are the ones that get missed.
      </p>

      {unreadableCount > 0 ? (
        <Alert variant="destructive" className="rounded-lg p-3 text-sm">
          {unreadableCount} {unreadableCount === 1 ? "line" : "lines"} can&apos;t be read, so no totals are shown. This usually means a problem with the encryption key. Tell the system owner.
        </Alert>
      ) : null}

      {r.runLevel.must.length > 0 || r.runLevel.review.length > 0 ? (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <h3 className="text-sm font-semibold">The whole run</h3>
          <Items items={r.runLevel.must} tone="must" mine={checksAreMine} />
          <Items items={r.runLevel.review} tone="review" mine={checksAreMine} />
        </div>
      ) : null}

      {attention.length > 0 ? (
        <ul className="grid gap-2 lg:grid-cols-2">
          {attention.map((p) => (
            <PersonCard key={p.key} person={p} mine={checksAreMine} href={hrefOf(p)} />
          ))}
        </ul>
      ) : null}

      {other.length > 0 ? (
        <details className="rounded-lg border p-3">
          <summary className="min-h-8 cursor-pointer text-sm font-medium pointer-coarse:min-h-11">
            Other notes ({other.length} {other.length === 1 ? "person" : "people"})
          </summary>
          <ul className="mt-2 grid gap-2 lg:grid-cols-2">
            {other.map((p) => (
              <PersonCard key={p.key} person={p} mine={checksAreMine} href={hrefOf(p)} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
