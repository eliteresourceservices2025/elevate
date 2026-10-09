import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { AcknowledgeForm, CalibrateForm, ReassignForm, ReviewForm } from "@/modules/reviews/components/review-forms";
import { ReviewAnswers } from "@/modules/reviews/components/review-view";
import { RATING_LABELS, STAGE_LABELS } from "@/modules/reviews/constants";
import { getReview } from "@/modules/reviews/queries";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/reviews/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const r = await orNotFound(getReview(id));
  const lead = r.lead;
  const suggested = lead?.overallRating ?? null;

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/reviews" className="text-sm text-primary underline-offset-2 hover:underline">
          All reviews
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {r.isPerson ? "Your review" : `Review: ${r.name}`}
        </h1>
        <p className="text-muted-foreground">
          {r.cycleName}
          {r.milestone ? ` (month ${r.milestone})` : ""}. {STAGE_LABELS[r.stage]}.
        </p>
        <p className="text-sm text-muted-foreground">
          Due: self review {formatDateOnly(r.dues.self)}, lead review {formatDateOnly(r.dues.lead)}, calibration {formatDateOnly(r.dues.calibrate)}.
          {r.leadName && r.viewer !== "person" ? ` Lead: ${r.leadName}.` : ""} {r.cycleOpen ? "" : "This cycle is closed."}
        </p>
      </div>

      {r.calibration ? (
        <section aria-label="Result" className="space-y-1 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="text-sm">
            <strong>Final rating:</strong> {r.calibration.finalRating}: {RATING_LABELS[r.calibration.finalRating]}
          </p>
          {r.calibration.summary ? <p className="whitespace-pre-wrap text-sm">{r.calibration.summary}</p> : null}
          {r.calibration.changeReason ? <p className="text-sm text-muted-foreground">Why HR changed the lead&apos;s rating: {r.calibration.changeReason}</p> : null}
        </section>
      ) : null}

      {r.self ? <ReviewAnswers title="Self review" response={r.self} questions={r.questions} /> : null}
      {lead ? <ReviewAnswers title="Lead's review" response={lead} questions={r.questions} /> : null}
      {r.leadRatingHidden ? <p className="text-sm text-muted-foreground">HR set the final rating above. Your lead&apos;s written feedback is shown as written.</p> : null}

      {r.acknowledgment ? (
        <p className="text-sm text-muted-foreground">
          Acknowledged on {r.acknowledgment.acknowledgedAt.toISOString().slice(0, 10)}.{r.acknowledgment.comment ? ` Comment: ${r.acknowledgment.comment}` : ""}
        </p>
      ) : null}

      {r.canWriteSelf ? <ReviewForm reviewId={r.id} questions={r.questions} role="self" /> : null}
      {r.isPerson && !r.self && !r.canWriteSelf ? <p className="text-sm text-muted-foreground">There is no self review to write.</p> : null}
      {r.canWriteLead ? <ReviewForm reviewId={r.id} questions={r.questions} role="lead" /> : null}
      {r.canCalibrate ? <CalibrateForm reviewId={r.id} suggested={suggested} shareable={r.canShare} calibrated={r.stage === "ready_to_share"} /> : null}
      {r.canAcknowledge ? <AcknowledgeForm reviewId={r.id} /> : null}
      {r.canReassign ? <ReassignForm reviewId={r.id} options={r.leadOptions} /> : null}
    </div>
  );
}
