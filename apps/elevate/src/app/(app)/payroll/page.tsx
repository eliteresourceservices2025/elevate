import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { PurgeArchivedButton } from "@/components/purge-archived-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { recentPeriods } from "@/modules/attendance/pay-periods";
import { purgeArchivedPayRuns } from "@/modules/payroll/actions";
import { RUN_STATUS_LABELS, WORKSHEET_LABELS as L } from "@/modules/payroll/constants";
import { NewRunDialog } from "@/modules/payroll/components/run-dialogs";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { getRuns } from "@/modules/payroll/queries";
import { payrollToday } from "@/modules/payroll/service";

export const metadata: Metadata = { title: "Payroll runs" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const archived = one(params.archived) === "1";
  const list = await orNotFound(getRuns(paging, { archived })); // authorize("payroll.view") inside
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
      {list.archivedCount > 0 || list.showingArchived ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {list.showingArchived ? (
            <Link href="/payroll" className="underline underline-offset-2">
              Back to the runs
            </Link>
          ) : (
            <Link href="/payroll?archived=1" className="underline underline-offset-2">
              Archived runs ({list.archivedCount})
            </Link>
          )}
          {list.showingArchived && list.canPurge && list.archivedCount > 0 ? (
            <PurgeArchivedButton
              label="Delete archived runs for good"
              title="Delete archived runs for good"
              explain="Deletes every archived test run and every archived cancelled run, with their lines, payments, history and test invoices. Real runs that were approved or paid are never deleted. A run stays if it has a real invoice or an invoice that is not archived yet."
              act={purgeArchivedPayRuns}
              done={(d) =>
                d
                  ? `Deleted ${d.runsDeleted} run${d.runsDeleted === 1 ? "" : "s"} and ${d.invoicesDeleted} invoice${d.invoicesDeleted === 1 ? "" : "s"}.${d.runsKept > 0 ? ` ${d.runsKept} stayed (check their invoices).` : ""}`
                  : "Done."
              }
            />
          ) : null}
        </div>
      ) : null}
      {list.rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={list.showingArchived ? "No archived runs" : "No pay runs yet"}
          description={list.showingArchived ? "Test runs and cancelled runs you archive appear here." : list.canPrepare ? "Start a run for a pay period. Add pay lines on the Rates tab first." : "A Preparer starts the runs."}
        />
      ) : (
        <>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{L.period}</TableHead>
                <TableHead>{L.status}</TableHead>
                <TableHead className="text-right">{L.lines}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell label={L.period} className="font-medium">
                    <Link href={`/payroll/${r.id}`} className="underline-offset-4 hover:underline">
                      {r.periodStart} to {r.periodEnd}
                    </Link>
                    {r.isTest ? (
                      <Badge variant="warning" className="ml-2">
                        Test
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell label={L.status}>
                    <Badge variant={r.status === "draft" || r.status === "cancelled" ? "outline" : r.status === "paid" ? "success" : "info"}>{RUN_STATUS_LABELS[r.status]}</Badge>
                  </TableCell>
                  <TableCell label={L.lines} className="text-right tabular-nums">
                    {r.lineCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={info} basePath="/payroll" query={{ archived: list.showingArchived ? "1" : undefined }} label="runs" />
        </>
      )}
    </PageContainer>
  );
}
