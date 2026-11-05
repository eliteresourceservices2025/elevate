import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { addDays, recentPeriods } from "@/modules/attendance/pay-periods";
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
  const list = await orNotFound(getRuns(paging)); // authorize("payroll.view") inside
  const info = pageInfo(list.total, paging.page, paging.pageSize);
  // The pay period that ended most recently (twice a month by default); the person can change either date.
  const last = recentPeriods("semi_monthly", addDays(payrollToday(), 0), 2)[1];

  return (
    <PageContainer width="full">
      <PageHeader
        title="Payroll"
        description="Prepare each pay period here, check it, and send it to a different person to approve."
        actions={list.canPrepare ? <NewRunDialog suggestedStart={last.start} suggestedEnd={last.end} /> : undefined}
      />
      <PayrollTabs current="runs" />
      {list.rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No pay runs yet" description={list.canPrepare ? "Start a run for a pay period. Add pay lines on the Rates tab first." : "A Preparer starts the runs."} />
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
                  </TableCell>
                  <TableCell label={L.status}>
                    <Badge variant={r.status === "draft" ? "outline" : r.status === "paid" ? "success" : "info"}>{RUN_STATUS_LABELS[r.status]}</Badge>
                  </TableCell>
                  <TableCell label={L.lines} className="text-right tabular-nums">
                    {r.lineCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={info} basePath="/payroll" label="runs" />
        </>
      )}
    </PageContainer>
  );
}
