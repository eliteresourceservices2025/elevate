import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import type { TileDef } from "@/modules/dashboard/bento-tiles";
import { ADMIN_TILES, AdminBento } from "@/modules/dashboard/components/admin-bento";
import { EditLayout } from "@/modules/dashboard/components/edit-layout";
import { EXECUTIVE_TILES, ExecutiveBento } from "@/modules/dashboard/components/executive-bento";
import { GreetingHeader } from "@/modules/dashboard/components/greeting-header";
import { HR_TILES, HrBento } from "@/modules/dashboard/components/hr-bento";
import { MY_WORK_TILES, MyWorkBento } from "@/modules/dashboard/components/my-work-bento";
import { QuickActions } from "@/modules/dashboard/components/quick-actions";
import { RECRUITER_TILES, RecruiterBento } from "@/modules/dashboard/components/recruiter-bento";
import { TEAM_LEAD_TILES, TeamLeadBento } from "@/modules/dashboard/components/team-lead-bento";
import { getLayout } from "@/modules/dashboard/layout-service";
import { LENS_COOKIE, availableLenses, pickLens, type Lens } from "@/modules/dashboard/lens";

export const metadata: Metadata = { title: "Dashboard" };

// Many small reads, so give the page room if the database is slow; each tile streams in as it finishes.
export const maxDuration = 60;

const TILES: Record<Lens, TileDef[]> = {
  my_work: MY_WORK_TILES,
  team_lead: TEAM_LEAD_TILES,
  hr: HR_TILES,
  executive: EXECUTIVE_TILES,
  recruiter: RECRUITER_TILES,
  admin: ADMIN_TILES,
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireUser();
  await authorize(user, "dashboard.view", { ownerUserId: user.id });

  const asked = (await searchParams).view;
  const saved = (await cookies()).get(LENS_COOKIE)?.value;
  const lenses = availableLenses(user.roles);
  const lens = pickLens(user.roles, Array.isArray(asked) ? asked[0] : asked, saved);

  // The person's own hide and reorder choices for this view (a preference: the tiles still decide what they may show).
  const layout = await getLayout(user, lens).catch(() => null);
  const edit = <EditLayout view={lens} tiles={TILES[lens].map(({ id, label }) => ({ id, label }))} layout={layout} />;
  const quickActions = <QuickActions user={user} lens={lens} />;

  return (
    <PageContainer>
      <Suspense fallback={<PageHeader title="Dashboard" actions={quickActions} />}>
        <GreetingHeader roles={user.roles} lenses={lenses} lens={lens} actions={quickActions} />
      </Suspense>

      {lens === "my_work" ? (
        <div className="space-y-3">
          <div className="flex justify-end">{edit}</div>
          <MyWorkBento layout={layout} />
        </div>
      ) : lens === "team_lead" ? (
        <TeamLeadBento layout={layout} meActions={edit} />
      ) : lens === "hr" ? (
        <HrBento layout={layout} meActions={edit} />
      ) : lens === "executive" ? (
        <ExecutiveBento layout={layout} meActions={edit} />
      ) : lens === "recruiter" ? (
        <RecruiterBento layout={layout} meActions={edit} />
      ) : (
        <AdminBento layout={layout} meActions={edit} />
      )}
    </PageContainer>
  );
}
