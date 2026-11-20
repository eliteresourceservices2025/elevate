import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { InvoiceDocument } from "@/modules/invoices/components/invoice-document";
import { invoiceText } from "@/modules/invoices/invoice-text";
import { InvoiceOptionsMenu } from "@/modules/invoices/components/invoice-options";
import { getInvoice, getInvoiceAbilities } from "@/modules/invoices/queries";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/invoices/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  let view: Awaited<ReturnType<typeof getInvoice>>;
  try {
    view = await orNotFound(getInvoice(id)); // authorize("invoices.view") inside
  } catch (error) {
    if (error instanceof Error && error.name === "CryptoError") {
      return (
        <PageContainer width="medium">
          <PageHeader title="Invoice" breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: "Invoice" }]} />
          <Alert variant="destructive">This invoice can&apos;t be read. Ask for help.</Alert>
        </PageContainer>
      );
    }
    throw error;
  }
  if (!view) notFound();
  const text = invoiceText(view);
  const abilities = await orNotFound(getInvoiceAbilities());

  return (
    <PageContainer width="medium">
      <PageHeader
        title={`Invoice ${text.number}`}
        description={`${text.clientName}, ${text.period}`}
        breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: text.number }]}
        actions={
          <>
            <a href={`/api/invoices/${id}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline" })}>
              <Download aria-hidden className="size-4" />
              Download PDF
            </a>
            <InvoiceOptionsMenu invoiceId={id} runId={view.runId} clientId={view.clientId} isTest={view.isTest} state={view.state} canManage={abilities.canManage} canCreate={abilities.canCreate} />
          </>
        }
      />
      {view.stateReason ? (
        <Alert variant="muted" role="note">
          Reason given: {view.stateReason}
        </Alert>
      ) : null}
      <InvoiceDocument view={text} />
    </PageContainer>
  );
}
