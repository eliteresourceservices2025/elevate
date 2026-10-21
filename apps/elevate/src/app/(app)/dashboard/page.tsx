import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { ApprovalQueue } from "@/modules/dashboard/components/approval-queue";
import { AttentionFeed } from "@/modules/dashboard/components/attention-feed";
import { GreetingHeader } from "@/modules/dashboard/components/greeting-header";
import { KpiCards, KpiCardsSkeleton } from "@/modules/dashboard/components/kpi-cards";
import { QuickActions } from "@/modules/dashboard/components/quick-actions";
import { RiskCards } from "@/modules/dashboard/components/risk-cards";
import { Tracker } from "@/modules/dashboard/components/tracker";
import { LatestAnnouncements, WaitingForYou } from "@/modules/dashboard/components/waiting-and-news";
import { WhosOut } from "@/modules/dashboard/components/whos-out";
import { WorkforceOverview } from "@/modules/dashboard/components/workforce-overview";
import { LENS_COOKIE, availableLenses, pickLens } from "@/modules/dashboard/lens";

export const metadata: Metadata = { title: "Dashboard" };

// Many small reads, so give the page room if the database is slow; each panel streams in as it finishes.
export const maxDuration = 60;

const Loading = ({ height = "h-40" }: { height?: string }) => <Skeleton className={`${height} rounded-2xl`} />;

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });

  const asked = (await searchParams).view;
  const saved = (await cookies()).get(LENS_COOKIE)?.value;
  const lenses = availableLenses(user.roles);
  const lens = pickLens(user.roles, Array.isArray(asked) ? asked[0] : asked, saved);

  const showApprovals = lens === "admin" || lens === "hr" || lens === "team_lead";
  const showAttention = lens !== "executive";
  const showRisks = lens !== "my_work";
  const showTracker = lens === "admin" || lens === "hr" || lens === "team_lead";
  const showWorkforce = showTracker || lens === "executive";
  // The Executive has no approvals or attention list, so the warnings take the left column.
  const risks = showRisks ? (
    <Suspense fallback={<Loading />}>
      <RiskCards lens={lens} />
    </Suspense>
  ) : null;

  const quickActions = <QuickActions user={user} lens={lens} />;

  return (
    <PageContainer>
      <Suspense fallback={<PageHeader title="Dashboard" actions={quickActions} />}>
        <GreetingHeader roles={user.roles} lenses={lenses} lens={lens} actions={quickActions} />
      </Suspense>

      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards lens={lens} />
      </Suspense>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {showApprovals ? (
            <Suspense fallback={<Loading />}>
              <ApprovalQueue />
            </Suspense>
          ) : null}
          {showAttention ? (
            <Suspense fallback={<Loading />}>
              <AttentionFeed lens={lens} />
            </Suspense>
          ) : null}
          {lens === "executive" ? risks : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={<Loading height="h-56" />}>
            <WhosOut />
          </Suspense>
          {lens !== "executive" ? risks : null}
        </div>
      </div>

      {showTracker || showWorkforce ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {showTracker ? (
            <Suspense fallback={<Loading height="h-56" />}>
              <Tracker />
            </Suspense>
          ) : null}
          {showWorkforce ? (
            <Suspense fallback={<Loading height="h-56" />}>
              <WorkforceOverview />
            </Suspense>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<Loading />}>
            <WaitingForYou />
          </Suspense>
        </div>
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<Loading />}>
            <LatestAnnouncements />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}
