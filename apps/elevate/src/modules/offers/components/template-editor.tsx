"use client";

import { useState } from "react";
import { TextField } from "@/components/form-fields";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { archiveOfferTemplate, saveOfferTemplate } from "../actions";
import { DEFAULT_OFFER_TEMPLATE, MERGE_FIELDS, renderText, templateProblem } from "../merge";
import type { TemplateRow } from "../queries";

const SAMPLE = { candidate_name: "Ana Reyes", offer_date: "October 1, 2026", expires_on: "October 8, 2026", role_title: "Virtual Assistant", start_date: "November 2, 2026", client_name: "Acme Dental", pay_note: "Hourly rate agreed per client." };

/** HR: write offer letters with merge fields, with a live preview filled with sample values. */
export function TemplateEditor({ templates }: { templates: TemplateRow[] }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(DEFAULT_OFFER_TEMPLATE);

  const problem = templateProblem(body);
  const load = (t: TemplateRow | null) => {
    setEditing(t);
    setName(t?.name ?? "");
    setDescription(t?.description ?? "");
    setBody(t?.body ?? DEFAULT_OFFER_TEMPLATE);
  };

  return (
    <div className="space-y-6">
      <section aria-label="Saved templates" className="space-y-2">
        <h2 className="text-lg font-semibold">Saved templates</h2>
        {templates.length === 0 ? <p className="text-sm text-muted-foreground">None yet. The editor below starts from a sample letter you can change.</p> : null}
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
              <div>
                <p className="font-medium">{t.name}</p>
                {t.description ? <p className="text-xs text-muted-foreground">{t.description}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => load(t)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => window.confirm("Archive this template? Offers already sent are not affected.") && run(() => archiveOfferTemplate({ templateId: t.id }), "Template archived.", () => editing?.id === t.id && load(null))}>
                  Archive
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <form
        className="space-y-4 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveOfferTemplate({ id: editing?.id, name, description, body }), editing ? "Template saved." : "Template created.", () => load(null));
        }}
      >
        <h2 className="text-lg font-semibold">{editing ? `Edit: ${editing.name}` : "New template"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="tp-name" label="Template name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          <TextField id="tp-desc" label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="tp-body">Letter</Label>
            <Textarea id="tp-body" value={body} onChange={(e) => setBody(e.target.value)} rows={22} maxLength={10_000} className="font-mono text-xs" aria-describedby="tp-hint" />
            <p id="tp-hint" className="text-xs text-muted-foreground">
              Formatting: # heading, **bold**, *italic*, - bullet list, 1. numbered list. Put merge fields in double braces. Say &quot;independent contractor&quot;; do not promise salary or benefits.
            </p>
            {problem ? (
              <p role="alert" className="text-sm text-destructive">
                {problem}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Preview (with sample values)</Label>
            <div className="max-h-[32rem] overflow-y-auto rounded-lg border bg-muted/30 p-3">
              <Markdown source={renderText(body, SAMPLE)} />
            </div>
          </div>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Merge fields you can use</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {MERGE_FIELDS.map((f) => (
              <li key={f.key}>
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{`{{${f.key}}}`}</code> {f.label}
                <span className="text-xs text-muted-foreground"> ({f.source === "auto" ? "filled in automatically" : f.required ? "typed when making the offer, required" : "typed when making the offer, optional"})</span>
              </li>
            ))}
          </ul>
        </details>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || Boolean(problem) || name.trim().length < 3}>
            {editing ? "Save template" : "Create template"}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={() => load(null)}>
              Cancel editing
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
