import type { Metadata } from "next";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { AnalyticsDashboard } from "@/modules/analytics/components/dashboard";
import { getDashboard } from "@/modules/analytics/queries";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const user = await requireUser();
  const params = await searchParams;
  const data = await orNotFound(getDashboard(params));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="mt-1 text-muted-foreground">Headcount, turnover, time off, attendance and hiring. Totals only, read-only.</p>
      </div>
      <AnalyticsDashboard data={data} canExport={can(user, "analytics.export")} />
    </div>
  );
}
