import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { AdminBento } from "@/modules/dashboard/components/admin-bento";
import { ExecutiveBento } from "@/modules/dashboard/components/executive-bento";
import { GreetingHeader } from "@/modules/dashboard/components/greeting-header";
import { HrBento } from "@/modules/dashboard/components/hr-bento";
import { MyWorkBento } from "@/modules/dashboard/components/my-work-bento";
import { QuickActions } from "@/modules/dashboard/components/quick-actions";
import { RecruiterBento } from "@/modules/dashboard/components/recruiter-bento";
import { TeamLeadBento } from "@/modules/dashboard/components/team-lead-bento";
import { LENS_COOKIE, availableLenses, pickLens } from "@/modules/dashboard/lens";

export const metadata: Metadata = { title: "Dashboard" };

// Many small reads, so give the page room if the database is slow; each tile streams in as it finishes.
export const maxDuration = 60;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });

  const asked = (await searchParams).view;
  const saved = (await cookies()).get(LENS_COOKIE)?.value;
  const lenses = availableLenses(user.roles);
  const lens = pickLens(user.roles, Array.isArray(asked) ? asked[0] : asked, saved);

  const quickActions = <QuickActions user={user} lens={lens} />;

  return (
    <PageContainer>
      <Suspense fallback={<PageHeader title="Dashboard" actions={quickActions} />}>
        <GreetingHeader roles={user.roles} lenses={lenses} lens={lens} actions={quickActions} />
      </Suspense>

      {lens === "my_work" ? (
        <MyWorkBento />
      ) : lens === "team_lead" ? (
        <TeamLeadBento />
      ) : lens === "hr" ? (
        <HrBento />
      ) : lens === "executive" ? (
        <ExecutiveBento />
      ) : lens === "recruiter" ? (
        <RecruiterBento />
      ) : (
        <AdminBento />
      )}
    </PageContainer>
  );
}
