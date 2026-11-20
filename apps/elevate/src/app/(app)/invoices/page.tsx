import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { BulkBar, BulkSelection, RowActions, RowCheckbox, SelectAllCheckbox, type BulkConfig } from "@/components/bulk-select";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { ViewLinks } from "@/components/view-links";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { shortRange } from "@/lib/short-range";
import { cn } from "@/lib/utils";
import { archiveInvoices, deleteInvoices, restoreInvoices } from "@/modules/invoices/actions";
import { formatDollars } from "@/modules/invoices/calc";
import { NewInvoiceDialog } from "@/modules/invoices/components/invoice-dialogs";
import { InvoiceSearch, InvoiceStateChips, InvoiceSummaryTiles } from "@/modules/invoices/components/invoice-summary";
import { InvoiceTabs } from "@/modules/invoices/components/invoice-tabs";
import { initials, type InvoiceShow } from "@/modules/invoices/list-options";
import { listInvoiceableRuns, listInvoices, parseShow } from "@/modules/invoices/queries";

export const metadata: Metadata = { title: "Invoices" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

const VIEWS: { key: InvoiceShow; label: string; always?: boolean }[] = [
  { key: "all", label: "All", always: true },
  { key: "live", label: "Live", always: true },
  { key: "void", label: "Void" },
  { key: "replaced", label: "Replaced" },
  { key: "test", label: "Test" },
  { key: "archived", label: "Archived" },
];

const EMPTY: Record<InvoiceShow, { title: string; description: string }> = {
  all: { title: "No invoices yet", description: "Add the client's billing rate first, then make an invoice from a pay run." },
  live: { title: "No live invoices", description: "Add the client's billing rate first, then make an invoice from a pay run." },
  void: { title: "No void invoices", description: "A real invoice that is voided with a reason shows up here." },
  replaced: { title: "No replaced invoices", description: "When an invoice is replaced by a corrected version, the old one shows up here." },
  test: { title: "No test invoices", description: "A test invoice comes from a test run." },
  archived: { title: "No archived invoices", description: "Archive a test invoice and it shows up here." },
};

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  // ?all=1 was the old link to every invoice; it still works.
  const show = one(params.show) ? parseShow(one(params.show)) : one(params.all) === "1" ? "all" : "live";
  const q = (one(params.q) ?? "").slice(0, 80);
  const list = await orNotFound(listInvoices(paging, { show, q })); // authorize("invoices.view") inside
  const runs = list.canCreate ? await orNotFound(listInvoiceableRuns()) : [];

  const href = (view: InvoiceShow) => {
    const query = new URLSearchParams();
    if (view !== "live") query.set("show", view);
    if (q) query.set("q", q);
    const text = query.toString();
    return text ? `/invoices?${text}` : "/invoices";
  };
  const config: BulkConfig = {
    noun: { one: "invoice", many: "invoices" },
    handlers: { ...(list.canManage ? { archive: archiveInvoices, restore: restoreInvoices } : {}), ...(list.canDelete ? { delete: deleteInvoices } : {}) },
    reason: { archive: "optional" },
    deleteNote: "Real invoices go too. Their numbers are never used again, so the numbering will have gaps. Download the PDFs first if you want copies.",
  };

  return (
    <PageContainer width="full">
      <PageHeader
        title="Invoices"
        description="Bill each client for the client payroll hours of a pay run. Download the PDF and send it yourself: ELEVATE sends no email."
        actions={list.canCreate ? <NewInvoiceDialog runs={runs.map((r) => ({ id: r.id, label: `${r.periodStart} to ${r.periodEnd} (${r.isTest ? "test run, " : ""}${r.status.replace("_", " ")})` }))} /> : undefined}
      />
      <InvoiceTabs current="invoices" />
      <InvoiceSummaryTiles billedCents={list.billedThisMonthCents} month={list.month} issuedCount={list.monthIssuedCount} liveCount={list.liveCount} hiddenCount={list.hiddenCount} />
      <ViewLinks label="Invoice views" items={VIEWS.map((v) => ({ key: v.key, label: v.label, count: list.views[v.key], href: href(v.key), active: list.show === v.key, always: v.always }))} />
      <BulkSelection items={list.rows.map((r) => ({ id: r.id, label: r.number, actions: r.actions, whyNot: r.whyNot, why: r.why }))} config={config}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <BulkBar />
          <InvoiceSearch show={list.show} q={list.q} />
        </div>
        {list.rows.length === 0 ? (
          <EmptyState icon={Receipt} title={list.q ? "No invoices match that search" : EMPTY[list.show].title} description={list.q ? "Try a different number or client name, or choose All." : EMPTY[list.show].description} />
        ) : (
          <>
            <Table stack stickyHeader>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <SelectAllCheckbox label="Select all invoices on this page" />
                  </TableHead>
                  <TableHead>Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Total (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.rows.map((r) => {
                  const muted = r.state !== "active";
                  return (
                    <TableRow key={r.id} className={cn("group/row relative", muted && "text-muted-foreground")}>
                      <TableCell data-select="" className="align-top">
                        <RowCheckbox id={r.id} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/invoices/${r.id}`} className="font-mono text-xs underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                            {r.number}
                          </Link>
                          {r.runStatus === "draft" ? <Badge variant="warning">Draft</Badge> : null}
                          <InvoiceStateChips state={r.state} isTest={r.isTest} />
                        </div>
                        <RowActions id={r.id}>
                          <Link href={`/invoices/${r.id}`} className="relative z-10 text-primary underline-offset-2 hover:underline">
                            Open
                          </Link>
                          {r.unreadable ? null : (
                            <a href={`/api/invoices/${r.id}`} className="relative z-10 text-primary underline-offset-2 hover:underline">
                              Download PDF
                            </a>
                          )}
                        </RowActions>
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PagerLinks info={list.info} basePath="/invoices" query={{ show: list.show === "live" ? undefined : list.show, q: list.q || undefined }} label="invoices" />
          </>
        )}
      </BulkSelection>
    </PageContainer>
  );
}
