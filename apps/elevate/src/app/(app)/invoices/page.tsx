import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Download, Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { PurgeArchivedInvoicesButton } from "@/components/purge-archived-button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { shortRange } from "@/lib/short-range";
import { formatDollars } from "@/modules/invoices/calc";
import { NewInvoiceDialog } from "@/modules/invoices/components/invoice-dialogs";
import { InvoiceFilters, InvoiceStateChips, InvoiceSummaryTiles } from "@/modules/invoices/components/invoice-summary";
import { initials } from "@/modules/invoices/list-options";
import { InvoiceTabs } from "@/modules/invoices/components/invoice-tabs";
import { listInvoiceableRuns, listInvoices, parseShow } from "@/modules/invoices/queries";

export const metadata: Metadata = { title: "Invoices" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  // ?all=1 was the old link to every invoice; it still works.
  const show = one(params.show) ? parseShow(one(params.show)) : one(params.all) === "1" ? "all" : "live";
  const q = (one(params.q) ?? "").slice(0, 80);
  const list = await orNotFound(listInvoices(paging, { show, q })); // authorize("invoices.view") inside
  const runs = list.canCreate ? await orNotFound(listInvoiceableRuns()) : [];

  return (
    <PageContainer width="full">
      <PageHeader
        title="Invoices"
        description="Bill each client for the client payroll hours of a pay run. Download the PDF and send it yourself: ELEVATE sends no email."
        actions={list.canCreate ? <NewInvoiceDialog runs={runs.map((r) => ({ id: r.id, label: `${r.periodStart} to ${r.periodEnd} (${r.isTest ? "test run, " : ""}${r.status.replace("_", " ")})` }))} /> : undefined}
      />
      <InvoiceTabs current="invoices" />
      <InvoiceSummaryTiles billedCents={list.billedThisMonthCents} month={list.month} issuedCount={list.monthIssuedCount} liveCount={list.liveCount} hiddenCount={list.hiddenCount} />
      <InvoiceFilters show={list.show} q={list.q} />
      {list.show !== "live" && list.canPurge && list.archivedTestCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <PurgeArchivedInvoicesButton count={list.archivedTestCount} />
        </div>
      ) : null}
      {list.rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={list.q ? "No invoices match that search" : list.show === "test" ? "No test invoices" : "No invoices yet"}
          description={list.q ? "Try a different number or client name, or choose All." : list.show === "test" ? "A test invoice comes from a test run." : "Add the client's billing rate first, then make an invoice from a pay run."}
        />
      ) : (
        <>
          <Table stack stickyHeader>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Total (USD)</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => {
                const muted = r.state !== "active";
                return (
                  <TableRow key={r.id} className={cn("relative", muted && "text-muted-foreground")}>
                    <TableCell className="font-medium">
                      <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/invoices/${r.id}`} className="font-mono text-xs underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                        {r.number}
                      </Link>{" "}
                      {r.runStatus === "draft" ? <Badge variant="warning">Draft</Badge> : null}
                      <InvoiceStateChips state={r.state} isTest={r.isTest} />
                      </div>
                    </TableCell>
                    <TableCell label="Client">
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                          {initials(r.clientName)}
                        </span>
                        {r.clientName}
                      </span>
                    </TableCell>
                    <TableCell label="Period">{r.unreadable ? "-" : shortRange(r.periodStart, r.periodEnd)}</TableCell>
                    <TableCell label="Issued">{r.issuedOn}</TableCell>
                    <TableCell label="Total (USD)" className={cn("text-right font-medium tabular-nums", muted && "line-through")}>
                      {r.unreadable ? "-" : formatDollars(r.totalCents)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-3 max-md:justify-start">
                        {r.unreadable ? null : (
                          <a
                            href={`/api/invoices/${r.id}`}
                            aria-label={`Download PDF of ${r.number}`}
                            className="relative z-10 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-11"
                          >
                            <Download className="size-4" aria-hidden />
                          </a>
                        )}
                        <ChevronRight className="size-4 text-muted-foreground max-md:hidden" aria-hidden />
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <PagerLinks info={list.info} basePath="/invoices" query={{ show: list.show === "live" ? undefined : list.show, q: list.q || undefined }} label="invoices" />
          <p className="text-xs text-muted-foreground">
            {list.show === "live" && list.hiddenCount > 0 ? `${list.hiddenCount} void, replaced or archived ${list.hiddenCount === 1 ? "invoice is" : "invoices are"} kept out of this list. Choose All to see them.` : ""}
          </p>
        </>
      )}
    </PageContainer>
  );
}
