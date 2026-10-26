"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { SelectField, TextField } from "@/components/form-fields";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { changeDocumentType } from "../actions";
import type { DocumentRow, TypeOption } from "../queries";
import { CATEGORY_LABELS, typeStyle, type DocumentCategory } from "../type-style";

export type CategorizeOptions = { types: TypeOption[]; clients: { id: string; name: string }[]; today: string; /** Company files: also choose who may read the file. */ withAudience?: boolean };

const UNSORTED = new Set(["unsorted_employee", "unsorted_company"]);

/** The types in sections by category, without the "Unsorted" holding type. */
function groupTypes(types: TypeOption[]): { category: DocumentCategory; types: TypeOption[] }[] {
  const order = Object.keys(CATEGORY_LABELS) as DocumentCategory[];
  const usable = types.filter((t) => !UNSORTED.has(t.slug));
  return order.map((category) => ({ category, types: usable.filter((t) => typeStyle(t.slug).category === category) })).filter((g) => g.types.length > 0);
}

/** A button on a document row that opens "Set type": the real type, the title, and the expiry date or client that type needs. */
export function CategorizeDocument({ row, options, open, onOpenChange }: { row: DocumentRow; options: CategorizeOptions; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const unsorted = UNSORTED.has(row.typeSlug);
  return (
    <FormDialog label={unsorted ? "Set type" : "Change type"} title={unsorted ? "Set the type" : "Change the type"} description={row.fileName} variant={unsorted ? "default" : "outline"} open={open} onOpenChange={onOpenChange} hideTrigger={open !== undefined}>
      <CategorizeForm row={row} options={options} />
    </FormDialog>
  );
}

function CategorizeForm({ row, options }: { row: DocumentRow; options: CategorizeOptions }) {
  const router = useRouter();
  const dialog = useFormDialog();
  const [typeId, setTypeId] = useState(UNSORTED.has(row.typeSlug) ? "" : (options.types.find((t) => t.slug === row.typeSlug)?.id ?? ""));
  const [title, setTitle] = useState(row.title);
  const [expiresOn, setExpiresOn] = useState(row.expiresOn ?? "");
  const [clientId, setClientId] = useState("");
  const [audience, setAudience] = useState<"all_staff" | "hr_only">(row.audience === "all_staff" ? "all_staff" : "hr_only");
  const [pending, setPending] = useState(false);
  const type = options.types.find((t) => t.id === typeId);
  const choices = groupTypes(options.types);

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        const result = await changeDocumentType({ documentId: row.id, typeId, title, expiresOn: expiresOn || undefined, clientId: clientId || undefined, audience: options.withAudience ? audience : undefined });
        setPending(false);
        if (!result.ok) return void toast.error(result.error);
        toast.success("Type saved.");
        dialog?.close(true);
        router.refresh();
      }}
    >
      <SelectField id={`ct-type-${row.id}`} label="Document type" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
        <option value="">Choose…</option>
        {choices.map((g) => (
          <optgroup key={g.category} label={CATEGORY_LABELS[g.category]}>
            {g.types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </SelectField>
      <TextField id={`ct-title-${row.id}`} label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      {type?.requiresExpiry ? <TextField id={`ct-expiry-${row.id}`} label="Expiry date" type="date" min={options.today} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required /> : null}
      {type?.requiresClient ? (
        <SelectField id={`ct-client-${row.id}`} label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
          <option value="">Choose…</option>
          {options.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {options.withAudience ? (
        <SelectField id={`ct-audience-${row.id}`} label="Who can read it" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
          <option value="all_staff">All staff</option>
          <option value="hr_only">HR only</option>
        </SelectField>
      ) : null}
      <Button type="submit" disabled={pending || !typeId || title.trim().length < 2}>
        Save
      </Button>
    </form>
  );
}
