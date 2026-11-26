import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { PersonScheduleView, ScheduleHeaderButtons } from "@/modules/attendance/components/person-schedule";
import { getPersonSchedule } from "@/modules/attendance/queries";

export const metadata: Metadata = { title: "Schedule" };

export default async function PersonSchedulePage({ params, searchParams }: PageProps<"/schedules/[employeeId]">) {
  const user = await requireUser();
  const { employeeId } = await params;
  const { week } = await searchParams;
  const data = await orNotFound(getPersonSchedule(employeeId, typeof week === "string" ? week : undefined));
  // A person who can only see their own has no list to go back to beyond their own page.
  const crumb = scopeFor(user, "schedules.view") === "own" ? "My schedule" : "Schedules";

  return (
    <PageContainer>
      <PageHeader
        title={data.name}
        description="Their schedules, in the client's time zone and in Manila time."
        breadcrumbs={[{ label: crumb, href: "/schedules" }, { label: data.name }]}
        actions={data.canManage ? <ScheduleHeaderButtons data={data} /> : undefined}
      />
      <PersonScheduleView data={data} basePath={`/schedules/${data.employeeId}`} />
    </PageContainer>
  );
}
