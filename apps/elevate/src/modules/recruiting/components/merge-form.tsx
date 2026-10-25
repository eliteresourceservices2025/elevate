"use client";

import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { mergeCandidates } from "../actions";
import { STAGE_LABELS } from "../constants";
import type { DuplicateGroupView } from "../queries";
import { useRun } from "./use-run";

/** One group of records that look like the same person: HR picks the record to keep and merges the others into it. */
export function MergeGroup({ group }: { group: DuplicateGroupView }) {
  const { run, pending } = useRun();
  const [keep, setKeep] = useState(group.candidates[0]?.id ?? "");
  const confirm = useConfirm();

  async function merge() {
    const others = group.candidates.filter((c) => c.id !== keep);
    const kept = group.candidates.find((c) => c.id === keep);
    if (!kept) return;
    const ok = await confirm({
      title: "Merge these records?",
      description: `${others.length === 1 ? "The other record" : `The other ${others.length} records`} will be merged into ${kept.name} (${kept.email}). Their applications move to this record and the other record is emptied. This cannot be undone.`,
      confirmLabel: "Merge records",
      cancelLabel: "Keep both",
      destructive: true,
    });
    if (!ok) return;
    run(
      async () => {
        let moved = 0;
        for (const other of others) {
          const result = await mergeCandidates({ keepCandidateId: keep, mergeCandidateId: other.id });
          if (!result.ok) return result;
          moved += result.data.moved;
        }
        return { ok: true as const, data: moved };
      },
      (moved) => `Merged. ${moved ?? 0} application${moved === 1 ? "" : "s"} moved.`,
    );
  }

  return (
    <fieldset className="space-y-3 rounded-xl border bg-card p-4">
      <legend className="px-1 text-sm font-semibold">Possible duplicate: same {group.reasons.map((r) => (r === "phone" ? "phone number" : "name")).join(" and ")}</legend>
      <ul className="space-y-2">
        {group.candidates.map((c) => (
          <li key={c.id} className="min-w-0">
            <label htmlFor={`keep-${c.id}`} className="flex items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input id={`keep-${c.id}`} type="radio" name={`keep-${group.candidates[0]?.id}`} className="mt-1 size-4 accent-primary" checked={keep === c.id} onChange={() => setKeep(c.id)} />
              <span className="min-w-0 space-y-0.5 break-words">
                <span className="block font-medium [overflow-wrap:anywhere]">{c.name}</span>
                <span className="block text-muted-foreground [overflow-wrap:anywhere]">
                  {c.email}
                  {c.phone ? ` · ${c.phone}` : ""}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.appliedFor.length === 0 ? "No applications." : c.appliedFor.map((a) => `${a.title} (${STAGE_LABELS[a.stage]})`).join("; ")}
                  {c.inPool ? " · in the talent pool" : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} onClick={merge} className="h-auto min-h-(--control-h) whitespace-normal text-left">
          Merge into selected record
        </Button>
        <p className="text-xs text-muted-foreground">Looks alike but not the same person? Just leave it. Nothing is merged for you.</p>
      </div>
    </fieldset>
  );
}
