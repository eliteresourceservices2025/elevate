"use client";

import { useEffect, useState } from "react";
import { PersonPicker } from "@/components/person-picker";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS, ROLE_SLUGS } from "@/lib/roles";
import { listAudienceOptions, type AudienceOptions } from "../actions";
import type { AudienceMember } from "../audience-rules";

const has = (value: AudienceMember[], kind: AudienceMember["kind"], id: string) => value.some((m) => m.kind === kind && m.id === id);

function CheckList({ title, kind, items, value, onToggle, empty }: { title: string; kind: AudienceMember["kind"]; items: { id: string; label: string }[]; value: AudienceMember[]; onToggle: (kind: AudienceMember["kind"], id: string) => void; empty: string }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{title}</legend>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
          {items.map((item) => (
            <label key={item.id} htmlFor={`aud-${kind}-${item.id}`} className="flex items-center gap-2 text-sm">
              <input id={`aud-${kind}-${item.id}`} type="checkbox" className="size-4 accent-primary" checked={has(value, kind, item.id)} onChange={() => onToggle(kind, item.id)} />
              {item.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Who a company file is for: tick any teams, clients and roles and add named people. A person in ANY chosen group can read the file (HR and
 * Super Admin always can). The lists load when this opens.
 */
export function AudiencePicker({ value, onChange }: { value: AudienceMember[]; onChange: (next: AudienceMember[]) => void }) {
  const [options, setOptions] = useState<AudienceOptions | null>(null);
  const [failed, setFailed] = useState(false);
  const [person, setPerson] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listAudienceOptions().then((r) => {
      if (cancelled) return;
      if (r.ok) setOptions(r.data);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (kind: AudienceMember["kind"], id: string) => onChange(has(value, kind, id) ? value.filter((m) => !(m.kind === kind && m.id === id)) : [...value, { kind, id }]);
  const people = options?.people ?? [];
  const chosenPeople = value.filter((m) => m.kind === "person");

  if (failed) return <p className="text-sm text-destructive">The groups could not be loaded. Close this and try again.</p>;
  if (!options) return <p className="text-sm text-muted-foreground">Loading groups…</p>;
  return (
    <div className="space-y-4 rounded-xl border bg-muted/30 p-3" aria-label="Who the file is for">
      <p className="text-sm text-muted-foreground">Pick any mix. A person who is in any one of these groups can read the file. HR and Super Admin always can.</p>
      <CheckList title="Teams" kind="team" items={options.teams} value={value} onToggle={toggle} empty="There are no teams yet." />
      <CheckList title="Clients (people currently assigned)" kind="client" items={options.clients} value={value} onToggle={toggle} empty="There are no clients yet." />
      <CheckList title="Roles" kind="role" items={ROLE_SLUGS.map((r) => ({ id: r, label: ROLE_LABELS[r] }))} value={value} onToggle={toggle} empty="" />
      <div className="space-y-1.5">
        <PersonPicker
          id="aud-person"
          label="Named people"
          options={people.filter((p) => !has(value, "person", p.id))}
          value={person}
          onChange={(id) => {
            if (id && people.some((p) => p.id === id)) {
              onChange([...value, { kind: "person", id }]);
              setPerson(undefined);
            } else setPerson(id);
          }}
          hint="Choose a person to add them."
        />
        {chosenPeople.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {chosenPeople.map((m) => (
              <li key={m.id} className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-sm">
                {people.find((p) => p.id === m.id)?.label ?? "Person"}
                <Button type="button" variant="ghost" size="xs" aria-label={`Remove ${people.find((p) => p.id === m.id)?.label ?? "person"}`} onClick={() => toggle("person", m.id)}>
                  ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{value.length} {value.length === 1 ? "group" : "groups"} chosen.</p>
    </div>
  );
}
