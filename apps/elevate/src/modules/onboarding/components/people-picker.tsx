"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type PickPerson = { id: string; name: string; position: string | null };

/**
 * Tick one or many people: a search box, "Select all shown" and a count. Used where HR starts onboarding or offboarding for several
 * people at once. Ticking is only a choice on screen; the server checks every person on its own when the form is sent.
 */
export function PeoplePicker({ idPrefix, people, selected, onChange }: { idPrefix: string; people: PickPerson[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? people.filter((p) => `${p.name} ${p.position ?? ""}`.toLowerCase().includes(needle)) : people;
  }, [people, q]);
  const chosen = new Set(selected);
  const allShown = shown.length > 0 && shown.every((p) => chosen.has(p.id));

  const toggle = (id: string) => onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleShown = () => {
    if (allShown) onChange(selected.filter((id) => !shown.some((p) => p.id === id)));
    else onChange([...selected, ...shown.filter((p) => !chosen.has(p.id)).map((p) => p.id)]);
  };

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">People</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`${idPrefix}-search`} className="sr-only">
          Search people
        </Label>
        <Input id={`${idPrefix}-search`} type="search" placeholder="Search by name or position" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Button type="button" variant="outline" size="sm" onClick={toggleShown} disabled={shown.length === 0}>
          {allShown ? "Clear shown" : "Select all shown"}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length} selected
        </span>
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border bg-background" aria-label="People to choose from">
        {shown.length === 0 ? <li className="p-3 text-sm text-muted-foreground">No one matches.</li> : null}
        {shown.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
              <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
              <span>
                {p.name}
                {p.position ? <span className="text-muted-foreground">, {p.position}</span> : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
