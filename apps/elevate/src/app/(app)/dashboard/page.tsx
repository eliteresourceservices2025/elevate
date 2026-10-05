import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DueBadge } from "@/modules/announcements/components/ack-display";
import { listAnnouncements, listMyPending } from "@/modules/announcements/queries";
import { ApprovalQueue } from "@/modules/dashboard/components/approval-queue";
import { AttentionFeed } from "@/modules/dashboard/components/attention-feed";
import { GreetingHeader } from "@/modules/dashboard/components/greeting-header";
import { KpiCards, KpiCardsSkeleton } from "@/modules/dashboard/components/kpi-cards";
import { RiskCards } from "@/modules/dashboard/components/risk-cards";
import { QuickActions } from "@/modules/dashboard/components/quick-actions";
import { Tracker } from "@/modules/dashboard/components/tracker";
import { WhosOut } from "@/modules/dashboard/components/whos-out";
import { WorkforceOverview } from "@/modules/dashboard/components/workforce-overview";
import { LENS_COOKIE, availableLenses, pickLens } from "@/modules/dashboard/lens";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });

  const asked = (await searchParams).view;
  const saved = (await cookies()).get(LENS_COOKIE)?.value;
  const lenses = availableLenses(user.roles);
  const lens = pickLens(user.roles, Array.isArray(asked) ? asked[0] : asked, saved);

  const [pending, latest] = await Promise.all([listMyPending(), listAnnouncements({ limit: 3 })]);
  const today = todayInZone();
  const showApprovals = lens === "admin" || lens === "hr" || lens === "team_lead";
  const showAttention = lens !== "executive";
  const showRisks = lens !== "my_work";
  const showTracker = lens === "admin" || lens === "hr" || lens === "team_lead";
  const showWorkforce = showTracker || lens === "executive";
  // The Executive has no approvals or attention list, so the warnings take the left column.
  const risks = showRisks ? (
    <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
      <RiskCards lens={lens} />
    </Suspense>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Suspense fallback={<div className="h-20" aria-hidden />}>
        <GreetingHeader roles={user.roles} lenses={lenses} lens={lens} />
      </Suspense>

      <Suspense fallback={<KpiCardsSkeleton />}>
        <KpiCards lens={lens} />
      </Suspense>

      <QuickActions user={user} lens={lens} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {showApprovals ? (
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <ApprovalQueue />
            </Suspense>
          ) : null}
          {showAttention ? (
            <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
              <AttentionFeed lens={lens} />
            </Suspense>
          ) : null}
          {lens === "executive" ? risks : null}
        </div>

        <div className="min-w-0 space-y-6">
          <Suspense fallback={<Skeleton className="h-56 rounded-xl" />}>
            <WhosOut />
          </Suspense>
          {lens !== "executive" ? risks : null}
        </div>
      </div>

      {showTracker || showWorkforce ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {showTracker ? (
            <Suspense fallback={<Skeleton className="h-56 rounded-xl" />}>
              <Tracker />
            </Suspense>
          ) : null}
          {showWorkforce ? (
            <Suspense fallback={<Skeleton className="h-56 rounded-xl" />}>
              <WorkforceOverview />
            </Suspense>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          {pending.length > 0 ? (
            <section aria-label="Waiting for you" className="space-y-2">
              <h2 className="text-lg font-semibold">Waiting for you</h2>
              <ul className="space-y-2">
                {pending.slice(0, 5).map((p) => (
                  <li key={`${p.kind}-${p.versionId ?? p.id}`}>
                    <Link href={p.link} className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="font-medium">{p.title}</span>
                      <Badge variant="outline">{p.kind === "policy" ? `Policy, version ${p.version}` : "Announcement"}</Badge>
                      <DueBadge due={p.due} dueOn={p.dueOn} today={today} />
                    </Link>
                  </li>
                ))}
              </ul>
              {pending.length > 5 ? (
                <p className="text-sm text-muted-foreground">
                  {pending.length - 5} more.{" "}
                  <Link href="/announcements" className="text-primary underline-offset-4 hover:underline">
                    See everything waiting
                  </Link>
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {latest.length > 0 ? (
            <section aria-label="Latest announcements" className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">Latest announcements</h2>
                <Link href="/announcements" className="text-sm text-primary underline-offset-4 hover:underline">
                  See all
                </Link>
              </div>
              <ul className="space-y-2">
                {latest.map((a) => (
                  <li key={a.id}>
                    <Link href={`/announcements/${a.id}`} className="block rounded-xl border bg-card p-3 outline-none hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex items-center gap-2 font-medium">
                        {a.pinned ? <Pin className="size-4 text-primary" aria-label="Pinned" /> : null}
                        {a.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
