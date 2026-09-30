"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PickerOption = { id: string; label: string };

/**
 * Type to search, choose from the list. Controlled by an id (or empty). While the text does not match
 * a person, `onChange` receives the raw text, so a schema that expects an id reports "choose from the
 * list" instead of silently ignoring what was typed.
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
  const selected = options.find((o) => o.id === value);
  const [text, setText] = useState(selected?.label ?? "");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        list={listId}
        autoComplete="off"
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        placeholder="Start typing a name"
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (next.trim() === "") return onChange(undefined);
          const match = options.find((o) => o.label.toLowerCase() === next.trim().toLowerCase());
          onChange(match ? match.id : next);
        }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.label} />
        ))}
      </datalist>
      {hint && !error ? (
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
