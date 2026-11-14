import type { Metadata } from "next";
import { ChevronRight, Wallet } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { PurgeArchivedRunsButton } from "@/components/purge-archived-button";
import { StatusChip } from "@/components/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { recentPeriods } from "@/modules/attendance/pay-periods";
import { WORKSHEET_LABELS as L } from "@/modules/payroll/constants";
import { NewRunDialog } from "@/modules/payroll/components/run-dialogs";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { RunProgress } from "@/modules/payroll/components/run-progress";
import { RunStatusChip } from "@/modules/payroll/components/run-status-chip";
import { RunFilters, RunSummaryTiles } from "@/modules/payroll/components/run-summary";
import { getRuns } from "@/modules/payroll/queries";
import { parseView, periodSubtitle } from "@/modules/payroll/runs-list";
import { payrollToday } from "@/modules/payroll/service";

export const metadata: Metadata = { title: "Payroll runs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

const EMPTY = {
  all: { title: "No pay runs yet", description: "Start a run for a pay period. Add pay lines on the Rates tab first." },
  action: { title: "Nothing needs you right now", description: "Runs that wait for you to prepare, approve, pay or release show up here." },
  test: { title: "No test runs", description: "A test run is a practice run. Mark any run as a test run under Run options." },
} as const;

export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const archived = one(params.archived) === "1";
  const wanted = parseView(one(params.view));
  const list = await orNotFound(getRuns(paging, { archived, view: wanted })); // authorize("payroll.view") inside
  const info = pageInfo(list.total, paging.page, paging.pageSize);
  // The pay period that ended most recently (twice a month by default); the person can change either date.
  const last = recentPeriods("semi_monthly", payrollToday(), 2)[1];

  return (
    <PageContainer width="full">
      <PageHeader
        title="Payroll"
        description="Prepare each pay period here, check it, and send it to a different person to approve."
        actions={list.canPrepare ? <NewRunDialog suggestedStart={last.start} suggestedEnd={last.end} /> : undefined}
      />
      <PayrollTabs current="runs" />
      {list.showingArchived ? null : <RunSummaryTiles summary={list.summary} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {list.showingArchived ? null : <RunFilters view={list.view} actionCount={list.actionCount} />}
        {list.archivedCount > 0 || list.showingArchived ? (
          <span className="flex flex-wrap items-center gap-3 sm:ml-auto">
            {list.showingArchived ? (
              <Link href="/payroll" className="underline underline-offset-2">
                Back to the runs
              </Link>
            ) : (
              <Link href="/payroll?archived=1" className="underline underline-offset-2">
                Archived runs ({list.archivedCount})
              </Link>
            )}
            {list.showingArchived && list.canPurge && list.archivedCount > 0 ? <PurgeArchivedRunsButton /> : null}
          </span>
        ) : null}
      </div>
      {list.rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={list.showingArchived ? "No archived runs" : EMPTY[list.view].title}
          description={list.showingArchived ? "Test runs and cancelled runs you archive appear here." : list.view === "all" && !list.canPrepare ? "A Preparer starts the runs." : EMPTY[list.view].description}
        />
      ) : (
        <>
          <Table stack stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>{L.period}</TableHead>
                <TableHead>{L.status}</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead>Next step</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => (
                <TableRow key={r.id} className="relative">
                  <TableCell className="font-medium">
                    <div>
                    <Link href={`/payroll/${r.id}`} className="underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                      {r.periodStart} to {r.periodEnd}
                    </Link>
                    {r.isTest ? <StatusChip tone="warning" className="ml-2">Test</StatusChip> : null}
                    <span className="block text-xs font-normal text-muted-foreground">{periodSubtitle(r.periodStart, r.periodEnd)}</span>
                    </div>
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
                  <TableCell>
                    <ChevronRight className="size-4 text-muted-foreground max-md:hidden" aria-hidden />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={info} basePath="/payroll" query={{ archived: list.showingArchived ? "1" : undefined, view: list.view === "all" ? undefined : list.view }} label="runs" />
        </>
      )}
    </PageContainer>
  );
}
