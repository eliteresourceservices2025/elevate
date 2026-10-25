"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** `detail` is a second identifier (employee number, work email) that tells two people with the same name apart. */
export type PickerOption = { id: string; label: string; detail?: string };

/**
 * Type to search, choose from the list. Controlled by an id (or empty). While the text does not match
 * a person, `onChange` receives the raw text, so a schema that expects an id reports "choose from the
 * list" instead of silently ignoring what was typed. The box always shows the person the id belongs to,
 * also when the id is changed from outside (reset, another control) or the options change.
 */
export function PersonPicker({
  id,
  label,
  options,
  value,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  options: readonly PickerOption[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  error?: string;
  hint?: string;
}) {
  const listId = useId();

  // What each option is called in the box. Two people who still read the same get a number, so every text maps to one id.
  const shown = useMemo(() => {
    const base = options.map((o) => ({ id: o.id, text: o.detail ? `${o.label} (${o.detail})` : o.label }));
    const seen = new Map<string, number>();
    return base.map((o) => {
      const key = o.text.toLowerCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return n === 1 ? o : { ...o, text: `${o.text} #${n}` };
    });
  }, [options]);

  const textFor = (v: string | undefined) => shown.find((o) => o.id === v)?.text;
  const [text, setText] = useState(textFor(value) ?? "");
  const [seenValue, setSeenValue] = useState(value);

  // The id was set from outside: show that person (or nothing). Typing that resolves to the same id is left alone.
  if (value !== seenValue) {
    setSeenValue(value);
    const typedMatch = shown.find((o) => o.text.toLowerCase() === text.trim().toLowerCase());
    if (value === undefined) setText("");
    else if (typedMatch?.id !== value) setText(textFor(value) ?? text);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          list={listId}
          autoComplete="off"
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined}
          placeholder="Start typing a name"
          className={text ? "pr-10" : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            if (next.trim() === "") return onChange(undefined);
            const match = shown.find((o) => o.text.toLowerCase() === next.trim().toLowerCase());
            onChange(match ? match.id : next);
          }}
        />
        {text ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Clear ${label}`}
            className="absolute top-1/2 right-1 -translate-y-1/2"
            onClick={() => {
              setText("");
              onChange(undefined);
            }}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <datalist id={listId}>
        {shown.map((o) => (
          <option key={o.id} value={o.text} />
        ))}
      </datalist>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
