"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { archiveCustomFieldDef, createClient, createCustomFieldDef, updateClient } from "../actions";
import { CUSTOM_FIELD_TYPES, CUSTOM_FIELD_VISIBILITY } from "../constants";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

const COMMON_ZONES = [
  "America/Phoenix",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Asia/Manila",
];

function ZoneList() {
  return (
    <datalist id="zone-options">
      {COMMON_ZONES.map((z) => (
        <option key={z} value={z} />
      ))}
    </datalist>
  );
}

export function NewClientForm() {
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState("America/New_York");
  return (
    <form
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createClient({ name, timeZone, isActive: true }), "Client added.", () => setName(""));
      }}
    >
      <ZoneList />
      <TextField id="nc-name" label="Client name" value={name} onChange={(e) => setName(e.target.value)} required />
      <TextField id="nc-zone" label="Time zone" list="zone-options" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} hint="Names only. Never enter patient information." />
      <Button type="submit" disabled={pending || !name.trim()}>
        Add client
      </Button>
    </form>
  );
}

export function ClientRow({ client }: { client: { id: string; name: string; timeZone: string; isActive: boolean } }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(client.name);
  const [timeZone, setTimeZone] = useState(client.timeZone);

  if (!editing)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-medium">{client.name}</span>
          <span className="ml-2 text-sm text-muted-foreground">{client.timeZone}</span>
          {client.isActive ? null : <span className="ml-2 text-xs text-muted-foreground">(inactive)</span>}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => updateClient({ clientId: client.id, name: client.name, timeZone: client.timeZone, isActive: !client.isActive }), client.isActive ? "Marked inactive." : "Marked active.")}
          >
            {client.isActive ? "Mark inactive" : "Mark active"}
          </Button>
        </div>
      </div>
    );

  return (
    <form
      className="grid gap-3 sm:grid-cols-3 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateClient({ clientId: client.id, name, timeZone, isActive: client.isActive }), "Client updated.", () => setEditing(false));
      }}
    >
      <ZoneList />
      <TextField id={`ec-name-${client.id}`} label="Client name" value={name} onChange={(e) => setName(e.target.value)} required />
      <TextField id={`ec-zone-${client.id}`} label="Time zone" list="zone-options" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function NewCustomFieldForm() {
  const { run, pending } = useRun();
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<(typeof CUSTOM_FIELD_TYPES)[number]>("text");
  const [options, setOptions] = useState("");
  const [visibility, setVisibility] = useState<(typeof CUSTOM_FIELD_VISIBILITY)[number]>("hr_only");
  const [isRequired, setIsRequired] = useState(false);

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const list = options.split("\n").map((o) => o.trim()).filter(Boolean);
        run(
          () => createCustomFieldDef({ key, label, fieldType, visibility, isRequired, sortOrder: 0, ...(fieldType === "select" ? { options: list } : {}) }),
          "Field added.",
          () => {
            setKey("");
            setLabel("");
            setOptions("");
          },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        Custom fields are never encrypted, so do not use them for IDs, bank details or pay. Those have their own protected fields.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="cf-label" label="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <TextField id="cf-key" label="Key" hint="Lowercase letters, numbers, underscores. Cannot be changed later." value={key} onChange={(e) => setKey(e.target.value)} required />
        <SelectField id="cf-type" label="Type" value={fieldType} onChange={(e) => setFieldType(e.target.value as typeof fieldType)}>
          {CUSTOM_FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </SelectField>
        <SelectField id="cf-vis" label="Who can see it" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
          <option value="hr_only">HR only</option>
          <option value="employee_visible">HR and the person</option>
        </SelectField>
      </div>
      {fieldType === "select" ? (
        <div className="space-y-1.5">
          <label htmlFor="cf-options" className="text-sm font-medium">Options (one per line)</label>
          <textarea id="cf-options" value={options} onChange={(e) => setOptions(e.target.value)} rows={4} className="w-full rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
        Required
      </label>
      <Button type="submit" disabled={pending}>
        Add field
      </Button>
    </form>
  );
}

export function ArchiveFieldButton({ fieldDefId, label }: { fieldDefId: string; label: string }) {
  const { run, pending } = useRun();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (window.confirm(`Archive "${label}"? It disappears from profiles; saved values are kept.`)) run(() => archiveCustomFieldDef({ fieldDefId }), "Field archived.");
      }}
    >
      Archive
    </Button>
  );
}
