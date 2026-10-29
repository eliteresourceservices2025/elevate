import type { Metadata } from "next";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { ApprovalsWorkspace } from "@/modules/dashboard/components/approvals-workspace";
import { getApprovalQueue } from "@/modules/dashboard/feed-queries";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await requireUser();
  const canReviewHours = ["all", "team"].includes(String(scopeFor(user, "hours.approve")));
  const [items, hours] = await Promise.all([
    getApprovalQueue(),
    canReviewHours ? getTeamReview().then((review) => review.pending) : Promise.resolve(0),
  ]);
  return (
    <PageContainer width="medium">
      <PageHeader title="Approvals" description="Routine decisions in one place. Confidential reports stay in their own protected queues." />
      <ApprovalsWorkspace items={items} hoursWaiting={hours} />
    </PageContainer>
  );
}
