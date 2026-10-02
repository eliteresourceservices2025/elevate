"use client";

/* eslint-disable security/detect-object-injection -- numeric list indexes */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveChecklistTemplate, saveChecklistTemplate } from "../actions";
import { CHECKS, CHECK_LABELS, OWNERS, OWNER_LABELS, type Kind } from "../constants";
import type { TemplateView } from "../queries";

type Options = { positions: { id: string; title: string }[]; documentTypes: { id: string; name: string }[]; signTemplates: { id: string; name: string }[]; policies: { id: string; title: string }[] };
type Item = TemplateView["items"][number];

const blank = (): Item => ({ title: "", details: null, owner: "hr", dueOffsetDays: 0, required: true, check: "manual", documentTypeId: null, policyId: null, policyKind: null, signTemplateId: null, href: null });

/** One template: a name, an optional position, and its task rows. An empty position means "the default for everyone". */
export function TemplateEditor({ template, kind, options }: { template?: TemplateView; kind: Kind; options: Options }) {
  const { run, pending, router } = useRun();
  const [name, setName] = useState(template?.name ?? "");
  const [positionId, setPositionId] = useState(template?.positionId ?? "");
  const [items, setItems] = useState<Item[]>(template?.items ?? [blank()]);
  const set = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const anchor = kind === "onboarding" ? "the start date" : "the last working day";

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveChecklistTemplate({ id: template?.id, kind, name, positionId: positionId || undefined, items }), "Template saved.", () => {
          if (!template) router.refresh();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`t-name-${template?.id ?? kind}`}>Template name</Label>
          <Input id={`t-name-${template?.id ?? kind}`} value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`t-pos-${template?.id ?? kind}`}>Used for</Label>
          <NativeSelect id={`t-pos-${template?.id ?? kind}`} value={positionId} onChange={(e) => setPositionId(e.target.value)} disabled={Boolean(template)}>
            <option value="">Everyone (the default)</option>
            {options.positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Due days count from {anchor}; a negative number is before it.</p>

      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="space-y-2 rounded-lg border p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem_6rem]">
              <div className="space-y-1">
                <Label htmlFor={`i-title-${template?.id ?? kind}-${i}`}>Task {i + 1}</Label>
                <Input id={`i-title-${template?.id ?? kind}-${i}`} value={it.title} onChange={(e) => set(i, { title: e.target.value })} maxLength={160} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`i-owner-${template?.id ?? kind}-${i}`}>Who</Label>
                <NativeSelect id={`i-owner-${template?.id ?? kind}-${i}`} value={it.owner} onChange={(e) => set(i, { owner: e.target.value as Item["owner"] })}>
                  {OWNERS.map((o) => (
                    <option key={o} value={o}>
                      {OWNER_LABELS[o]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`i-due-${template?.id ?? kind}-${i}`}>Due day</Label>
                <Input id={`i-due-${template?.id ?? kind}-${i}`} type="number" value={it.dueOffsetDays} onChange={(e) => set(i, { dueOffsetDays: Number(e.target.value) })} min={-60} max={120} />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`i-check-${template?.id ?? kind}-${i}`}>Done when</Label>
                <NativeSelect id={`i-check-${template?.id ?? kind}-${i}`} value={it.check} onChange={(e) => set(i, { check: e.target.value })}>
                  {CHECKS.filter((c) => (kind === "onboarding" ? c !== "exit_interview" && c !== "access" && c !== "assets_returned" : c !== "account" && c !== "signature")).map((c) => (
                    <option key={c} value={c}>
                      {CHECK_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {it.check === "document" ? (
                <div className="space-y-1">
                  <Label htmlFor={`i-doc-${template?.id ?? kind}-${i}`}>Document type</Label>
                  <NativeSelect id={`i-doc-${template?.id ?? kind}-${i}`} value={it.documentTypeId ?? ""} onChange={(e) => set(i, { documentTypeId: e.target.value || null })}>
                    <option value="">Choose</option>
                    {options.documentTypes.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              {it.check === "policy" ? (
                <div className="space-y-1">
                  <Label htmlFor={`i-pol-${template?.id ?? kind}-${i}`}>Policy</Label>
                  <NativeSelect id={`i-pol-${template?.id ?? kind}-${i}`} value={it.policyKind ?? it.policyId ?? ""} onChange={(e) => set(i, e.target.value === "privacy_notice" || e.target.value === "monitoring" ? { policyKind: e.target.value, policyId: null } : { policyId: e.target.value || null, policyKind: null })}>
                    <option value="">Choose</option>
                    <option value="privacy_notice">The privacy notice</option>
                    <option value="monitoring">The monitoring policy</option>
                    {options.policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
              {it.check === "signature" ? (
                <div className="space-y-1">
                  <Label htmlFor={`i-sig-${template?.id ?? kind}-${i}`}>Agreement template</Label>
                  <NativeSelect id={`i-sig-${template?.id ?? kind}-${i}`} value={it.signTemplateId ?? ""} onChange={(e) => set(i, { signTemplateId: e.target.value || null })}>
                    <option value="">Choose</option>
                    {options.signTemplates.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`i-det-${template?.id ?? kind}-${i}`}>Details (optional)</Label>
                <Input id={`i-det-${template?.id ?? kind}-${i}`} value={it.details ?? ""} onChange={(e) => set(i, { details: e.target.value })} maxLength={500} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`i-href-${template?.id ?? kind}-${i}`}>Link inside ELEVATE (optional)</Label>
                <Input id={`i-href-${template?.id ?? kind}-${i}`} value={it.href ?? ""} onChange={(e) => set(i, { href: e.target.value })} placeholder="/signing" />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={it.required} onChange={(e) => set(i, { required: e.target.checked })} />
                Required
              </label>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => setItems((l) => l.map((x, j) => (j === i - 1 ? l[i] : j === i ? l[i - 1] : x)))}>
                  Up
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => setItems((l) => l.map((x, j) => (j === i + 1 ? l[i] : j === i ? l[i + 1] : x)))}>
                  Down
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setItems((l) => [...l, blank()])} disabled={items.length >= 40}>
          Add a task
        </Button>
        <Button type="submit" disabled={pending}>
          Save template
        </Button>
        {template ? (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => archiveChecklistTemplate({ templateId: template.id }), "Template archived.")}>
            Archive
          </Button>
        ) : null}
      </div>
    </form>
  );
}
