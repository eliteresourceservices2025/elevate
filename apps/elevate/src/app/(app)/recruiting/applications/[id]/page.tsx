import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { formatInZone, SECONDARY_TIMEZONE } from "@/lib/time";
import { CancelInterviewButton, InterviewForm, MoveControls, NoteForm, RejectForm, ResumeViewer, ScorecardForm } from "@/modules/recruiting/components/application-panels";
import { CRITERIA, INTERVIEW_KIND_LABELS, RECOMMENDATION_LABELS, STAGE_LABELS, averageRating, type Recommendation } from "@/modules/recruiting/constants";
import { scopeFor } from "@/lib/authz";
import { OfferPanel } from "@/modules/offers/components/offer-panel";
import { getOfferPanel } from "@/modules/offers/queries";
import { getApplication, getCalendarCard, listInterviewerChoices } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Applicant" };

const REC_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = { strong_yes: "default", yes: "default", no: "secondary", strong_no: "destructive" };

export default async function ApplicationPage({ params }: PageProps<"/recruiting/applications/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await orNotFound(getApplication(id));
  const { application: app, candidate, opening } = data;
  const open = app.stage !== "rejected" && app.stage !== "hired";
  const people = data.canInterview ? await orNotFound(listInterviewerChoices()) : [];
  // The scheduler's own Google Calendar connection (only HR, Super Admin and recruiters can have one)
  const calendar = data.canInterview && scopeFor(user, "recruiting.connect_calendar") ? await orNotFound(getCalendarCard()) : { connected: false, needsReconnect: false };
  const name = candidate.removed ? "Removed applicant" : candidate.name;
  const offerPanel = !candidate.removed && scopeFor(user, "offers.view") ? await orNotFound(getOfferPanel(app.id)) : null;

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href={`/recruiting/${opening.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
          ← {opening.title}
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold">
          {name}
          <Badge variant={app.stage === "hired" ? "default" : app.stage === "rejected" ? "destructive" : "secondary"}>{STAGE_LABELS[app.stage]}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Applied {formatInZone(app.appliedAt, undefined, "MMM d, yyyy")} for {opening.title}.
          {app.stage === "rejected" ? ` ${app.closeKind === "withdrawn" ? "The applicant withdrew." : "Not moving forward."}${app.closeReason ? ` Reason: ${app.closeReason}` : ""}` : ""}
        </p>
      </div>

      <section aria-label="Applicant" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Applicant</h2>
        {candidate.removed ? (
          <p className="text-sm text-muted-foreground">Their personal data was removed under the retention period.</p>
        ) : (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div>
                <dt className="inline text-muted-foreground">Email: </dt>
                <dd className="inline">{candidate.email}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Phone: </dt>
                <dd className="inline">{candidate.phone ?? "-"}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Country: </dt>
                <dd className="inline">{candidate.country ?? "-"}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Agreed to the privacy notice: </dt>
                <dd className="inline">
                  {formatInZone(candidate.consentAt, undefined, "MMM d, yyyy")}
                  {candidate.consentVersion ? ` (${candidate.consentVersion})` : ""}
                </dd>
              </div>
            </dl>
            {app.note ? <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-sm">{app.note}</p> : null}
            {candidate.hasResume ? <ResumeViewer applicationId={app.id} kind={candidate.resumeKind} /> : null}
          </>
        )}
      </section>

      {data.canMove ? (
        <section aria-label="Stage" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Stage</h2>
          {app.stage === "hired" ? <p className="text-sm text-muted-foreground">Hired. Creating the person record and onboarding comes with offers.</p> : <MoveControls applicationId={app.id} stage={app.stage} />}
          {open ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-destructive">Close this application</summary>
              <div className="mt-3">
                <RejectForm applicationId={app.id} sendRejection={opening.sendRejection} />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {offerPanel ? <OfferPanel applicationId={app.id} panel={offerPanel} /> : null}

      <section aria-label="Interviews" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Interviews and scorecards</h2>
        {data.interviews.length === 0 ? <p className="text-sm text-muted-foreground">No interviews yet.</p> : null}
        <ul className="space-y-4">
          {data.interviews.map((i) => {
            const started = i.startsAt.getTime() <= data.nowMs;
            return (
              <li key={i.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{INTERVIEW_KIND_LABELS[i.kind as keyof typeof INTERVIEW_KIND_LABELS] ?? i.kind}</span>
                  {i.status === "cancelled" ? <Badge variant="destructive">Cancelled</Badge> : null}
                  {i.calendarMode === "google" ? <Badge variant="outline">On Google Calendar</Badge> : null}
                  <span className="text-sm">
                    {formatInZone(i.startsAt, undefined, "EEE MMM d, h:mm a")} ({i.minutes} min) · {formatInZone(i.startsAt, SECONDARY_TIMEZONE, "h:mm a")} Manila
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {i.location}. Interviewers: {i.interviewers.map((p) => p.name).join(", ")}.
                  {i.meetLink ? (
                    <>
                      {" "}
                      <a href={i.meetLink} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
                        Join with Google Meet
                      </a>
                    </>
                  ) : null}
                </p>
                {i.note ? <p className="text-sm">{i.note}</p> : null}
                {data.canInterview && i.status === "scheduled" && !started ? <CancelInterviewButton interviewId={i.id} /> : null}

                {i.scorecards.length > 0 ? (
                  <ul className="space-y-2">
                    {i.scorecards.map((s) => (
                      <li key={s.id} className="space-y-1 rounded-md bg-muted/40 p-2 text-sm">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {s.interviewerName}
                          {s.mine ? <span className="text-xs font-normal text-muted-foreground">(you)</span> : null}
                          <Badge variant={REC_VARIANT[s.recommendation] ?? "outline"}>{RECOMMENDATION_LABELS[s.recommendation as Recommendation] ?? s.recommendation}</Badge>
                          <span className="text-xs font-normal text-muted-foreground">average {averageRating(s.ratings) ?? "-"} of 5</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{CRITERIA.map((c) => `${c.label} ${s.ratings[c.key] ?? "-"}`).join(" · ")}</p>
                        <p className="whitespace-pre-wrap">{s.comments}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {i.scorecardsHidden ? <p className="text-sm text-muted-foreground">Other interviewers have submitted. You see their scorecards after you submit yours.</p> : null}
                {i.status === "scheduled" && started && i.iAmInterviewer && !i.mySubmitted ? <ScorecardForm interviewId={i.id} /> : null}
                {i.status === "scheduled" && started && i.waitingOn > 0 && i.scorecards.length > 0 ? <p className="text-xs text-muted-foreground">Waiting on {i.waitingOn} more {i.waitingOn === 1 ? "scorecard" : "scorecards"}.</p> : null}
              </li>
            );
          })}
        </ul>
        {data.canInterview && open ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Schedule an interview</summary>
            <div className="mt-3">
              <InterviewForm applicationId={app.id} people={people} calendar={calendar} />
            </div>
          </details>
        ) : null}
      </section>

      <section aria-label="Notes" className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Notes</h2>
        <NoteForm applicationId={app.id} />
        {data.notes.length === 0 ? <p className="text-sm text-muted-foreground">No notes yet.</p> : null}
        <ul className="space-y-2">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-md bg-muted/40 p-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {n.authorName} · {formatInZone(n.createdAt, undefined, "MMM d, h:mm a")}
              </p>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="History" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {data.history.map((h) => (
            <li key={h.id}>
              <span className="text-muted-foreground">{formatInZone(h.at, undefined, "MMM d, yyyy h:mm a")}</span> · {h.fromStage ? `${STAGE_LABELS[h.fromStage as keyof typeof STAGE_LABELS]} to ` : "Applied as "}
              {STAGE_LABELS[h.toStage as keyof typeof STAGE_LABELS]} · {h.byName}
              {h.note ? ` · ${h.note}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
