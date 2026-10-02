"use client";

/* eslint-disable security/detect-object-injection -- keys are question ids from the cycle's own list */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { acknowledgeReview, calibrateReview, closeReviewCycle, reassignReviewer, shareCycleReviews, shareReview, submitLeadReview, submitSelfReview } from "../actions";
import { RATINGS, RATING_LABELS, type Answers, type Question } from "../constants";

const sections = (qs: Question[]) => [...new Set(qs.map((q) => q.section))];

/** The self or lead review form: ratings as radio buttons, text boxes, an overall rating and comments. */
export function ReviewForm({ reviewId, questions, role }: { reviewId: string; questions: Question[]; role: "self" | "lead" }) {
  const { run, pending } = useRun();
  const [answers, setAnswers] = useState<Answers>({});
  const [overall, setOverall] = useState("");
  const [comments, setComments] = useState("");
  const set = (id: string, patch: { rating?: number; text?: string }) => setAnswers((a) => ({ ...a, [id]: { ...a[id], ...patch } }));
  return (
    <form
      className="space-y-5 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fn = role === "self" ? submitSelfReview : submitLeadReview;
        run(() => fn({ reviewId, answers, overallRating: overall, comments }), role === "self" ? "Self review submitted." : "Review submitted.");
      }}
    >
      <h2 className="text-lg font-semibold">{role === "self" ? "Your self review" : "Your review"}</h2>
      <p className="text-sm text-muted-foreground">Once submitted it cannot be edited. Please do not include client or patient information.</p>
      {sections(questions).map((section) => (
        <fieldset key={section} className="space-y-4">
          <legend className="font-medium">{section}</legend>
          {questions
            .filter((q) => q.section === section)
            .map((q) =>
              q.type === "rating" ? (
                <div key={q.id} role="radiogroup" aria-label={q.prompt} className="space-y-1">
                  <p className="text-sm">
                    {q.prompt}
                    {q.required ? " *" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {RATINGS.map((n) => (
                      <label key={n} className="flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                        <input type="radio" name={`q-${q.id}`} checked={answers[q.id]?.rating === n} onChange={() => set(q.id, { rating: n })} />
                        {n} <span className="text-xs text-muted-foreground">{RATING_LABELS[n]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div key={q.id} className="space-y-1">
                  <Label htmlFor={`q-${q.id}`}>
                    {q.prompt}
                    {q.required ? " *" : ""}
                  </Label>
                  <Textarea id={`q-${q.id}`} value={answers[q.id]?.text ?? ""} onChange={(e) => set(q.id, { text: e.target.value })} maxLength={4000} />
                </div>
              ),
            )}
        </fieldset>
      ))}
      <div className="space-y-1">
        <Label htmlFor="overall">Overall rating{role === "lead" ? " *" : " (optional)"}</Label>
        <NativeSelect id="overall" value={overall} onChange={(e) => setOverall(e.target.value)}>
          <option value="">{role === "lead" ? "Use the average of my ratings" : "None"}</option>
          {RATINGS.map((n) => (
            <option key={n} value={n}>
              {n}: {RATING_LABELS[n]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="comments">Comments</Label>
        <Textarea id="comments" value={comments} onChange={(e) => setComments(e.target.value)} maxLength={4000} />
      </div>
      <Button type="submit" disabled={pending}>
        Submit
      </Button>
    </form>
  );
}

export function CalibrateForm({ reviewId, suggested, shareable, calibrated }: { reviewId: string; suggested: number | null; shareable: boolean; calibrated: boolean }) {
  const { run, pending } = useRun();
  const [finalRating, setFinal] = useState(String(suggested ?? 3));
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">HR calibration</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => calibrateReview({ reviewId, finalRating, summary, changeReason: reason }), "Calibration saved.");
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="final">Final rating</Label>
          <NativeSelect id="final" value={finalRating} onChange={(e) => setFinal(e.target.value)}>
            {RATINGS.map((n) => (
              <option key={n} value={n}>
                {n}: {RATING_LABELS[n]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cal-reason">Reason for changing the lead&apos;s rating (needed if it differs)</Label>
          <Textarea id="cal-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cal-summary">Summary the person will read</Label>
          <Textarea id="cal-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
        </div>
        <Button type="submit" disabled={pending}>
          Save calibration
        </Button>
      </form>
      {shareable && calibrated ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => shareReview({ reviewId }), "Shared with the person.")}>
          Share with the person
        </Button>
      ) : null}
    </div>
  );
}

export function AcknowledgeForm({ reviewId }: { reviewId: string }) {
  const { run, pending } = useRun();
  const [comment, setComment] = useState("");
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => acknowledgeReview({ reviewId, comment }), "Acknowledged.");
      }}
    >
      <h2 className="text-lg font-semibold">Acknowledge</h2>
      <p className="text-sm text-muted-foreground">Acknowledging means you have read this review. It does not mean you agree with it, and you can add a comment.</p>
      <div className="space-y-1">
        <Label htmlFor="ack-comment">Comment (optional)</Label>
        <Textarea id="ack-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </div>
      <Button type="submit" disabled={pending}>
        I have read this review
      </Button>
    </form>
  );
}

export function ReassignForm({ reviewId, options }: { reviewId: string; options: { userId: string; name: string }[] }) {
  const { run, pending } = useRun();
  const [leadUserId, setLead] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reassignReviewer({ reviewId, leadUserId }), "Reviewer changed.");
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="reassign">Give the lead&apos;s review to someone else</Label>
        <NativeSelect id="reassign" value={leadUserId} onChange={(e) => setLead(e.target.value)}>
          <option value="">Choose a person</option>
          {options.map((o) => (
            <option key={o.userId} value={o.userId}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" disabled={pending || !leadUserId}>
        Change reviewer
      </Button>
    </form>
  );
}

export function CycleControls({ cycleId, open }: { cycleId: string; open: boolean }) {
  const { run, pending } = useRun();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => shareCycleReviews({ cycleId }), (d) => `${(d as { shared: number } | undefined)?.shared ?? 0} shared.`)}>
        Share all calibrated reviews
      </Button>
      {open ? (
        <Button variant="ghost" disabled={pending} onClick={() => run(() => closeReviewCycle({ cycleId }), "Cycle closed.")}>
          Close cycle
        </Button>
      ) : null}
    </div>
  );
}
