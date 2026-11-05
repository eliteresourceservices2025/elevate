import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/lib/or-not-found";
import { PayrollSignatoryForm } from "@/modules/settings/components/payroll-signatory-form";
import { getPayrollSignatory } from "@/modules/settings/queries";

export const metadata: Metadata = { title: "Payslip signatory" };

export default async function PayrollSignatoryPage() {
  const current = await orNotFound(getPayrollSignatory()); // authorize("settings.set_payroll_signatory") inside

  return (
    <PageContainer width="form">
      <PageHeader
        title="Payslip signatory"
        description="The name, title and signature printed at the bottom of every payslip. A pay run keeps the signatory in force on the day it is paid, so earlier payslips never change."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Payslip signatory" }]}
      />
      <PayrollSignatoryForm current={current} />
    </PageContainer>
  );
}
