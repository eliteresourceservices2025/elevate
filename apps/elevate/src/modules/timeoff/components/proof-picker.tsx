"use client";

import { toast } from "@/components/feedback-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { requestLeaveEvidenceUpload } from "../request-actions";

export const PROOF_MAX_FILES = 3;
const MAX_FILE_BYTES = 5_000_000;

/** Choose up to three screenshots of the client's approval. They are uploaded when the request is sent. */
export function ProofPicker({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="rq-proof">Screenshot of your client&apos;s approval (required)</Label>
      <Input
        id="rq-proof"
        type="file"
        accept="image/jpeg,image/png"
        multiple
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, PROOF_MAX_FILES);
          if ((e.target.files?.length ?? 0) > PROOF_MAX_FILES) toast.error(`Attach ${PROOF_MAX_FILES} screenshots at most.`);
          if (picked.some((f) => f.size > MAX_FILE_BYTES)) {
            toast.error("Each screenshot must be 5 MB or smaller.");
            e.target.value = "";
            return setFiles([]);
          }
          setFiles(picked);
        }}
      />
      <p className="text-xs text-muted-foreground">
        A JPG or PNG up to 5 MB, three at most. <strong>Never include client or patient information.</strong> Only you, your leads and HR can open it, and it is deleted 90 days after the request is decided.
        {files.length > 0 ? ` ${files.length} chosen.` : ""}
      </p>
    </div>
  );
}

/** Uploads each chosen screenshot straight to private storage and returns their ids (or the first problem). */
export async function uploadProofs(files: File[], forEmployeeId?: string): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const ids: string[] = [];
  for (const file of files) {
    const ticket = await requestLeaveEvidenceUpload({ mime: file.type, size: file.size, employeeId: forEmployeeId });
    if (!ticket.ok) return { ok: false, error: ticket.error };
    const { error } = await createSupabaseBrowserClient().storage.from("employee-docs").uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
    if (error) return { ok: false, error: "A screenshot did not upload. Try again." };
    ids.push(ticket.data.id);
  }
  return { ok: true, ids };
}
