import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { payrollToday } from "@/modules/payroll/service";
import { PayrollTabs } from "@/modules/payroll/components/payroll-tabs";
import { SettingsView } from "@/modules/payroll/components/settings-form";
import { getPaySettings } from "@/modules/payroll/queries";

export const metadata: Metadata = { title: "Payroll settings" };

export default async function PayrollSettingsPage() {
  await requireUser();
  const view = await orNotFound(getPaySettings()); // authorize("payroll.view") inside
  const today = payrollToday();

  return (
    <PageContainer width="wide">
      <PageHeader title="Payroll" description="The cutoff divisor, extra-hours rates and the change warning. Each change is a new version with a start date." />
      <PayrollTabs current="settings" />
      <SettingsView view={view} today={today} />
    </PageContainer>
  );
}
