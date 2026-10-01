import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { addDays } from "@/modules/attendance/schedule";
import { FLAG_LABELS } from "@/modules/attendance/flag-labels";
import { ReviewPanel } from "@/modules/attendance/components/hours-panels";
import { getTeamReview } from "@/modules/attendance/hours-queries";

export const metadata: Metadata = { title: "Hours review" };

export default async function HoursReviewPage({ searchParams }: PageProps<"/hours-review">) {
  await requireUser();
  const params = await searchParams;
  const review = await orNotFound(getTeamReview(typeof params.rweek === "string" ? params.rweek : undefined));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hours review</h1>
        <p className="mt-1 text-muted-foreground">Check each week and approve it. Approved hours are what HR exports for payroll.</p>
      </div>
      <ReviewPanel review={review} prevHref={`/hours-review?rweek=${addDays(review.weekStart, -7)}`} nextHref={`/hours-review?rweek=${addDays(review.weekStart, 7)}`} flagLabels={Object.fromEntries(FLAG_LABELS)} />
    </div>
  );
}
