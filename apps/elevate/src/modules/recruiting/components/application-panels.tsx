"use client";

/* eslint-disable security/detect-object-injection -- keys are typed criteria, stage and interview-kind names */

import { useState } from "react";
import { toast } from "sonner";
import { DocumentViewer } from "@/components/document-viewer";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addNote, cancelInterview, getResumeLink, moveApplication, rejectApplication, scheduleInterview, submitScorecard } from "../actions";
import { BOARD_STAGES, CRITERIA, INTERVIEW_KINDS, INTERVIEW_KIND_LABELS, RECOMMENDATIONS, RECOMMENDATION_LABELS, STAGE_LABELS, type CriterionKey, type Stage } from "../constants";
import type { PersonChoice } from "../queries";
import { useRun } from "./use-run";

/** The resume inside the page when it is a PDF; a Word file cannot be shown by a browser, so it only offers the download. */
export function ResumeViewer({ applicationId, kind }: { applicationId: string; kind: string | null }) {
  if (kind === "pdf" || kind === null) {
    return (
      <DocumentViewer src={`/api/recruiting/resume/${applicationId}`} title="Resume" openLabel="View resume">
        <ResumeButton applicationId={applicationId} />
      </DocumentViewer>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ResumeButton applicationId={applicationId} />
      <p className="text-xs text-muted-foreground">This is a Word file, which cannot be shown in the page. Download it to read it.</p>
    </div>
  );
}

export function ResumeButton({ applicationId }: { applicationId: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await getResumeLink({ applicationId }).finally(() => setPending(false));
        if (!result.ok) return void toast.error(result.error);
        window.open(result.data.url, "_blank", "noopener,noreferrer");
      }}
    >
      Download resume
    </Button>
  );
}

export function MoveControls({ applicationId, stage }: { applicationId: string; stage: Stage }) {
  const { run, pending } = useRun();
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const options = BOARD_STAGES.filter((s) => s !== stage);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!to) return;
        run(() => moveApplication({ applicationId, to, note }), `Moved to ${STAGE_LABELS[to as Stage]}.`, () => {
          setTo("");
          setNote("");
        });
      }}
    >
      <div className="w-48">
        <SelectField id="mv-to" label={stage === "rejected" ? "Reopen into" : "Move to"} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a stage</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="min-w-48 flex-1">
        <TextField id="mv-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <Button type="submit" disabled={pending || !to}>
        Move
      </Button>
    </form>
  );
}

export function RejectForm({ applicationId, sendRejection }: { applicationId: string; sendRejection: boolean }) {
  const { run, pending } = useRun();
  const [kind, setKind] = useState<"rejected" | "withdrawn">("rejected");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("Close this application? You can reopen it later.")) return;
        run(() => rejectApplication({ applicationId, kind, reason, notifyCandidate: notify }), "Application closed.");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="rj-kind" label="Why is it closing" value={kind} onChange={(e) => setKind(e.target.value as "rejected" | "withdrawn")}>
          <option value="rejected">We are not moving forward</option>
          <option value="withdrawn">The applicant withdrew</option>
        </SelectField>
        <TextField id="rj-reason" label="Reason (internal only)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required />
      </div>
      {kind === "rejected" && sendRejection ? (
        <label htmlFor="rj-notify" className="flex items-center gap-2 text-sm">
          <input id="rj-notify" type="checkbox" className="size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Send the applicant a short, polite rejection email
        </label>
      ) : null}
      <Button type="submit" variant="destructive" disabled={pending}>
        Close application
      </Button>
    </form>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  const { run, pending } = useRun();
  const [body, setBody] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addNote({ applicationId, body }), "Note added.", () => setBody(""));
      }}
    >
      <Label htmlFor="note-body">Add a note</Label>
      <Textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={4000} required />
      <p className="text-xs text-muted-foreground">Notes are internal. Please do not write client or patient information.</p>
      <Button type="submit" size="sm" disabled={pending || body.trim() === ""}>
        Add note
      </Button>
    </form>
  );
}

export function InterviewForm({ applicationId, people, calendar }: { applicationId: string; people: PersonChoice[]; calendar: { connected: boolean; needsReconnect: boolean } }) {
  const { run, pending } = useRun();
  const [kind, setKind] = useState<(typeof INTERVIEW_KINDS)[number]>("interview");
  const [startsAt, setStartsAt] = useState("");
  const [minutes, setMinutes] = useState("45");
  const [location, setLocation] = useState(calendar.connected && !calendar.needsReconnect ? "Google Meet" : "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [emailCandidate, setEmailCandidate] = useState(true);
  const [note, setNote] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        // The browser's local time becomes an exact instant here; the server stores UTC.
        const when = startsAt ? new Date(startsAt) : null;
        if (!when || Number.isNaN(when.getTime())) return void toast.error("Pick a date and time.");
        run(
          () => scheduleInterview({ applicationId, kind, startsAt: when.toISOString(), minutes: Number(minutes), location, interviewerUserIds: [...picked], emailCandidate, note }),
          (d) => {
            if (d?.warning) toast.warning(d.warning);
            return d?.calendar === "google" ? "Interview scheduled on your Google Calendar. Google sends the invites." : "Interview scheduled. Invites are queued.";
          },
          () => {
            setStartsAt("");
            setLocation(calendar.connected && !calendar.needsReconnect ? "Google Meet" : "");
            setNote("");
            setPicked(new Set());
          },
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField id="iv-kind" label="Type" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {INTERVIEW_KINDS.map((k) => (
            <option key={k} value={k}>
              {INTERVIEW_KIND_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <TextField id="iv-when" label="Date and time (your computer's time zone)" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        <SelectField id="iv-minutes" label="Length" value={minutes} onChange={(e) => setMinutes(e.target.value)}>
          {[15, 30, 45, 60, 90].map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </SelectField>
        <TextField id="iv-location" label="Meeting link or place" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} required />
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Interviewers</legend>
        <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.userId} htmlFor={`iv-p-${p.userId}`} className="flex items-center gap-2 text-sm">
              <input
                id={`iv-p-${p.userId}`}
                type="checkbox"
                className="size-4 accent-primary"
                checked={picked.has(p.userId)}
                onChange={() =>
                  setPicked((s) => {
                    const next = new Set(s);
                    if (next.has(p.userId)) next.delete(p.userId);
                    else next.add(p.userId);
                    return next;
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <TextField id="iv-note" label="Note for the interviewers and the applicant (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      <label htmlFor="iv-email" className="flex items-center gap-2 text-sm">
        <input id="iv-email" type="checkbox" className="size-4 accent-primary" checked={emailCandidate} onChange={(e) => setEmailCandidate(e.target.checked)} />
        Email the applicant the invite
      </label>
      <p className="text-xs text-muted-foreground">
        {calendar.connected && !calendar.needsReconnect ? "This will be created on your Google Calendar with a Meet link, and Google emails the invites." : "Invites go out as calendar files by email. Connect Google Calendar on the Recruiting page to create the event with a Meet link instead."}
      </p>
      <Button type="submit" disabled={pending || picked.size === 0}>
        Schedule interview
      </Button>
    </form>
  );
}

export function CancelInterviewButton({ interviewId }: { interviewId: string }) {
  const { run, pending } = useRun();
  return (
    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Cancel this interview? Everyone is sent a cancellation.") && run<{ warning: string | null }>(() => cancelInterview({ interviewId }), "Interview cancelled.", (d) => d?.warning && toast.warning(d.warning))}>
      Cancel interview
    </Button>
  );
}

export function ScorecardForm({ interviewId }: { interviewId: string }) {
  const { run, pending } = useRun();
  const [ratings, setRatings] = useState<Partial<Record<CriterionKey, number>>>({});
  const [recommendation, setRecommendation] = useState<(typeof RECOMMENDATIONS)[number] | "">("");
  const [comments, setComments] = useState("");
  const complete = CRITERIA.every((c) => ratings[c.key]) && recommendation !== "";
  return (
    <form
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete) return;
        if (!window.confirm("Submit your scorecard? It cannot be changed afterwards.")) return;
        run(() => submitScorecard({ interviewId, ratings, recommendation, comments }), "Scorecard submitted.");
      }}
    >
      <h4 className="text-sm font-semibold">Your scorecard</h4>
      {CRITERIA.map((c) => (
        <fieldset key={c.key} className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">{c.label}</legend>
          <span className="w-56 text-sm">{c.label}</span>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} htmlFor={`sc-${interviewId}-${c.key}-${n}`} className="flex items-center gap-1 text-sm">
              <input id={`sc-${interviewId}-${c.key}-${n}`} type="radio" name={`${interviewId}-${c.key}`} className="size-4 accent-primary" checked={ratings[c.key] === n} onChange={() => setRatings((r) => ({ ...r, [c.key]: n }))} />
              {n}
            </label>
          ))}
        </fieldset>
      ))}
      <p className="text-xs text-muted-foreground">1 is weak, 5 is excellent.</p>
      <SelectField id={`sc-rec-${interviewId}`} label="Your recommendation" value={recommendation} onChange={(e) => setRecommendation(e.target.value as typeof recommendation)}>
        <option value="">Choose</option>
        {RECOMMENDATIONS.map((r) => (
          <option key={r} value={r}>
            {RECOMMENDATION_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <Label htmlFor={`sc-comments-${interviewId}`}>Why</Label>
        <Textarea id={`sc-comments-${interviewId}`} value={comments} onChange={(e) => setComments(e.target.value)} rows={3} maxLength={4000} required />
      </div>
      <Button type="submit" disabled={pending || !complete || comments.trim().length < 3}>
        Submit scorecard
      </Button>
    </form>
  );
}
