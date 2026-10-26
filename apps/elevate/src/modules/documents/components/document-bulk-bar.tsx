"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { SelectField, TextField } from "@/components/form-fields";
import { useOperationResult } from "@/components/operation-result";
import { documentOperationResult } from "../operation-result";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { bulkUpdateDocuments, type BulkDocumentsResult } from "../actions";

const ACTIONS = [
  { value: "archive", label: "Archive" },
  { value: "restore", label: "Restore from the archive" },
  { value: "delete", label: "Delete for good (archived files only)" },
] as const;
type ActionValue = (typeof ACTIONS)[number]["value"];

/** HR only. The checkboxes live in the list (`form={formId}`); this reads which are ticked and runs one action on all of them. */
export function DocumentBulkBar({ formId, scopeLabel = "this page" }: { formId: string; scopeLabel?: string }) {
  const { run, pending } = useRun();
  const confirm = useConfirm();
  const showResult = useOperationResult();
  const [selected, setSelected] = useState(0);
  const [action, setAction] = useState<ActionValue | "">("");
  const [reason, setReason] = useState("");

  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"][name="document"]`));
  // A document can be in the page twice (table and phone card), so count and send each id once.
  const checkedIds = () => [...new Set(boxes().filter((b) => b.checked).map((b) => b.value))];

  useEffect(() => {
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement | null;
      if (t?.getAttribute("form") === formId) setSelected(checkedIds().length);
    };
    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkedIds() only reads the page
  }, [formId]);

  function toggleAll() {
    const all = boxes();
    const visible = all.filter((b) => b.offsetParent !== null);
    const next = !visible.some((b) => b.checked);
    for (const b of all) b.checked = next;
    setSelected(next ? new Set(all.map((b) => b.value)).size : 0);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const ids = checkedIds();
    if (ids.length === 0 || action === "") return;
    const count = `${ids.length} document${ids.length === 1 ? "" : "s"}`;
    const ok = await confirm(
      action === "archive"
        ? { title: `Archive ${count}?`, description: "They are hidden from lists; the files are kept and can be restored.", confirmLabel: `Archive ${count}` }
        : action === "restore"
          ? { title: `Restore ${count}?`, description: "They return to the lists from the archive.", confirmLabel: `Restore ${count}` }
          : { title: `Delete ${count} for good?`, description: "The files are removed and this cannot be undone.", confirmLabel: `Delete ${count}`, destructive: true },
    );
    if (!ok) return;
    const labels = new Map(boxes().map((box) => [box.value, box.getAttribute("aria-label")?.replace(/^Select /, "") ?? "A selected document"]));
    const input = action === "delete" ? { action, documentIds: ids, reason } : { action, documentIds: ids };
    run<BulkDocumentsResult>(
      () => bulkUpdateDocuments(input),
      "",
      (data) => {
        if (data) showResult(documentOperationResult(action, data, labels));
        for (const b of boxes()) b.checked = false;
        setSelected(0);
        setReason("");
      },
    );
  }

  const ready = selected > 0 && action !== "" && (action !== "delete" || reason.trim().length >= 3);

  return (
    <section aria-label="Actions for the selected documents" className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={toggleAll}>
          {selected > 0 ? `Clear selection (${scopeLabel})` : `Select ${scopeLabel}`}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected === 0 ? "Tick documents in the list to act on several at once." : `${selected} selected`}
        </p>
      </div>
      {selected > 0 ? <form onSubmit={submit} className="flex flex-wrap items-end gap-3 [&>div:first-child]:min-w-[min(100%,16rem)]">
        <SelectField id={`${formId}-action`} label="Do this" value={action} onChange={(e) => setAction(e.target.value as ActionValue | "")}>
          <option value="">Choose an action</option>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </SelectField>
        {action === "delete" ? <TextField id={`${formId}-reason`} label="Reason (kept in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /> : null}
        <div className="flex items-end">
          <Button type="submit" variant={action === "delete" ? "destructive" : "default"} disabled={!ready || pending}>
            Apply to {selected || "selected"}
          </Button>
        </div>
      </form> : null}
    </section>
  );
}
