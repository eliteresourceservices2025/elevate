import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo, parsePaging } from "@/lib/pagination";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ActivityTabs } from "@/modules/activity/components/activity-tabs";
import { DevicesTable } from "@/modules/activity/components/devices-table";
import { listAllDevices } from "@/modules/activity/queries";

export const metadata: Metadata = { title: "Activity devices" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

// HR Admin and Super Admin only. Anyone else gets a 404. No loading.tsx: this route can call notFound().
export default async function ActivityDevicesPage({ searchParams }: PageProps<"/activity/devices">) {
  const user = await requireUser();
  if (!scopeFor(user, "activity.manage")) notFound();
  const params = await searchParams;
  const filter = one(params.filter) === "attention" ? "attention" : "all";
  const paging = parsePaging({ page: params.page, size: params.size });
  const found = await orNotFound(listAllDevices({ filter, page: paging.page, pageSize: paging.pageSize }));
  const info = pageInfo(found.total, paging.page, paging.pageSize);

  return (
    <PageContainer>
      <PageHeader title="Activity" description="Every computer with the ELEVATE Tracker App, and which ones need a look." />
      <ActivityTabs current="devices" canManage />
      <nav aria-label="Filter devices" className="flex gap-2 text-sm">
        <Link href="/activity/devices" aria-current={filter === "all" ? "page" : undefined} className={cn("rounded-lg border px-3 py-1.5", filter === "all" && "bg-muted font-medium")}>
          All
        </Link>
        <Link href="/activity/devices?filter=attention" aria-current={filter === "attention" ? "page" : undefined} className={cn("rounded-lg border px-3 py-1.5", filter === "attention" && "bg-muted font-medium")}>
          Needs attention
        </Link>
      </nav>
      {found.rows.length === 0 ? (
        <EmptyState icon={Camera} title={filter === "attention" ? "Nothing needs attention" : "No computers yet"} description={filter === "attention" ? "Every signed-in computer has reported in the last day with its permissions in place." : "People add their computer from their Attendance page."} />
      ) : (
        <>
          <DevicesTable rows={found.rows} zone={DEFAULT_TIMEZONE} latestVersion={found.latestVersion} />
          <PagerLinks info={info} basePath="/activity/devices" query={{ filter: filter === "attention" ? "attention" : undefined }} label="computers" />
        </>
      )}
    </PageContainer>
  );
}
