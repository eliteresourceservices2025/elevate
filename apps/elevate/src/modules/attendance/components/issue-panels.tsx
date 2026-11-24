"use client";
import { EvidenceGallery } from "@/components/reports/evidence-gallery";
import { ReportInbox, type InboxRow } from "@/components/reports/report-inbox";
import { ReportThread } from "@/components/reports/report-thread";
import { StatusChip } from "@/components/status-chip";

import { fromZonedTime } from "date-fns-tz";
import { useState } from "react";
import { SelectField, TextField } from "@/components/form-fields";
import { useFormDialogWork } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { useRun } from "@/modules/recruiting/components/use-run";
import { handleTechIssue, reportTechIssue } from "../issue-actions";
import { EvidenceField, uploadEvidence } from "./evidence-field";
import { ISSUE_KIND_LABELS } from "../issue-labels";
import type { IssueItem } from "../issue-queries";

const KINDS = Object.entries(ISSUE_KIND_LABELS) as [keyof typeof ISSUE_KIND_LABELS, string][];

/** Report a problem with the clock, Jibble, the connection or a device. It changes no clock events and no hours: it tells the lead and HR. */
export function ReportIssueForm({ zone }: { zone: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialogWork({ busy: pending });
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
      <fieldset disabled={pending} className="space-y-3">
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
      </fieldset>
    </form>
  );
}

const ISSUE_GROUPS = [
  { value: "open", label: "Waiting" },
  { value: "done", label: "Handled" },
];

/** One report: what happened, its screenshots, the handler's note (and, for a handler, the button), and the conversation. */
function IssueDetail({ item, zone, mode }: { item: IssueItem; zone: string; mode: "mine" | "queue" }) {
  const { run, pending } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{mode === "queue" && item.employeeName ? item.employeeName : "Your report"}</h2>
          <StatusChip tone={item.status === "open" ? "warning" : "success"}>{item.status === "open" ? "Waiting" : "Handled"}</StatusChip>
        </div>
        <p className="text-sm text-muted-foreground">
          {ISSUE_KIND_LABELS[item.kind as keyof typeof ISSUE_KIND_LABELS] ?? item.kind} · started {formatInZone(new Date(item.happenedAt).getTime(), zone, "MMM d, h:mm a")}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm">{item.details}</p>
      <EvidenceGallery evidence={item.evidence} />
      {item.status === "handled" && item.handlingNote ? <p className="rounded-lg bg-muted/50 p-2 text-sm">Handled: {item.handlingNote}</p> : null}
      <ReportThread key={item.id} type="tech_issue" id={item.id} />
      {mode === "queue" && item.canHandle ? (
        <div className="space-y-2 border-t pt-3">
          <Label htmlFor={`ti-note-${item.id}`} className="text-xs">
            Note for them (optional)
          </Label>
          <Textarea id={`ti-note-${item.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => handleTechIssue({ issueId: item.id, note }), "Marked as handled.")}>
            Mark as handled
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The reports: the person's own, or the queue a lead or HR handles. Compact is the short list on My time (no filters, no panel). */
export function IssueList({ items, zone, mode, empty, compact = false }: { items: IssueItem[]; zone: string; mode: "mine" | "queue"; empty: string; compact?: boolean }) {
  if (compact) {
    if (items.length === 0) return <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{empty}</p>;
    return (
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id} className="space-y-1 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{ISSUE_KIND_LABELS[i.kind as keyof typeof ISSUE_KIND_LABELS] ?? i.kind}</span>
              <StatusChip tone={i.status === "open" ? "warning" : "success"}>{i.status === "open" ? "Waiting" : "Handled"}</StatusChip>
              <span className="text-xs text-muted-foreground">{formatInZone(new Date(i.happenedAt).getTime(), zone, "MMM d, h:mm a")}</span>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{i.details}</p>
          </li>
        ))}
      </ul>
    );
  }
  const rows: InboxRow[] = items.map((i) => {
    const kind = ISSUE_KIND_LABELS[i.kind as keyof typeof ISSUE_KIND_LABELS] ?? i.kind;
    const who = mode === "queue" && i.employeeName ? i.employeeName : kind;
    return {
      id: i.id,
      title: who,
      subtitle: mode === "queue" ? `${kind}: ${i.details}` : i.details,
      when: formatInZone(new Date(i.createdAt).getTime(), zone, "MMM d"),
      sortMs: new Date(i.createdAt).getTime(),
      status: { label: i.status === "open" ? "Waiting" : "Handled", tone: i.status === "open" ? "warning" : "success" },
      group: i.status === "open" ? "open" : "done",
      evidence: i.evidence.length,
      messages: i.messageCount,
      search: `${who} ${kind} ${i.details}`,
    };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  return (
    <ReportInbox
      rows={rows}
      groups={ISSUE_GROUPS}
      defaultGroup={mode === "queue" ? "open" : "all"}
      label="technical issues"
      emptyTitle={mode === "queue" ? "Nothing is waiting" : "No reports yet"}
      emptyText={empty}
      renderDetail={(id) => <IssueDetail item={byId.get(id)!} zone={zone} mode={mode} />}
    />
  );
}
