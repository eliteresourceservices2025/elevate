"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSensitive } from "../actions";
import { SENSITIVE_LABELS, type SensitiveField } from "../constants";

// HR edits. Nothing is prefilled (values are encrypted): a blank box leaves the value as it is,
// typing replaces it, and "Remove" clears it.
export function SensitiveForm({
  employeeId,
  fields,
  note,
}: {
  employeeId: string;
  fields: readonly SensitiveField[];
  note?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ReadonlyMap<SensitiveField, string>>(new Map());
  const [clear, setClear] = useState<ReadonlySet<SensitiveField>>(new Set());
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Partial<Record<SensitiveField, string | null>> = {};
    for (const f of fields) {
      const typed = values.get(f)?.trim() ?? "";
      if (clear.has(f)) payload[f] = null; // eslint-disable-line security/detect-object-injection
      else if (typed !== "") payload[f] = typed; // eslint-disable-line security/detect-object-injection
    }
    startTransition(async () => {
      const result = await updateSensitive({ employeeId, values: payload });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved. Values are encrypted.");
      setValues(new Map());
      setClear(new Set());
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <p className="text-sm text-muted-foreground">Leave a box empty to keep the current value. {note}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f} className="space-y-1.5">
            <Label htmlFor={`sens-${f}`}>{sensitiveLabel(f)}</Label>
            <Input
              id={`sens-${f}`}
              autoComplete="off"
              value={values.get(f) ?? ""}
              disabled={clear.has(f)}
              onChange={(e) => setValues((prev) => new Map(prev).set(f, e.target.value))}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={clear.has(f)}
                onChange={(e) =>
                  setClear((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(f);
                    else next.delete(f);
                    return next;
                  })
                }
              />
              Remove this value
            </label>
          </div>
        ))}
      </div>
      <Button type="submit" disabled={pending}>
        Save encrypted values
      </Button>
    </form>
  );
}

// Typed SensitiveField keys only.
function sensitiveLabel(field: SensitiveField): string {
  // eslint-disable-next-line security/detect-object-injection
  return SENSITIVE_LABELS[field];
}
