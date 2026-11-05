"use client";

import { useState } from "react";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { approveRun, sendBackRun, submitRun } from "../actions";
import { APPROVAL_LABELS as A, type RunStatus } from "../constants";

// The review step under the worksheet: a Preparer sends a draft for review; an Approver approves it (against the hash of exactly what
// this page showed) or sends it back with a note. The server re-checks everything; this bar only offers what makes sense.

function SendBackForm({ runId }: { runId: string }) {
  const { run, pending } = useRun();
  const dialog = useFormDialog();
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => sendBackRun({ runId, note }), A.sentBack, () => dialog?.close(true));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="send-back-note">{A.sendBackNote}</Label>
        <Textarea id="send-back-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} required />
        <p className="text-xs text-muted-foreground">{A.sendBackHint}</p>
      </div>
      <Button type="submit" disabled={pending}>
        {A.sendBack}
      </Button>
    </form>
  );
}

export function ApprovalBar({
  runId,
  status,
  canPrepare,
  canApprove,
  blocking,
  expectedHash,
  refusal,
  sentBackNote,
}: {
  runId: string;
  status: RunStatus;
  canPrepare: boolean;
  canApprove: boolean;
  blocking: number;
  expectedHash: string | null;
  refusal: string | null;
  sentBackNote: string | null;
}) {
  const { run, pending } = useRun();

  if (status === "draft") {
    return (
      <div className="space-y-3">
        {sentBackNote ? (
          <Alert variant="warning" className="rounded-lg p-3 text-sm">
            <p className="font-medium">{A.sentBackNotice}</p>
            <p className="whitespace-pre-line">{sentBackNote}</p>
          </Alert>
        ) : null}
        {canPrepare ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={pending || blocking > 0} onClick={() => run(() => submitRun({ runId }), A.submitted)}>
              {A.submit}
            </Button>
            {blocking > 0 ? <span className="text-sm text-muted-foreground">{A.submitBlocked}</span> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (status === "approved") {
    return (
      <Alert variant="success" className="rounded-lg p-3 text-sm">
        {A.approvedNotice}
      </Alert>
    );
  }

  if (status !== "in_review") return null;
  return (
    <div className="space-y-3">
      <Alert variant="info" className="rounded-lg p-3 text-sm">
        {A.inReview}
      </Alert>
      {canApprove ? (
        <>
          {refusal ? (
            <Alert variant="warning" className="rounded-lg p-3 text-sm">
              {refusal}
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">{A.approveHint}</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={pending || refusal !== null || expectedHash === null}
              onClick={() => expectedHash && run(() => approveRun({ runId, expectedHash }), A.approved)}
            >
              {A.approve}
            </Button>
            <FormDialog label={A.sendBack} title={A.sendBackTitle} variant="outline">
              <SendBackForm runId={runId} />
            </FormDialog>
          </div>
        </>
      ) : null}
    </div>
  );
}
