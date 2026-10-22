"use client";

import { useState } from "react";
import { TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { resetEmailTemplate, saveEmailTemplate } from "../actions";
import { BODY_MAX, MERGE_FIELDS, SUBJECT_MAX, renderTemplate, validateTemplate } from "../mail";
import type { EmailTemplateView } from "../queries";
import { useRun } from "./use-run";

/** One applicant email: its subject and message, a live preview with a sample applicant, save, and back to the built-in wording. */
export function TemplateEditor({ template }: { template: EmailTemplateView }) {
  const { run, pending } = useRun();
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const problem = validateTemplate({ subject, body });
  const preview = problem ? null : renderTemplate({ subject, body }, { fullName: "Ana Reyes", jobTitle: "Virtual Assistant" });
  const changed = subject !== template.subject || body !== template.body;

  return (
    <section aria-label={template.label} className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{template.label}</h2>
        <Badge variant={template.custom ? "default" : "outline"}>{template.custom ? "Your wording" : "Built-in wording"}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{template.when}</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveEmailTemplate({ kind: template.kind, subject, body }), "Saved.");
        }}
      >
        <TextField id={`tpl-subject-${template.kind}`} label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={SUBJECT_MAX} />
        <div className="space-y-1.5">
          <Label htmlFor={`tpl-body-${template.kind}`}>Message</Label>
          <Textarea id={`tpl-body-${template.kind}`} value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={BODY_MAX} />
          <p className="text-xs text-muted-foreground">
            Plain text; leave a blank line between paragraphs. You can use {MERGE_FIELDS.map((f) => `{{${f}}}`).join(" and ")}. Never write scores, notes or the reason for the decision here: the email goes to the applicant.
          </p>
        </div>
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending || problem !== null || !changed}>
            Save
          </Button>
          {template.custom ? (
            <Button type="button" variant="outline" disabled={pending} onClick={() => window.confirm("Go back to the built-in wording? Your text is removed.") && run(() => resetEmailTemplate({ kind: template.kind }), "Back to the built-in wording.")}>
              Use the built-in wording
            </Button>
          ) : null}
        </div>
      </form>
      {preview ? (
        <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm" aria-label="Preview">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview (for Ana Reyes, Virtual Assistant)</p>
          <p className="font-semibold">{preview.subject}</p>
          <p className="whitespace-pre-wrap">{preview.text}</p>
        </div>
      ) : null}
    </section>
  );
}
