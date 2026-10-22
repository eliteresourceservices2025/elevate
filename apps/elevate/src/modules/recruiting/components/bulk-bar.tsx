"use client";

import { useEffect, useState } from "react";
import { SelectField, TextField } from "@/components/form-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { bulkUpdateApplications, type BulkResult } from "../actions";
import { BOARD_STAGES, CLOSE_KINDS, CLOSE_KIND_LABELS, STAGE_LABELS, type CloseKind, type Stage } from "../constants";
import type { TagChoice } from "../queries";
import { useRun } from "./use-run";

const BULK_STAGES = BOARD_STAGES.filter((s) => s !== "hired"); // hiring is done one person at a time, from an offer
const ACTIONS = [
  { value: "move", label: "Move to a stage" },
  { value: "close", label: "Close applications" },
  { value: "tag", label: "Add a tag" },
  { value: "untag", label: "Remove a tag" },
] as const;
type ActionValue = (typeof ACTIONS)[number]["value"];

/** The checkboxes live in the list (server-rendered, `form={formId}`); this reads which are ticked and runs one action on all of them. */
export function BulkBar({ formId, tags }: { formId: string; tags: TagChoice[] }) {
  const { run, pending } = useRun();
  const [selected, setSelected] = useState(0);
  const [action, setAction] = useState<ActionValue | "">("");
  const [stage, setStage] = useState<string>(BULK_STAGES[1] ?? "screening");
  const [kind, setKind] = useState<CloseKind>("not_qualified");
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(false);
  const [tagId, setTagId] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"][name="id"]`));
  const count = () => boxes().filter((b) => b.checked).length;

  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t?.form?.id === formId) setSelected(count());
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- count() only reads the page
  }, [formId]);

  function toggleAll() {
    const all = boxes();
    const next = !all.every((b) => b.checked);
    for (const b of all) b.checked = next;
    setSelected(next ? all.length : 0);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const ids = boxes().filter((b) => b.checked).map((b) => b.value);
    if (ids.length === 0 || action === "") return;
    const base = { applicationIds: ids };
    const input =
      action === "move"
        ? { ...base, action, to: stage as Stage }
        : action === "close"
          ? { ...base, action, kind, reason, notifyCandidate: notify }
          : { ...base, action, tagId };
    const what = action === "move" ? `Move ${ids.length} to ${STAGE_LABELS[stage as Stage]}` : action === "close" ? `Close ${ids.length} as ${CLOSE_KIND_LABELS[kind].toLowerCase()}` : action === "tag" ? `Add the tag to ${ids.length}` : `Remove the tag from ${ids.length}`;
    if (!window.confirm(`${what}? Each one is recorded in its history.`)) return;
    setResult(null);
    run<BulkResult>(
      () => bulkUpdateApplications(input),
      (data) => (data ? `${data.done} of ${data.requested} done.` : "Done."),
      (data) => {
        setResult(data ?? null);
        for (const b of boxes()) b.checked = false;
        setSelected(0);
      },
    );
  }

  const ready = selected > 0 && action !== "" && (action !== "close" || reason.trim().length >= 3) && ((action !== "tag" && action !== "untag") || tagId !== "");

  return (
    <section aria-label="Actions for the selected applicants" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
          Select or clear this page
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected === 0 ? "Tick applicants in the list to act on several at once." : `${selected} selected`}
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField id="bulk-action" label="Do this" value={action} onChange={(e) => setAction(e.target.value as ActionValue | "")}>
          <option value="">Choose an action</option>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </SelectField>
        {action === "move" ? (
          <SelectField id="bulk-stage" label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {BULK_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </SelectField>
        ) : null}
        {action === "close" ? (
          <>
            <SelectField id="bulk-kind" label="How it closes" value={kind} onChange={(e) => setKind(e.target.value as CloseKind)}>
              {CLOSE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CLOSE_KIND_LABELS[k]}
                </option>
              ))}
            </SelectField>
            <TextField id="bulk-reason" label="Reason (internal only)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            {kind !== "withdrawn" ? (
              <label htmlFor="bulk-notify" className="flex items-center gap-2 self-end pb-2 text-sm">
                <input id="bulk-notify" type="checkbox" className="size-4 accent-primary" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Send each a short, polite email
              </label>
            ) : null}
          </>
        ) : null}
        {action === "tag" || action === "untag" ? (
          <SelectField id="bulk-tag" label="Tag" value={tagId} onChange={(e) => setTagId(e.target.value)} hint={tags.length === 0 ? "No tags yet. Create one on an applicant's page." : undefined}>
            <option value="">Choose a tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div className="flex items-end">
          <Button type="submit" disabled={!ready || pending}>
            Apply to {selected || "selected"}
          </Button>
        </div>
      </form>
      {result && result.failed.length > 0 ? (
        <Alert variant="warning" role="status" className="text-sm">
          <p className="font-medium">
            {result.failed.length} could not change; the other {result.done} did.
          </p>
          <ul className="mt-1 list-disc pl-5">
            {Array.from(new Set(result.failed.map((f) => f.reason))).map((reason) => (
              <li key={reason}>
                {reason} ({result.failed.filter((f) => f.reason === reason).length})
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </section>
  );
}
