"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAnnouncement, updateAnnouncement } from "../actions";

type Option = { id: string; name?: string; title?: string };

const MARKDOWN_HINT = "Formatting: **bold**, *italic*, # heading, - bullet list, 1. numbered list, [link text](https://example.com).";

export function AnnouncementForm({
  today,
  teams,
  documents,
  edit,
}: {
  today: string;
  teams: { id: string; name: string }[];
  documents: { id: string; title: string }[];
  /** Present when editing: audience and "requires acknowledgment" are fixed after posting. */
  edit?: {
    announcementId: string;
    title: string;
    body: string;
    pinned: boolean;
    requiresAck: boolean;
    dueOn: string | null;
    attachmentDocumentId: string | null;
    audience: "all" | "teams";
    textLocked: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(edit?.title ?? "");
  const [body, setBody] = useState(edit?.body ?? "");
  const [audience, setAudience] = useState<"all" | "teams">(edit?.audience ?? "all");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [pinned, setPinned] = useState(edit?.pinned ?? false);
  const [requiresAck, setRequiresAck] = useState(edit?.requiresAck ?? false);
  const [dueOn, setDueOn] = useState(edit?.dueOn ?? "");
  const [attachment, setAttachment] = useState(edit?.attachmentDocumentId ?? "");

  const locked = edit?.textLocked ?? false;
  const toggleTeam = (id: string) => setTeamIds((ids) => (ids.includes(id) ? ids.filter((t) => t !== id) : [...ids, id]));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      if (edit) {
        const result = await updateAnnouncement({ announcementId: edit.announcementId, title, body, pinned, dueOn, attachmentDocumentId: attachment });
        if (!result.ok) return void toast.error(result.error);
        toast.success("Announcement updated.");
        router.push(`/announcements/${edit.announcementId}`);
      } else {
        const result = await createAnnouncement({ title, body, audience, teamIds, pinned, requiresAck, dueOn, attachmentDocumentId: attachment });
        if (!result.ok) return void toast.error(result.error);
        toast.success("Announcement posted.");
        router.push(`/announcements/${result.data.id}`);
      }
      router.refresh();
    });
  }

  const box = (id: string, label: string, checked: boolean, set: (v: boolean) => void, disabled = false) => (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-5">
      {locked ? <p className="rounded-lg border bg-muted/50 p-3 text-sm">People have already acknowledged this, so the title and text are locked. You can still change the due date, pinning and attachment.</p> : null}
      <TextField id="an-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required disabled={locked} />
      <div className="space-y-1.5">
        <Label htmlFor="an-body">Message</Label>
        <Textarea id="an-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={10000} required disabled={locked} aria-describedby="an-body-hint" />
        <p id="an-body-hint" className="text-xs text-muted-foreground">{MARKDOWN_HINT}</p>
      </div>

      {!edit ? (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Who is it for?</legend>
          <SelectField id="an-audience" label="Audience" value={audience} onChange={(e) => setAudience(e.target.value as "all" | "teams")}>
            <option value="all">Everyone</option>
            <option value="teams">Selected teams</option>
          </SelectField>
          {audience === "teams" ? (
            <div role="group" aria-label="Teams" className="grid gap-2 sm:grid-cols-2">
              {teams.map((t) => box(`an-team-${t.id}`, t.name, teamIds.includes(t.id), () => toggleTeam(t.id)))}
              {teams.length === 0 ? <p className="text-sm text-muted-foreground">No teams yet. Add teams on the Org chart page.</p> : null}
            </div>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-sm text-muted-foreground">Audience: {edit.audience === "all" ? "everyone" : "selected teams"}. It cannot change after posting.</p>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Options</legend>
        {box("an-pinned", "Pin to the top", pinned, setPinned)}
        {box("an-ack", "Require acknowledgment", requiresAck, setRequiresAck, Boolean(edit))}
        {requiresAck ? (
          <TextField id="an-due" label="Due date (optional)" type="date" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} hint="People are reminded 3 days before, on the day, and weekly while overdue." />
        ) : null}
        <SelectField id="an-attach" label="Attach a company document (optional)" value={attachment} onChange={(e) => setAttachment(e.target.value)}>
          <option value="">No attachment</option>
          {documents.map((d: Option) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </SelectField>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{edit ? "Save changes" : "Post announcement"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
