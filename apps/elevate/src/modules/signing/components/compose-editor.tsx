"use client";

import { useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_COMPOSED_CHARS, normalizeTypography } from "../constants";
import { htmlToMarkdown } from "../html-to-markdown";
import { SIGNEE_FIELDS, previewFields } from "../merge";

type Edit = { value: string; start: number; end: number };

/** Wraps the selection ("**" for bold). */
function applyWrap(value: string, start: number, end: number, mark: string): Edit {
  const picked = value.slice(start, end) || "text";
  const next = `${value.slice(0, start)}${mark}${picked}${mark}${value.slice(end)}`;
  return { value: next, start: start + mark.length, end: start + mark.length + picked.length };
}

/** Puts a prefix at the start of each selected line ("- " for a bullet), replacing any prefix the line already had. */
function applyPrefix(value: string, start: number, end: number, prefix: string, numbered = false): Edit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const found = value.indexOf("\n", end);
  const lineEnd = found === -1 ? value.length : found;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const changed = lines.map((l, i) => `${numbered ? `${i + 1}. ` : prefix}${l.replace(/^(#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s+)/, "")}`).join("\n");
  return { value: `${value.slice(0, lineStart)}${changed}${value.slice(lineEnd)}`, start: lineStart, end: lineStart + changed.length };
}

/**
 * Where HR writes the document: a toolbar (bold, italic, headings, lists, quote), a preview that shows what the PDF will look like,
 * and paste from Word or Google Docs that keeps headings, bold and lists. The text is Markdown underneath (the same safe renderer
 * as announcements), so nothing in it can run or load anything.
 */
export function ComposeEditor({ value, onChange, title = "" }: { value: string; onChange: (value: string) => void; title?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  // Standard PDF fonts draw Latin-1 (plus common punctuation); anything else prints as "?".
  const nonLatin = /[^\u0000-ÿ]/.test(normalizeTypography(value));

  const run = (make: (v: string, s: number, e: number) => Edit) => {
    const el = ref.current;
    if (!el) return;
    const edit = make(value, el.selectionStart, el.selectionEnd);
    onChange(edit.value.slice(0, MAX_COMPOSED_CHARS));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(edit.start, edit.end);
    });
  };

  const tools: { label: string; title: string; make: (v: string, s: number, e: number) => Edit }[] = [
    { label: "B", title: "Bold", make: (v, s, e) => applyWrap(v, s, e, "**") },
    { label: "I", title: "Italic", make: (v, s, e) => applyWrap(v, s, e, "*") },
    { label: "H1", title: "Large heading", make: (v, s, e) => applyPrefix(v, s, e, "# ") },
    { label: "H2", title: "Heading", make: (v, s, e) => applyPrefix(v, s, e, "## ") },
    { label: "• List", title: "Bullet list", make: (v, s, e) => applyPrefix(v, s, e, "- ") },
    { label: "1. List", title: "Numbered list", make: (v, s, e) => applyPrefix(v, s, e, "", true) },
    { label: "Quote", title: "Quote", make: (v, s, e) => applyPrefix(v, s, e, "> ") },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="compose-body">Document text</Label>
        <div role="group" aria-label="Write or preview" className="flex gap-1">
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
          {/* The same design as the PDF: logo with room above it, centered bold title, the text, and the footer. Page breaks differ. */}
          <article aria-label="Preview of the document" className="relative min-h-96 overflow-clip rounded-xl border bg-white px-8 pb-12 pt-10 text-neutral-900 shadow-sm sm:px-16">
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed brand image in a preview */}
            <img src="/elite-logo-icon.png" alt="" aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 w-3/5 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]" />
            <div className="relative">
              <div className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixed brand image in a preview */}
                <img src="/elite-logo-icon.png" alt="ELITE Resource Services" className="h-20 w-auto" />
                <h2 className="mt-4 text-center text-xl font-bold leading-tight">{title.trim() || "Document title"}</h2>
              </div>
              <div className="mt-6">
                {value.trim() ? <Markdown source={previewFields(value)} maxLength={MAX_COMPOSED_CHARS} /> : <p className="text-sm text-neutral-500">Nothing to preview yet.</p>}
              </div>
              <p className="mt-10 border-t pt-2 text-[10px] font-bold tracking-wider text-neutral-600">ELITE RESOURCE SERVICES</p>
            </div>
          </article>
          <p className="text-xs text-muted-foreground">This is how the document will look. Page breaks are placed when the PDF is made.</p>
        </div>
      ) : (
        <>
          <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
            {tools.map((t) => (
              <Button key={t.title} type="button" size="sm" variant="outline" title={t.title} aria-label={t.title} onClick={() => run(t.make)}>
                {t.label}
              </Button>
            ))}
          </div>
          <Textarea
            id="compose-body"
            ref={ref}
            value={value}
            rows={18}
            maxLength={MAX_COMPOSED_CHARS}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const md = htmlToMarkdown(e.clipboardData.getData("text/html"));
              if (!md) return; // plain text pastes as it is
              e.preventDefault();
              const el = e.currentTarget;
              onChange(`${value.slice(0, el.selectionStart)}${md}${value.slice(el.selectionEnd)}`.slice(0, MAX_COMPOSED_CHARS));
            }}
            aria-describedby="compose-hint"
          />
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Fill in from the person&apos;s record:</span>
            {SIGNEE_FIELDS.map((f) => (
              <Button key={f.key} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" title={`Insert {{${f.key}}}`} onClick={() => run((v, s, e) => ({ value: `${v.slice(0, s)}{{${f.key}}}${v.slice(e)}`, start: s + f.key.length + 4, end: s + f.key.length + 4 }))}>
                {f.label}
              </Button>
            ))}
          </div>
          <p id="compose-hint" className="text-xs text-muted-foreground">
            Type or paste the document. Pasting from Word or Google Docs keeps headings, bold, italic and lists. Do not include client or patient information. A field such as {"{{contractor_name}}"} is replaced with each person&apos;s details when it is sent, so the document goes out as each person&apos;s own copy.
          </p>
        </>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {value.length.toLocaleString("en-US")} of {MAX_COMPOSED_CHARS.toLocaleString("en-US")} characters
      </p>
      {nonLatin ? (
        <p role="alert" className="text-xs text-destructive">
          Some characters (for example emoji or non-English letters) cannot be drawn in the PDF and will print as &ldquo;?&rdquo;.
        </p>
      ) : null}
    </div>
  );
}
