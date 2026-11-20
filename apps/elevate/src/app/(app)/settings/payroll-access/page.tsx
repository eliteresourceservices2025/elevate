import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { PayrollAccessPanel } from "@/modules/settings/components/payroll-access-panel";
import { getPayrollAccessList } from "@/modules/settings/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Payroll access" };

export default async function PayrollAccessPage() {
  const rows = await orNotFound(getPayrollAccessList()); // authorize("settings.set_payroll_access") inside

  return (
    <PageContainer>
      <PageHeader
        title="Payroll access"
        description="Choose who can see and run payroll. No role grants it. Every change is written to the audit log and the other Super Admins are told."
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Payroll access" }]}
      />
      <PayrollAccessPanel rows={rows} />
    </PageContainer>
  );
}
