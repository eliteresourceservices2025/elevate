import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { addDays } from "@/modules/attendance/schedule";
import { FLAG_LABELS } from "@/modules/attendance/flag-labels";
import { ReviewPanel } from "@/modules/attendance/components/hours-panels";
import { getTeamReview } from "@/modules/attendance/hours-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Hours review" };

export default async function HoursReviewPage({ searchParams }: PageProps<"/hours-review">) {
  await requireUser();
  const params = await searchParams;
  const review = await orNotFound(getTeamReview(typeof params.rweek === "string" ? params.rweek : undefined));
  return (
    <PageContainer>
      <PageHeader title="Hours review" description="Check each week and approve it. Approved hours are what HR exports for payroll." />
      <ReviewPanel review={review} prevHref={`/hours-review?rweek=${addDays(review.weekStart, -7)}`} nextHref={`/hours-review?rweek=${addDays(review.weekStart, 7)}`} flagLabels={Object.fromEntries(FLAG_LABELS)} />
    </PageContainer>
  );
}
