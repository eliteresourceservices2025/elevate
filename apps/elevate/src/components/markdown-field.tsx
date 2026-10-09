"use client";

import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * A text box for Markdown with a Preview that shows the text exactly as readers will see it (the same renderer and the same frame as
 * the published page), and a character count against the limit. The text stays in the parent's state, so switching back and forth
 * loses nothing.
 */
export function MarkdownField({
  id,
  label,
  value,
  onChange,
  hint,
  rows = 10,
  maxLength = 10_000,
  required,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div role="group" aria-label={`${label} view`} className="flex gap-1">
          <Button type="button" size="sm" variant={preview ? "ghost" : "secondary"} aria-pressed={!preview} onClick={() => setPreview(false)}>
            Write
          </Button>
          <Button type="button" size="sm" variant={preview ? "secondary" : "ghost"} aria-pressed={preview} onClick={() => setPreview(true)}>
            Preview
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="space-y-2">
          <article aria-label={`${label}, preview`} className="min-h-24 rounded-xl border bg-card p-5">
            {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted-foreground">Nothing to preview yet.</p>}
          </article>
          <p className="text-xs text-muted-foreground">This is how it will look when published.</p>
        </div>
      ) : (
        <>
          <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} maxLength={maxLength} required={required} disabled={disabled} aria-describedby={`${id}-hint`} />
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        </>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {value.length.toLocaleString("en-US")} of {maxLength.toLocaleString("en-US")} characters
      </p>
    </div>
  );
}
