"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { archiveDocumentType, createDocumentType, updateDocumentType } from "../actions";
import type { TypeAdminRow } from "../queries";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

function Flags({ scope, requiresExpiry, setRequiresExpiry, requiresClient, setRequiresClient, requiredForAll, setRequiredForAll }: {
  scope: "employee" | "company";
  requiresExpiry: boolean; setRequiresExpiry: (v: boolean) => void;
  requiresClient: boolean; setRequiresClient: (v: boolean) => void;
  requiredForAll: boolean; setRequiredForAll: (v: boolean) => void;
}) {
  const box = (label: string, checked: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-primary" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {box("Has an expiry date", requiresExpiry, setRequiresExpiry)}
      {scope === "employee" ? box("Tied to a client", requiresClient, setRequiresClient) : null}
      {scope === "employee" ? box("Everyone needs one", requiredForAll, setRequiredForAll) : null}
    </div>
  );
}

export function NewTypeForm() {
  const { run, pending } = useRun();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"employee" | "company">("employee");
  const [requiresExpiry, setRequiresExpiry] = useState(false);
  const [requiresClient, setRequiresClient] = useState(false);
  const [requiredForAll, setRequiredForAll] = useState(false);

  return (
    <form
      className="space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createDocumentType({ name, scope, requiresExpiry, requiresClient, requiredForAll }), "Document type added.", () => {
          setName("");
          setRequiresExpiry(false);
          setRequiresClient(false);
          setRequiredForAll(false);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="nt-name" label="New document type" value={name} onChange={(e) => setName(e.target.value)} required />
        <SelectField id="nt-scope" label="Belongs to" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="employee">A person</option>
          <option value="company">The company</option>
        </SelectField>
      </div>
      <Flags scope={scope} {...{ requiresExpiry, setRequiresExpiry, requiresClient, setRequiresClient, requiredForAll, setRequiredForAll }} />
      <Button type="submit" disabled={pending || name.trim().length < 2}>
        Add type
      </Button>
    </form>
  );
}

export function TypeRow({ type }: { type: TypeAdminRow }) {
  const { run, pending } = useRun();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);
  const [requiresExpiry, setRequiresExpiry] = useState(type.requiresExpiry);
  const [requiresClient, setRequiresClient] = useState(type.requiresClient);
  const [requiredForAll, setRequiredForAll] = useState(type.requiredForAll);

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{type.name}</span>
          <Badge variant="outline">{type.scope === "company" ? "Company" : "Person"}</Badge>
          {type.requiresExpiry ? <Badge variant="secondary">Expiry</Badge> : null}
          {type.requiresClient ? <Badge variant="secondary">Client</Badge> : null}
          {type.requiredForAll ? <Badge>Required</Badge> : null}
          <span className="text-xs text-muted-foreground">{type.documents} {type.documents === 1 ? "document" : "documents"}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => window.confirm(`Retire "${type.name}"? Existing documents stay; nobody can upload this type any more.`) && run(() => archiveDocumentType({ typeId: type.id }), "Type retired.")}
          >
            Retire
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="py-3">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateDocumentType({ typeId: type.id, name, scope: type.scope, requiresExpiry, requiresClient, requiredForAll }), "Type updated.", () => setEditing(false));
        }}
      >
        <TextField id={`tn-${type.id}`} label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Flags scope={type.scope} {...{ requiresExpiry, setRequiresExpiry, requiresClient, setRequiresClient, requiredForAll, setRequiredForAll }} />
        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}
