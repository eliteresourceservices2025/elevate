import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CHECK_LABELS, ISSUE_COPY, OWN_LINE_OF_SUBMITTER } from "../constants";
import { groupByIssue, groupReadiness, type IssueGroup, type ReadinessItem, type ReadinessPerson } from "../readiness";
import type { RunCheck } from "../checks";
import { GoToLine } from "./go-to-line";
import { UpdatePeopleFix } from "./readiness-actions";

// The readiness screen: what is left to do before the run goes for review (and, once sent, before approval). The top is a short checklist,
// one row for each KIND of problem ("No client payroll hours: 58 people") with what it means, what to do, a button that fixes it where one
// exists, and "Show who" (filters the sheet to those people). "Must fix" stops the run; the rest do not, but the easy-to-miss kinds come
// first. Every note, person by person, is one click away under "See every note by person". Names and wording only, never an amount.

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
        {href && person.runLineId ? (
          <GoToLine href={href} runLineId={person.runLineId} className="inline-flex min-h-8 items-center text-sm underline underline-offset-2 pointer-coarse:min-h-11">
            Go to this line
          </GoToLine>
        ) : null}
      </div>
      <div className="space-y-2">
        <Items items={person.must} tone="must" mine={mine} />
        <Items items={person.review} tone="review" mine={mine} />
      </div>
    </li>
  );
}

function IssueRow({ group, runId, focus, canFix, mine, keepQuery }: { group: IssueGroup; runId: string; focus: string | undefined; canFix: boolean; mine: boolean; keepQuery: string }) {
  const copy = ISSUE_COPY[group.code];
  const ownOfSender = group.code === "own_line_unconfirmed" && !mine;
  const title = ownOfSender ? "The sender's own line needs another Preparer" : copy.title;
  const meaning = ownOfSender ? OWN_LINE_OF_SUBMITTER : copy.meaning;
  const showWho = group.runLineIds.length > 0;
  const focused = focus === group.code;
  return (
    <li className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between" data-issue={group.code}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge variant={group.tone === "must" ? "destructive" : group.priority ? "warning" : "outline"}>
            {group.runLevel ? "Whole run" : `${group.count} ${group.count === 1 ? "person" : "people"}`}
          </Badge>
          {group.tone === "must" ? <Badge variant="destructive">Must fix</Badge> : group.priority ? <Badge variant="warning">Check first</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{meaning}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {canFix && group.code === "no_client_hours" ? (
          <Link href={`/payroll/${runId}/import`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Import Jibble timesheet
          </Link>
        ) : null}
        {canFix && group.code === "lines_out_of_date" ? <UpdatePeopleFix runId={runId} /> : null}
        {showWho ? (
          <Link
            href={focused ? `/payroll/${runId}${keepQuery ? `?${keepQuery}` : ""}#pay-sheet` : `/payroll/${runId}?focus=${group.code}${keepQuery ? `&${keepQuery}` : ""}#pay-sheet`}
            className={buttonVariants({ variant: focused ? "default" : "ghost", size: "sm" })}
            aria-pressed={focused}
          >
            {focused ? "Show everyone" : "Show who"}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

export function RunReadiness({
  blocking,
  warnings,
  unreadableCount,
  runId,
  stage = "draft",
  canPrepare = false,
  checksAreMine = true,
  lineHrefs,
  focus,
  keepQuery = "",
}: {
  blocking: RunCheck[];
  warnings: RunCheck[];
  unreadableCount: number;
  runId: string;
  /** "review": the run was sent, so blocking checks stop the approval rather than the sending. */
  stage?: "draft" | "review";
  /** A Preparer can fix some things from here (import a timesheet, update people), on a draft only. */
  canPrepare?: boolean;
  /** False when the "own line" check is about the person who sent the run, not the viewer. */
  checksAreMine?: boolean;
  /** Where each run line sits in the sheet (page and anchor), by run line id. */
  lineHrefs: Record<string, string>;
  /** The check the sheet is filtered to ("Show who"), if any. */
  focus?: string;
  /** The page size in the address (`size=25`), kept when a link changes the filter. */
  keepQuery?: string;
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
  const issues = groupByIssue(blocking, warnings);
  const hrefOf = (p: ReadinessPerson) => (p.runLineId ? lineHrefs[p.runLineId] : undefined);
  const canFix = canPrepare && stage === "draft";

  return (
    <section aria-label="Run readiness" className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-base font-semibold">{stage === "review" ? "Before you approve this run" : "Before you send this run"}</h2>
        <Badge variant={r.mustCount + unreadableCount > 0 ? "destructive" : "success"}>{r.mustCount + unreadableCount} must fix</Badge>
        <Badge variant={issues.filter((g) => g.tone === "review").length > 0 ? "warning" : "outline"}>
          {issues.filter((g) => g.tone === "review").length} {issues.filter((g) => g.tone === "review").length === 1 ? "thing" : "things"} to check
        </Badge>
        <Badge variant="outline">
          {r.peopleCount} {r.peopleCount === 1 ? "person" : "people"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        {stage === "review" ? "Must-fix items stop the approval: send the run back to have them fixed. " : "Fix the must-fix items before sending the run for review. "}
        The rest don&apos;t stop the run, but the ones marked Check first are the ones that get missed.
      </p>

      {unreadableCount > 0 ? (
        <Alert variant="destructive" className="rounded-lg p-3 text-sm">
          {unreadableCount} {unreadableCount === 1 ? "line" : "lines"} can&apos;t be read, so no totals are shown. This usually means a problem with the encryption key. Tell the system owner.
        </Alert>
      ) : null}

      <ul className="divide-y rounded-lg border" aria-label="What to fix">
        {issues.map((g) => (
          <IssueRow key={g.code} group={g} runId={runId} focus={focus} canFix={canFix} mine={checksAreMine} keepQuery={keepQuery} />
        ))}
      </ul>

      {r.people.length > 0 ? (
        <details className="rounded-lg border p-3">
          <summary className="min-h-8 cursor-pointer text-sm font-medium pointer-coarse:min-h-11">
            See every note by person ({r.people.length} {r.people.length === 1 ? "person" : "people"})
          </summary>
          <ul className="mt-2 grid gap-2 lg:grid-cols-2">
            {r.people.map((p) => (
              <PersonCard key={p.key} person={p} mine={checksAreMine} href={hrefOf(p)} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
