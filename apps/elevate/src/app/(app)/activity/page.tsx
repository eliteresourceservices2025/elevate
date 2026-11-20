import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { cn } from "@/lib/utils";
import { ActivityTabs } from "@/modules/activity/components/activity-tabs";
import { FloorCounts, FloorGrid, countStates, isFloorState } from "@/modules/activity/components/floor-grid";
import { AutoRefresh } from "@/modules/attendance/components/auto-refresh";
import { listFloor } from "@/modules/activity/queries";

export const metadata: Metadata = { title: "Activity" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// Leads (their team) and HR/Super Admin. Anyone else gets a 404, like a page that does not exist. No loading.tsx: this route can call notFound().
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const user = await requireUser();
  const scope = scopeFor(user, "activity.view");
  if (scope !== "team" && scope !== "all") notFound();
  const params = await searchParams;
  const stateParam = one(params.state);
  const state = isFloorState(stateParam) ? stateParam : undefined;
  const teamParam = one(params.team);
  const teamId = teamParam && UUID.test(teamParam) ? teamParam : undefined;
  const attention = one(params.attention) === "1";

  const all = await orNotFound(listFloor({ teamId }));
  const counts = countStates(all);
  const shown = all.filter((r) => (state ? r.state === state : true) && (attention ? r.state === "offline" || (r.state === "idle" && r.minutesInState >= 15) : true));
  const canManage = scopeFor(user, "activity.manage") !== null;

  return (
    <PageContainer>
      <AutoRefresh seconds={60} />
      <PageHeader
        title="Activity"
        description="Who is working right now, from the ELEVATE Tracker App. It records only while someone is clocked in, and only the app name."
      />
      <ActivityTabs current="live" canManage={canManage} />
      <FloorCounts counts={counts} current={state} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={attention ? "/activity" : "/activity?attention=1"}
          aria-pressed={attention}
          className={cn("rounded-lg border px-3 py-1.5", attention && "bg-muted font-medium")}
        >
          {attention ? "Showing only people who need attention" : "Show only people who need attention"}
        </Link>
        <p className="text-muted-foreground">Updates every minute.</p>
      </div>
      <FloorGrid rows={shown} />
    </PageContainer>
  );
}
