import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { ISSUE_COPY, RUN_STATUS_LABELS } from "@/modules/payroll/constants";
import { groupByIssue, groupReadiness } from "@/modules/payroll/readiness";
import { ApprovalBar } from "@/modules/payroll/components/approval-bar";
import { ConfirmAllButton } from "@/modules/payroll/components/jibble-import";
import { RunReadiness } from "@/modules/payroll/components/run-readiness";
import { RunSteps } from "@/modules/payroll/components/run-steps";
import { SheetFilters, type SheetChip } from "@/modules/payroll/components/sheet-filters";
import { CancelRunDialog, RemovedPeople } from "@/modules/payroll/components/run-dialogs";
import { RunFillMenu } from "@/modules/payroll/components/run-fill-menu";
import { RunOptionsMenu } from "@/modules/payroll/components/run-options";
import { UnassignedSuggestions } from "@/modules/payroll/components/suggestion-controls";
import { RunTotals } from "@/modules/payroll/components/run-totals";
import { Worksheet } from "@/modules/payroll/components/worksheet";
import { PaymentsPanel } from "@/modules/payroll/components/payments-panel";
import { getPayments, getWorksheet } from "@/modules/payroll/queries";
import { payrollToday } from "@/modules/payroll/service";

export const metadata: Metadata = { title: "Payroll run" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const DEFAULT_SIZE = 50;

export default async function PayrollRunPage({ params, searchParams }: PageProps<"/payroll/[runId]">) {
  await requireUser();
  const { runId } = await params;
  const query = await searchParams;
  const sheet = await orNotFound(getWorksheet(runId)); // authorize("payroll.view") inside
  if (!sheet) notFound();

  const { run } = sheet;
  // The checklist by kind of problem, and the chips over the sheet. ?focus= shows only some lines: "attention", "unchecked", or one kind of problem.
  const issues = groupByIssue(sheet.checks.blocking, sheet.checks.warnings);
  const attentionIds = new Set(
    groupReadiness(sheet.checks.blocking, sheet.checks.warnings)
      .people.filter((p) => p.runLineId && (p.must.length > 0 || p.review.some((c) => c.priority)))
      .map((p) => p.runLineId as string),
  );
  const uncheckedIds = new Set(sheet.lines.filter((l) => !l.confirmedByName).map((l) => l.runLineId));
  const idsFor = (key: string): Set<string> => (key === "attention" ? attentionIds : key === "unchecked" ? uncheckedIds : new Set(issues.find((g) => g.code === key)?.runLineIds ?? []));
  const askedFocus = one(query.focus);
  const focus = askedFocus === "attention" || askedFocus === "unchecked" || issues.some((g) => g.code === askedFocus && g.runLineIds.length > 0) ? askedFocus : undefined;
  const visible = focus ? sheet.lines.filter((l) => idsFor(focus).has(l.runLineId)) : sheet.lines;
  const inReview = run.status === "draft" || run.status === "in_review";
  const chips: SheetChip[] = [{ key: "all", label: "All", count: sheet.lines.length }];
  if (attentionIds.size > 0) chips.push({ key: "attention", label: "Needs attention", count: attentionIds.size });
  if (inReview && uncheckedIds.size > 0) chips.push({ key: "unchecked", label: "Not yet checked", count: uncheckedIds.size });
  for (const g of issues.filter((i) => i.runLineIds.length > 0).slice(0, 4)) chips.push({ key: g.code, label: ISSUE_COPY[g.code].title, count: g.runLineIds.length });

  const paging = parsePaging({ page: one(query.page), size: one(query.size) }, DEFAULT_SIZE);
  const info = pageInfo(visible.length, paging.page, paging.pageSize);
  const shown = visible.slice(info.offset, info.offset + info.pageSize);
  // Suggested amounts that sit on a line (from the hours, or from an imported timesheet) can be confirmed in one step.
  const suggestedCount = sheet.lines.reduce((n, l) => n + l.items.filter((i) => i.state === "suggested").length, 0);
  // Where each line sits (its page and anchor), and how many checks each one has, for the readiness screen and the phone cards.
  // A link to a line always goes to the unfiltered list, so the line is on the page it names.
  const sizeParam = one(query.size) ? `size=${one(query.size)}` : "";
  const lineHrefs: Record<string, string> = Object.fromEntries(
    sheet.lines.map((l, i) => [l.runLineId, `/payroll/${run.id}?page=${Math.floor(i / paging.pageSize) + 1}${sizeParam ? `&${sizeParam}` : ""}#line-${l.runLineId}`]),
  );
  const issueCounts: Record<string, { must: number; review: number }> = {};
  for (const [kind, list] of [["must", sheet.checks.blocking], ["review", sheet.checks.warnings]] as const) {
    for (const c of list) if (c.runLineId) (issueCounts[c.runLineId] ??= { must: 0, review: 0 })[kind] += 1;
  }
  const payments = run.status === "approved" || run.status === "paid" ? await getPayments(runId) : null;

  return (
    <PageContainer width="canvas">
      <PageHeader
        title={`Pay run ${run.periodStart} to ${run.periodEnd}`}
        breadcrumbs={[{ label: "Payroll", href: "/payroll" }, { label: `${run.periodStart} to ${run.periodEnd}` }]}
        description={
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant={run.status === "draft" ? "outline" : "info"}>{RUN_STATUS_LABELS[run.status]}</Badge>
            {run.isTest ? <Badge variant="warning">Test run</Badge> : null}
            {run.archivedAt ? <Badge variant="outline">Archived</Badge> : null}
            <span>Opening this page is written to the audit log. Figures are never sent in notices.</span>
          </p>
        }
        actions={
          <>
            {sheet.canPrepare && run.status === "draft" ? (
              <>
                <RunFillMenu runId={run.id} />
                <ConfirmAllButton runId={run.id} count={suggestedCount} />
                <CancelRunDialog runId={run.id} />
              </>
            ) : null}
            {sheet.canPrepare || sheet.canApprove ? <RunOptionsMenu runId={run.id} status={run.status} isTest={run.isTest} archived={run.archivedAt !== null} /> : null}
          </>
        }
      />
      {run.isTest ? (
        <Alert variant="warning" role="note">
          {run.archivedAt
            ? "This test run is archived: it is hidden from the list but kept on record. Use Run options to restore it."
            : "This is a test run. It is kept apart from real runs, nobody sees a payment statement from it, and invoices made from it are numbered TEST. When you are done, archive it under Run options."}
        </Alert>
      ) : null}
      <RunSteps status={run.status} />
      {inReview ? (
        <RunReadiness
          blocking={sheet.checks.blocking}
          warnings={sheet.checks.warnings}
          unreadableCount={sheet.unreadableCount}
          runId={run.id}
          stage={run.status === "draft" ? "draft" : "review"}
          canPrepare={sheet.canPrepare}
          checksAreMine={sheet.checksAreMine}
          lineHrefs={lineHrefs}
          focus={focus}
          sizeQuery={sizeParam}
        />
      ) : null}
      <UnassignedSuggestions sheet={sheet} canPrepare={sheet.canPrepare} />
      {run.status === "draft" && sheet.canPrepare ? <RemovedPeople runId={run.id} removed={sheet.removed} /> : null}
      <div id="pay-sheet" className="scroll-mt-24 space-y-3">
        {chips.length > 1 ? <SheetFilters runId={run.id} active={focus} chips={chips} shown={visible.length} total={sheet.lines.length} sizeQuery={sizeParam} /> : null}
        <Worksheet sheet={sheet} lines={shown} canPrepare={sheet.canPrepare} issueCounts={issueCounts} />
        <PagerLinks info={info} basePath={`/payroll/${run.id}`} query={{ focus }} defaultSize={DEFAULT_SIZE} label="lines" />
      </div>
      <RunTotals sheet={sheet} />
      <ApprovalBar
        runId={run.id}
        status={run.status}
        canPrepare={sheet.canPrepare}
        canApprove={sheet.canApprove}
        blocking={sheet.checks.blocking.length + sheet.unreadableCount}
        expectedHash={sheet.expectedHash}
        refusal={sheet.approvalRefusal}
        sentBackNote={sheet.sentBackNote}
        lineCount={sheet.lines.length}
      />
      {payments ? <PaymentsPanel view={payments} today={payrollToday()} /> : null}
    </PageContainer>
  );
}
