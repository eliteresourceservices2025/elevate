"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectField, TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cancelUpload, finalizeUpload, requestUpload } from "../actions";
import { ALLOWED_MIME_TYPES, ALLOWED_TYPES_TEXT, MAX_FILE_BYTES, formatBytes } from "../files";
import type { TypeOption } from "../queries";

type Props = {
  target: "employee" | "company";
  employeeId?: string;
  types: TypeOption[];
  clients: { id: string; name: string }[];
  today: string;
};

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.docx";

/**
 * Three steps, all checked on the server: (1) ask for a one-time upload link for one exact path,
 * (2) send the file straight to private storage, (3) ask the server to inspect it and save it.
 */
export function UploadForm({ target, employeeId, types, clients, today }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState("");

  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [clientId, setClientId] = useState("");
  const [audience, setAudience] = useState<"all_staff" | "hr_only">("all_staff");
  const [acknowledged, setAcknowledged] = useState(false);

  const type = types.find((t) => t.id === typeId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return void toast.error("Choose a file.");
    if (file.size > MAX_FILE_BYTES) return void toast.error(`That file is ${formatBytes(file.size)}. Files can be 10 MB at most.`);
    if (!ALLOWED_MIME_TYPES.includes(file.type)) return void toast.error(`Only ${ALLOWED_TYPES_TEXT} files are allowed.`);

    startTransition(async () => {
      setStatus("Preparing…");
      const ticket = await requestUpload({
        target,
        employeeId,
        typeId,
        title,
        clientId: clientId || undefined,
        expiresOn: expiresOn || undefined,
        audience,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        acknowledged,
      });
      if (!ticket.ok) {
        setStatus("");
        return void toast.error(ticket.error);
      }

      setStatus("Uploading…");
      const { error } = await createSupabaseBrowserClient()
        .storage.from(ticket.data.bucket)
        .uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: ticket.data.contentType });
      if (error) {
        await cancelUpload({ documentId: ticket.data.documentId });
        setStatus("");
        return void toast.error("The upload did not go through. Try again.");
      }

      setStatus("Checking the file…");
      const done = await finalizeUpload({ documentId: ticket.data.documentId });
      setStatus("");
      if (!done.ok) return void toast.error(done.error);

      toast.success("Document saved.");
      setTypeId("");
      setTitle("");
      setExpiresOn("");
      setClientId("");
      setAcknowledged(false);
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-4" noValidate>
      <div role="note" className="flex gap-2 rounded-lg border border-brand-gold bg-brand-gold/10 p-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-brand-gold-deep dark:text-brand-gold-light" aria-hidden />
        <p>
          <strong>Do not upload client records or patient information.</strong> This vault is for employment documents only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField id="up-type" label="Document type" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextField id="up-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} hint="For example: NBI clearance 2026" required />
        {type?.requiresExpiry ? (
          <TextField id="up-expiry" label="Expiry date" type="date" min={today} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} hint="You are reminded 30 and 7 days before." required />
        ) : (
          <TextField id="up-expiry" label="Expiry date (optional)" type="date" min={today} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        )}
        {type?.requiresClient ? (
          <SelectField id="up-client" label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {target === "company" ? (
          <SelectField id="up-audience" label="Who can read it" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
            <option value="all_staff">All staff</option>
            <option value="hr_only">HR only</option>
          </SelectField>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="up-file" className="text-sm font-medium">
          File
        </label>
        <input
          ref={fileInput}
          id="up-file"
          type="file"
          accept={ACCEPT}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">{ALLOWED_TYPES_TEXT}, up to 10 MB.</p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 size-4 accent-primary" />
        This file contains no client or patient information.
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !acknowledged || !typeId || title.trim().length < 2}>
          Upload
        </Button>
        {status ? (
          <span role="status" className="text-sm text-muted-foreground">
            {status}
          </span>
        ) : null}
      </div>
    </form>
  );
}
