import type { Metadata } from "next";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { MakeupPanel } from "@/modules/attendance/components/makeup-panel";
import { getMyMakeup, listMakeupQueue } from "@/modules/attendance/makeup-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Make-up hours" };

export default async function MakeupHoursPage() {
  const user = await requireUser();
  const scope = scopeFor(user, "makeup.decide");
  const canReview = scope === "all" || scope === "team";
  const mine = await orNotFound(getMyMakeup());
  const queue = canReview ? await orNotFound(listMakeupQueue()) : null;
  return (
    <PageContainer>
      <PageHeader
        title="Make-up hours"
        description="Missed hours? Ask to make them up in another window before you work it. Your lead approves, and the time counts as regular hours, not extra hours."
      />
      <MakeupPanel mine={mine} queue={queue} />
    </PageContainer>
  );
}
