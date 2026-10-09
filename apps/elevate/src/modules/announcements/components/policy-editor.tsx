"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { MarkdownField } from "@/components/markdown-field";
import { useWarnWhenEdited } from "@/components/unsaved-changes";
import { archivePolicy, createPolicy, discardDraft, publishDraft, saveDraft } from "../actions";

const MARKDOWN_HINT = "Formatting: **bold**, *italic*, # heading, - bullet list, 1. numbered list, [link text](https://example.com).";

function AckFields({ requiresAck, setRequiresAck, dueOn, setDueOn, today, idPrefix }: { requiresAck: boolean; setRequiresAck: (v: boolean) => void; dueOn: string; setDueOn: (v: string) => void; today: string; idPrefix: string }) {
  return (
    <div className="space-y-3">
      <label htmlFor={`${idPrefix}-ack`} className="flex items-center gap-2 text-sm">
        <input id={`${idPrefix}-ack`} type="checkbox" className="size-4 accent-primary" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} />
        Require everyone to acknowledge this version
      </label>
      {requiresAck ? <TextField id={`${idPrefix}-due`} label="Due date (optional)" type="date" min={today} value={dueOn} onChange={(e) => setDueOn(e.target.value)} /> : null}
    </div>
  );
}

export function NewPolicyForm({ today }: { today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requiresAck, setRequiresAck] = useState(true);
  const [dueOn, setDueOn] = useState("");
  useWarnWhenEdited({ title, body, requiresAck, dueOn });

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createPolicy({ title, body, requiresAck, dueOn });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Policy created as a draft.");
          router.push(`/announcements/policies/${result.data.id}`);
        });
      }}
    >
      <TextField id="np-title" label="Policy title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
      <MarkdownField id="np-body" label="Text" value={body} onChange={setBody} hint={MARKDOWN_HINT} rows={8} required />
      <AckFields {...{ requiresAck, setRequiresAck, dueOn, setDueOn, today }} idPrefix="np" />
      <Button type="submit" disabled={pending}>Create draft</Button>
    </form>
  );
}

/** Edits the working draft. Publishing freezes it as the next version and notifies everyone. */
export function DraftEditor({
  policyId,
  nextVersion,
  initial,
  hasPublished,
  canArchive,
  today,
}: {
  policyId: string;
  nextVersion: number;
  initial: { body: string; changeNote: string | null; requiresAck: boolean; dueOn: string | null };
  hasPublished: boolean;
  /** A never-published policy that is not the privacy notice or monitoring policy can be removed. */
  canArchive: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(initial.body);
  const [changeNote, setChangeNote] = useState(initial.changeNote ?? "");
  const [requiresAck, setRequiresAck] = useState(initial.requiresAck);
  const [dueOn, setDueOn] = useState(initial.dueOn ?? "");
  const { markSaved } = useWarnWhenEdited({ body, changeNote, requiresAck, dueOn });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      markSaved();
      router.refresh();
    });
  const save = () => saveDraft({ policyId, body, changeNote, requiresAck, dueOn });

  return (
    <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={(e) => { e.preventDefault(); run(save, "Draft saved."); }}>
      <h3 className="font-semibold">Draft of version {nextVersion}</h3>
      <MarkdownField id="pd-body" label="Text" value={body} onChange={setBody} hint={MARKDOWN_HINT} rows={14} required />
      {hasPublished ? <TextField id="pd-note" label="What changed (shown to readers)" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} /> : null}
      <AckFields {...{ requiresAck, setRequiresAck, dueOn, setDueOn, today }} idPrefix="pd" />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={pending}>Save draft</Button>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            window.confirm(`Publish version ${nextVersion}? Nobody can change it afterwards, and everyone is notified${requiresAck ? " and asked to acknowledge it" : ""}.`) &&
            run(async () => {
              const saved = await save();
              return saved.ok ? publishDraft({ policyId }) : saved;
            }, `Version ${nextVersion} published.`)
          }
        >
          Publish version {nextVersion}
        </Button>
        {hasPublished ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => window.confirm("Discard this draft?") && run(() => discardDraft({ policyId }), "Draft discarded.")}>
            Discard draft
          </Button>
        ) : null}
        {canArchive ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              window.confirm("Remove this policy? It was never published, so nobody has seen it.") &&
              startTransition(async () => {
                const result = await archivePolicy({ policyId });
                if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
                toast.success("Policy removed.");
                router.push("/announcements");
              })
            }
          >
            Remove policy
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Starts a new draft from the current published text. */
export function StartDraftButton({ policyId, body, requiresAck }: { policyId: string; body: string; requiresAck: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await saveDraft({ policyId, body, changeNote: "", requiresAck, dueOn: "" });
          if (!result.ok) return void toast.error(result.error);
          router.refresh();
        })
      }
    >
      Write a new version
    </Button>
  );
}
