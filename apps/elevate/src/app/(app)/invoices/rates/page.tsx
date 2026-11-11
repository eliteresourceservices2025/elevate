import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { formatDollars } from "@/modules/invoices/calc";
import { AddRateDialog } from "@/modules/invoices/components/invoice-dialogs";
import { InvoiceTabs } from "@/modules/invoices/components/invoice-tabs";
import { getBillRates } from "@/modules/invoices/queries";
import { invoiceToday } from "@/modules/invoices/service";

export const metadata: Metadata = { title: "Billing rates" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function BillingRatesPage({ searchParams }: PageProps<"/invoices/rates">) {
  await requireUser();
  const params = await searchParams;
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const data = await orNotFound(getBillRates(paging)); // authorize("invoices.view") inside

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Billing rates"
        description="What each client is billed for one hour, in US dollars. A change is a new rate with a start date; earlier rates stay in the history."
        actions={data.canManage ? <AddRateDialog clients={data.clients} today={invoiceToday()} /> : undefined}
      />
      <InvoiceTabs current="rates" />
      {data.overview.length === 0 ? (
        <EmptyState icon={Receipt} title="No clients yet" description="Clients are added under People." />
      ) : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Rate per hour (USD)</TableHead>
              <TableHead>Since</TableHead>
              <TableHead>Next change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.overview.map((r) => (
              <TableRow key={r.clientId}>
                <TableCell label="Client" className="font-medium">
                  {r.clientName}
                </TableCell>
                <TableCell label="Rate per hour (USD)" className="text-right tabular-nums">
                  {r.currentCents === null ? "No rate yet" : formatDollars(r.currentCents)}
                </TableCell>
                <TableCell label="Since">{r.currentFrom ?? "-"}</TableCell>
                <TableCell label="Next change">{r.upcoming ? `${formatDollars(r.upcoming.rateCents)} from ${r.upcoming.effectiveFrom}` : "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data.history.length > 0 ? (
        <section className="space-y-3" aria-label="Rate history">
          <h2 className="text-lg font-semibold">Rate history</h2>
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Starts on</TableHead>
                <TableHead className="text-right">Rate per hour (USD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell label="Client">{h.clientName}</TableCell>
                  <TableCell label="Starts on">{h.effectiveFrom}</TableCell>
                  <TableCell label="Rate per hour (USD)" className="text-right tabular-nums">
                    {formatDollars(h.rateCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PagerLinks info={data.historyInfo} basePath="/invoices/rates" label="rates" />
        </section>
      ) : null}
    </PageContainer>
  );
}
