import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { BulkBar, BulkSelection, RowActions, RowCheckbox, SelectAllCheckbox, type BulkConfig } from "@/components/bulk-select";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { StatusChip } from "@/components/status-chip";
import { ViewLinks } from "@/components/view-links";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { recentPeriods } from "@/modules/attendance/pay-periods";
import { archiveRuns, deleteRuns, restoreRuns } from "@/modules/payroll/actions";
import { WORKSHEET_LABELS as L } from "@/modules/payroll/constants";
import { NewRunDialog } from "@/modules/payroll/components/run-dialogs";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { RunProgress } from "@/modules/payroll/components/run-progress";
import { RunStatusChip } from "@/modules/payroll/components/run-status-chip";
import { RunSummaryTiles } from "@/modules/payroll/components/run-summary";
import { getRuns } from "@/modules/payroll/queries";
import { parseView, periodSubtitle, type RunsView } from "@/modules/payroll/runs-list";
import { payrollToday } from "@/modules/payroll/service";

export const metadata: Metadata = { title: "Payroll runs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

const VIEWS: { key: RunsView; label: string; always?: boolean }[] = [
  { key: "all", label: "All", always: true },
  { key: "action", label: "Needs you", always: true },
  { key: "test", label: "Test runs" },
  { key: "archived", label: "Archived" },
];

const EMPTY: Record<RunsView, { title: string; description: string }> = {
  all: { title: "No pay runs yet", description: "Start a run for a pay period. Add pay lines on the Rates tab first." },
  action: { title: "Nothing needs you right now", description: "Runs that wait for you to prepare, approve, pay or release show up here." },
  test: { title: "No test runs", description: "A test run is a practice run. Mark any run as a test run under Run options." },
  archived: { title: "No archived runs", description: "Test runs and cancelled runs you archive appear here." },
};

export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  // ?archived=1 was the old link to the archived runs; it still works.
  const wanted = one(params.archived) === "1" ? "archived" : parseView(one(params.view));
  const list = await orNotFound(getRuns(paging, { view: wanted })); // authorize("payroll.view") inside
  const info = pageInfo(list.total, paging.page, paging.pageSize);
  // The pay period that ended most recently (twice a month by default); the person can change either date.
  const last = recentPeriods("semi_monthly", payrollToday(), 2)[1];

  const config: BulkConfig = {
    noun: { one: "run", many: "runs" },
    handlers: { ...(list.canArchive ? { archive: archiveRuns, restore: restoreRuns } : {}), ...(list.canPurge ? { delete: deleteRuns } : {}) },
    reason: { archive: "required" },
    deleteNote: "The runs go with their lines, payments, change history and test invoices.",
  };

  return (
    <PageContainer width="full">
      <PageHeader
        title="Payroll"
        description="Prepare each pay period here, check it, and send it to a different person to approve."
        actions={list.canPrepare ? <NewRunDialog suggestedStart={last.start} suggestedEnd={last.end} /> : undefined}
      />
      <PayrollTabs current="runs" />
      {list.view === "archived" ? null : <RunSummaryTiles summary={list.summary} />}
      <ViewLinks
        label="Run views"
        items={VIEWS.map((v) => ({ key: v.key, label: v.label, count: list.views[v.key], href: v.key === "all" ? "/payroll" : `/payroll?view=${v.key}`, active: list.view === v.key, always: v.always }))}
      />
      <BulkSelection items={list.rows.map((r) => ({ id: r.id, label: `${r.periodStart} to ${r.periodEnd}`, actions: r.actions, whyNot: r.whyNot, why: r.why }))} config={config}>
        <BulkBar />
        {list.rows.length === 0 ? (
          <EmptyState icon={Wallet} title={EMPTY[list.view].title} description={list.view === "all" && !list.canPrepare ? "A Preparer starts the runs." : EMPTY[list.view].description} />
        ) : (
          <>
            <Table stack stickyHeader>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <SelectAllCheckbox label="Select all runs on this page" />
                  </TableHead>
                  <TableHead>{L.period}</TableHead>
                  <TableHead>{L.status}</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-right">People</TableHead>
                  <TableHead>Next step</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((r) => (
                  <TableRow key={r.id} className="group/row relative">
                    <TableCell data-select="" className="align-top">
                      <RowCheckbox id={r.id} />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div>
                        <Link href={`/payroll/${r.id}`} className="underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                          {r.periodStart} to {r.periodEnd}
                        </Link>
                        {r.isTest ? <StatusChip tone="warning" className="ml-2">Test</StatusChip> : null}
                        <span className="block text-xs font-normal text-muted-foreground">{periodSubtitle(r.periodStart, r.periodEnd)}</span>
                      </div>
                      <RowActions id={r.id}>
                        <Link href={`/payroll/${r.id}`} className="relative z-10 text-primary underline-offset-2 hover:underline">
                          Open
                        </Link>
                      </RowActions>
                    </TableCell>
                    <TableCell label={L.status}>
                      <RunStatusChip status={r.status} />
                    </TableCell>
                    <TableCell label="Progress">
                      <RunProgress step={r.step} />
                    </TableCell>
                    <TableCell label="People" className="text-right tabular-nums">
                      {r.peopleCount}
                    </TableCell>
                    <TableCell label="Next step" className={cn(r.nextStep?.mine ? "font-medium text-primary" : "text-muted-foreground")}>
                      {r.nextStep?.label ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PagerLinks info={info} basePath="/payroll" query={{ view: list.view === "all" ? undefined : list.view }} label="runs" />
          </>
        )}
      </BulkSelection>
    </PageContainer>
  );
}
