"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchPeopleForChat } from "../actions";

export type ChatPerson = { userId: string; name: string; position: string | null };

/**
 * Search by name or position and pick people. `selected` is controlled; `onToggle` adds or removes one. With `onAddAll` the picker
 * offers "Add everyone shown" (for a big group: search a team or position, add them all at once). `max` stops adding at that many.
 */
export function PeoplePicker({
  selected,
  onToggle,
  onAddAll,
  hide = [],
}: {
  selected: ChatPerson[];
  onToggle: (person: ChatPerson) => void;
  onAddAll?: (people: ChatPerson[]) => void;
  hide?: string[];
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ChatPerson[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchPeopleForChat({ q });
      if (cancelled) return;
      if (result.ok) {
        setError(null);
        setResults(result.data);
      } else setError(result.error);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const chosen = new Set(selected.map((p) => p.userId));
  const shown = results.filter((p) => !hide.includes(p.userId));
  const notYet = shown.filter((p) => !chosen.has(p.userId));
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="chat-people-search" className="text-sm font-medium">
        Find people
      </label>
      <Input id="chat-people-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or position" autoComplete="off" />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite">{selected.length} chosen</span>
        {onAddAll && notYet.length > 0 ? (
          <Button type="button" variant="outline" size="xs" onClick={() => onAddAll(notYet)}>
            Add everyone shown ({notYet.length})
          </Button>
        ) : null}
      </div>
      {selected.length > 0 ? (
        <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto" aria-label="Chosen people">
          {selected.map((p) => (
            <li key={p.userId}>
              <button type="button" onClick={() => onToggle(p)} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground hover:bg-muted" aria-label={`Remove ${p.name}`}>
                {p.name} ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <ul className="max-h-64 overflow-y-auto rounded-lg border" aria-label="People">
        {shown.length === 0 ? <li className="p-3 text-sm text-muted-foreground">No one found.</li> : null}
        {shown.map((p) => {
          const on = chosen.has(p.userId);
          return (
            <li key={p.userId} className="border-b last:border-b-0">
              <button type="button" onClick={() => onToggle(p)} aria-pressed={on} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", on && "bg-secondary")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  {p.position ? <span className="block truncate text-xs text-muted-foreground">{p.position}</span> : null}
                </span>
                {on ? <Check className="size-4 text-primary" aria-hidden /> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
