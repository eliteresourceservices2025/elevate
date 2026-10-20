"use client";

import { fromZonedTime } from "date-fns-tz";
import { useState } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { useFormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { useRun } from "@/modules/recruiting/components/use-run";
import { openEvidence } from "../actions";
import { handleTechIssue, reportTechIssue } from "../issue-actions";
import { EvidenceField, uploadEvidence } from "./evidence-field";
import { ISSUE_KIND_LABELS } from "../issue-labels";
import type { IssueItem } from "../issue-queries";

const KINDS = Object.entries(ISSUE_KIND_LABELS) as [keyof typeof ISSUE_KIND_LABELS, string][];

/** Report a problem with the clock, Jibble, the connection or a device. It changes no clock events and no hours: it tells the lead and HR. */
export function ReportIssueForm({ zone }: { zone: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [kind, setKind] = useState<keyof typeof ISSUE_KIND_LABELS>("clock");
  const [when, setWhen] = useState(() => formatInZone(Date.now(), zone, "yyyy-MM-dd'T'HH:mm"));
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          async () => {
            const uploaded = await uploadEvidence(files);
            if (!uploaded.ok) return uploaded;
            return reportTechIssue({ kind, happenedAt: fromZonedTime(when, zone).toISOString(), details, evidenceIds: uploaded.ids });
          },
          "Report sent to your lead and HR.",
          () => dialog?.close(true),
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        This does not change your clock or your hours; it lets your lead and HR know what happened. If time is missing from your record, ask for a time correction instead (you can do both).
      </p>
      <SelectField id="ti-kind" label="What went wrong?" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
        {KINDS.map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </SelectField>
      <TextField id="ti-when" label={`When did it start? (${zone})`} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      <div className="space-y-1.5">
        <Label htmlFor="ti-details">What happened?</Label>
        <Textarea id="ti-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={5} required />
        <p className="text-xs text-muted-foreground">
          For example: Jibble still showed me clocked in after I clocked out of ELEVATE, or the clock button gave an error. <strong>Never include client or patient information.</strong>
        </p>
      </div>
      <EvidenceField id="ti-files" label="Screenshot of the problem" onFiles={setFiles}>
        For example the error message, Jibble still showing you clocked in, or a speed test. A screenshot is required.
      </EvidenceField>
      <Button type="submit" disabled={pending || details.trim().length < 5 || files.length === 0}>
        Send report
      </Button>
    </form>
  );
}

/** A list of reports: the person's own, or the queue a lead or HR handles (with a note and a "Mark as handled" button). */
export function IssueList({ items, zone, mode, empty }: { items: IssueItem[]; zone: string; mode: "mine" | "queue"; empty: string }) {
  const { run, pending } = useRun();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const open = async (evidenceId: string) => {
    const result = await openEvidence({ evidenceId });
    if (!result.ok) return void toast.error(result.error);
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  };
  if (items.length === 0) return <p className="rounded-xl border p-6 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="space-y-2 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            {mode === "queue" && i.employeeName ? <span className="font-medium">{i.employeeName}</span> : null}
            <Badge variant="outline">{ISSUE_KIND_LABELS[i.kind as keyof typeof ISSUE_KIND_LABELS] ?? i.kind}</Badge>
            <Badge variant={i.status === "open" ? "secondary" : "default"}>{i.status === "open" ? "Waiting" : "Handled"}</Badge>
            <span className="text-xs text-muted-foreground">Started {formatInZone(new Date(i.happenedAt).getTime(), zone, "MMM d, h:mm a")}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{i.details}</p>
          {i.evidence.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {i.evidence.map((ev, n) =>
                ev.purged ? (
                  <span key={ev.id} className="text-xs text-muted-foreground">
                    Screenshot {n + 1} was deleted after 90 days
                  </span>
                ) : (
                  <Button key={ev.id} size="sm" variant="outline" type="button" onClick={() => void open(ev.id)}>
                    View screenshot {n + 1}
                  </Button>
                ),
              )}
            </div>
          ) : null}
          {i.status === "handled" && i.handlingNote ? <p className="rounded-lg bg-muted/50 p-2 text-sm">{i.handlingNote}</p> : null}
          {mode === "queue" && i.canHandle ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1">
                <Label htmlFor={`ti-note-${i.id}`} className="text-xs">
                  Note for them (optional)
                </Label>
                <Textarea id={`ti-note-${i.id}`} rows={2} maxLength={500} value={notes[i.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))} />
              </div>
              <Button type="button" size="sm" disabled={pending} onClick={() => run(() => handleTechIssue({ issueId: i.id, note: notes[i.id] ?? "" }), "Marked as handled.")}>
                Mark as handled
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
