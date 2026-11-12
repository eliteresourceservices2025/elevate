import type { Metadata } from "next";
import { FileText } from "lucide-react";
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
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { RUN_STATUS_LABELS, STATEMENT_LABELS as S } from "@/modules/payroll/constants";
import { getStatementRuns } from "@/modules/payroll/statements-queries";

export const metadata: Metadata = { title: "Contractor payment statements" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

// Every approved run, with whether its statements have been released to the contractors. A run's own page lists the statements.

export default async function StatementRunsPage({ searchParams }: PageProps<"/payroll/statements">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const list = await orNotFound(getStatementRuns(paging)); // authorize("payroll.view") inside
  const info = pageInfo(list.total, paging.page, paging.pageSize);

  return (
    <PageContainer width="full">
      <PageHeader title={S.pageTitle} description={S.pageDescription} />
      <PayrollTabs current="statements" />
      {list.rows.length === 0 ? (
        <EmptyState icon={FileText} title={S.emptyTitle} description={S.emptyDescription} />
      ) : (
        <>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{S.run}</TableHead>
                <TableHead>{S.status}</TableHead>
                <TableHead className="text-right">{S.people}</TableHead>
                <TableHead>{S.release}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => (
                <TableRow key={r.runId}>
                  <TableCell label={S.run} className="font-medium">
                    <Link href={`/payroll/statements/${r.runId}`} prefetch={false} className="underline-offset-4 hover:underline">
                      {r.periodLabel}
                    </Link>
                    {r.isTest ? (
                      <Badge variant="warning" className="ml-2">
                        {S.testRun}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell label={S.status}>
                    <Badge variant={r.status === "paid" ? "success" : "info"}>{RUN_STATUS_LABELS[r.status]}</Badge>
                  </TableCell>
                  <TableCell label={S.people} className="text-right tabular-nums">
                    {r.people}
                  </TableCell>
                  <TableCell label={S.release}>
                    {r.isTest ? <span className="text-muted-foreground">{S.refusalTest.split(".")[0]}</span> : r.releasedAt ? <Badge variant="success">{S.released(r.releasedAt.slice(0, 10))}</Badge> : <Badge variant="outline">{S.notReleased}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={info} basePath="/payroll/statements" label="runs" />
        </>
      )}
    </PageContainer>
  );
}
