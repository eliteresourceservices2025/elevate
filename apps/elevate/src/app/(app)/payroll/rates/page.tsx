import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { payrollToday } from "@/modules/payroll/service";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { RatesTable } from "@/modules/payroll/components/rates-table";
import { getRateOptions, getRates } from "@/modules/payroll/queries";

export const metadata: Metadata = { title: "Payroll rates" };

export default async function PayrollRatesPage() {
  const user = await requireUser();
  const rows = await orNotFound(getRates()); // authorize("payroll.view") inside
  const options = can(user, "payroll.manage_rates") ? await orNotFound(getRateOptions()) : null;
  const today = payrollToday();

  return (
    <PageContainer width="full">
      <PageHeader title="Payroll" description="Monthly rates and the lines each person is paid on. Each change is a new version with a start date." />
      <PayrollTabs current="rates" />
      <RatesTable rows={rows} options={options} today={today} />
    </PageContainer>
  );
}
