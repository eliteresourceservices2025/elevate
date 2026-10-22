import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { AnalyticsDashboard } from "@/modules/analytics/components/dashboard";
import { getDashboard } from "@/modules/analytics/queries";
import { SelfIdSummary } from "@/modules/demographics/components/self-id-summary";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await orNotFound(getDashboard(params));
  return (
    <PageContainer>
      <PageHeader title="Analytics" description="Headcount, turnover, time off, attendance and hiring. Totals only, read-only." />
      <AnalyticsDashboard data={data} canExport={can(user, "analytics.export")} />
      {can(user, "demographics.view_summary") ? <SelfIdSummary /> : null}
    </PageContainer>
  );
}
