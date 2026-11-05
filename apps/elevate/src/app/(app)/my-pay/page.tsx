import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { PAYSLIP_LABELS as L } from "@/modules/payroll/constants";
import { countMyPayslips, listMyPayslips } from "@/modules/payroll/payslip-queries";

export const metadata: Metadata = { title: L.pageTitle };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function MyPayPage({ searchParams }: PageProps<"/my-pay">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const total = await orNotFound(countMyPayslips()); // authorize("payroll.view_own") inside
  const info = pageInfo(total, paging.page, paging.pageSize);
  const rows = total === 0 ? [] : await orNotFound(listMyPayslips({ page: info.page, pageSize: info.pageSize }));

  return (
    <PageContainer width="medium">
      <PageHeader title={L.pageTitle} description={L.pageDescription} />
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title={L.emptyTitle} description={L.emptyDescription} />
      ) : (
        <>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>{L.period}</TableHead>
                <TableHead className="text-right">{L.net}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{L.download}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.runId}>
                  <TableCell label={L.period} className="font-medium">
                    {r.periodLabel}
                  </TableCell>
                  <TableCell label={L.net} className="text-right tabular-nums">
                    {r.net}
                  </TableCell>
                  <TableCell label={L.download} className="text-right">
                    <div className="flex justify-end gap-2">
                      {/* No prefetch: opening a payslip page is audited, so only a real click may run it. */}
                      <Link href={`/my-pay/${r.runId}`} prefetch={false} aria-label={L.viewAction(r.periodLabel)} className={buttonVariants({ variant: "default", size: "sm" })}>
                        {L.view}
                      </Link>
                      <a href={`/api/payroll/payslips/${r.runId}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        {L.download}
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={info} basePath="/my-pay" label="payslips" />
        </>
      )}
    </PageContainer>
  );
}
