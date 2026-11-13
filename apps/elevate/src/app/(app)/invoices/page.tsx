import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
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
import { purgeArchivedInvoices } from "@/modules/invoices/actions";
import { formatDollars } from "@/modules/invoices/calc";
import { NewInvoiceDialog } from "@/modules/invoices/components/invoice-dialogs";
import { InvoiceTabs } from "@/modules/invoices/components/invoice-tabs";
import { listInvoiceableRuns, listInvoices } from "@/modules/invoices/queries";

export const metadata: Metadata = { title: "Invoices" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const all = one(params.all) === "1";
  const list = await orNotFound(listInvoices(paging, { all })); // authorize("invoices.view") inside
  const runs = list.canCreate ? await orNotFound(listInvoiceableRuns()) : [];

  return (
    <PageContainer width="full">
      <PageHeader
        title="Invoices"
        description="Bill each client for the client payroll hours of a pay run. Download the PDF and send it yourself: ELEVATE sends no email."
        actions={list.canCreate ? <NewInvoiceDialog runs={runs.map((r) => ({ id: r.id, label: `${r.periodStart} to ${r.periodEnd} (${r.isTest ? "test run, " : ""}${r.status.replace("_", " ")})` }))} /> : undefined}
      />
      <InvoiceTabs current="invoices" />
      {list.hiddenCount > 0 || list.showingAll ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {list.showingAll ? (
            <Link href="/invoices" className="underline underline-offset-2">
              Hide archived, void and replaced invoices
            </Link>
          ) : (
            <Link href="/invoices?all=1" className="underline underline-offset-2">
              Show archived, void and replaced invoices ({list.hiddenCount})
            </Link>
          )}
          {list.showingAll && list.canPurge && list.archivedTestCount > 0 ? (
            <PurgeArchivedInvoicesButton count={list.archivedTestCount} />
          ) : null}
        </div>
      ) : null}
      {list.rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No invoices yet" description="Add the client's billing rate first, then make an invoice from a pay run." />
      ) : (
        <>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Total (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell label="Number" className="font-medium">
                    <Link href={`/invoices/${r.id}`} className="underline-offset-4 hover:underline">
                      {r.number}
                    </Link>{" "}
                    {r.runStatus === "draft" ? <Badge variant="warning">Draft</Badge> : null}
                    {r.isTest ? <Badge variant="warning">Test</Badge> : null}
                    {r.state === "voided" ? <Badge variant="destructive">Void</Badge> : null}
                    {r.state === "archived" ? <Badge variant="outline">Archived</Badge> : null}
                    {r.state === "superseded" ? <Badge variant="outline">Replaced</Badge> : null}
                  </TableCell>
                  <TableCell label="Client">{r.clientName}</TableCell>
                  <TableCell label="Period">{r.unreadable ? "-" : `${r.periodStart} to ${r.periodEnd}`}</TableCell>
                  <TableCell label="Date">{r.issuedOn}</TableCell>
                  <TableCell label="Total (USD)" className="text-right tabular-nums">
                    {r.unreadable ? "-" : formatDollars(r.totalCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={list.info} basePath="/invoices" query={{ all: list.showingAll ? "1" : undefined }} label="invoices" />
        </>
      )}
    </PageContainer>
  );
}
