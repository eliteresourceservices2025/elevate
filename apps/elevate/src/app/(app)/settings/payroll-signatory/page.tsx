import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { PayrollSignatoryForm } from "@/modules/settings/components/payroll-signatory-form";
import { getPayrollSignatory, listStatementPreparers } from "@/modules/settings/queries";

export const metadata: Metadata = { title: "Payment statement signatory" };

export default async function PayrollSignatoryPage() {
  const [current, preparers] = await Promise.all([orNotFound(getPayrollSignatory()), orNotFound(listStatementPreparers())]); // authorize("settings.set_payroll_signatory") inside

  return (
    <PageContainer width="form">
      <PageHeader
        title="Payment statement signatory"
        description="The name, title and signature, and the person under Prepared by, printed on every contractor payment statement. Statements of a run that is not paid yet follow what is saved here; a paid run keeps what was in force the day it was paid, so earlier statements never change."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Payment statement signatory" }]}
      />
      <PayrollSignatoryForm current={current} preparers={preparers} />
    </PageContainer>
  );
}
