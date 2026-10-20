"use client";

import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { requestEvidenceUpload } from "../actions";

export const MAX_EVIDENCE_FILES = 3;
export const MAX_EVIDENCE_BYTES = 5_000_000;

/**
 * Uploads each screenshot straight to private storage (the server hands out a one-time ticket per file) and returns their ids to send
 * with the request. Used by the time correction appeal and the technical issue report.
 */
export async function uploadEvidence(files: File[]): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids: string[] = [];
  for (const f of files) {
    const ticket = await requestEvidenceUpload({ mime: f.type, size: f.size });
    if (!ticket.ok) return ticket;
    const { error } = await createSupabaseBrowserClient().storage.from("employee-docs").uploadToSignedUrl(ticket.data.path, ticket.data.token, f, { contentType: f.type });
    if (error) return { ok: false, error: "A screenshot did not upload. Try again." };
    ids.push(ticket.data.id);
  }
  return { ok: true, ids };
}

/** The screenshot picker: JPG or PNG up to 5 MB, three at most. `required` only labels it; the server insists too. */
export function EvidenceField({ id, label, required = true, onFiles, children }: { id: string; label: string; required?: boolean; onFiles: (files: File[]) => void; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? " (required)" : " (optional)"}
      </Label>
      <Input
        id={id}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        required={required}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, MAX_EVIDENCE_FILES);
          if ((e.target.files?.length ?? 0) > MAX_EVIDENCE_FILES) toast.error(`Attach ${MAX_EVIDENCE_FILES} screenshots at most.`);
          const tooBig = picked.find((f) => f.size > MAX_EVIDENCE_BYTES);
          if (tooBig) {
            toast.error("Each screenshot must be 5 MB or smaller.");
            e.target.value = "";
            return onFiles([]);
          }
          onFiles(picked);
        }}
      />
      <p className="text-xs text-muted-foreground">
        {children} A JPG or PNG up to 5 MB, three at most. Crop it to what matters. <strong>Never include client or patient information.</strong> Only you, your leads and HR can open it, and it is deleted 90 days after the decision.
      </p>
    </div>
  );
}
