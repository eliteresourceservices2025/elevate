"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { closeSafevoiceCase, replyToSafevoiceCase, setSafevoiceCaseStatus } from "../actions";
import { OUTCOME_LABELS, SAFEVOICE_OUTCOMES, type SafevoiceOutcome, type SafevoiceStatus } from "../constants";

/** Reply, status and closing for one case. The reporter reads replies with their case code; nothing here identifies them. */
export function CaseControls({ caseId, status }: { caseId: string; status: SafevoiceStatus }) {
  const { run, pending } = useRun();
  const [body, setBody] = useState("");
  const [expectReply, setExpectReply] = useState(true);
  const [outcome, setOutcome] = useState<SafevoiceOutcome | "">("");
  const [closing, setClosing] = useState(false);
  const [message, setMessage] = useState("");

  if (status === "closed") {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">This case is closed</h2>
        <p className="text-sm text-muted-foreground">The reporter can no longer write. Reopen it to reply again.</p>
        <Button variant="outline" disabled={pending} onClick={() => run(() => setSafevoiceCaseStatus({ caseId, status: "in_review" }), "Case reopened.")}>
          Reopen case
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-xl border bg-card p-4">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => replyToSafevoiceCase({ caseId, body, expectReply }), "Reply sent.", () => setBody(""));
        }}
      >
        <h2 className="text-lg font-semibold">Reply to the reporter</h2>
        <p className="text-xs text-muted-foreground">The reporter sees this the next time they open their case with their code. Do not guess who they are, and do not include client or patient information.</p>
        <div className="space-y-1.5">
          <Label htmlFor="sv-reply">Message</Label>
          <Textarea id="sv-reply" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} required />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={expectReply} onChange={(e) => setExpectReply(e.target.checked)} />
          Ask the reporter to reply (sets the case to &ldquo;Waiting for the reporter&rdquo;)
        </label>
        <Button type="submit" disabled={pending || body.trim() === ""}>
          Send reply
        </Button>
      </form>

      <div className="space-y-2 border-t pt-4">
        <h2 className="text-lg font-semibold">Status</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending || status === "in_review"} onClick={() => run(() => setSafevoiceCaseStatus({ caseId, status: "in_review" }), "Marked in review.")}>
            Mark in review
          </Button>
          <Button variant="outline" disabled={pending || status === "awaiting_reporter"} onClick={() => run(() => setSafevoiceCaseStatus({ caseId, status: "awaiting_reporter" }), "Marked waiting for the reporter.")}>
            Waiting for the reporter
          </Button>
          <Button variant="outline" onClick={() => setClosing((v) => !v)} aria-expanded={closing}>
            Close case...
          </Button>
        </div>
      </div>

      {closing ? (
        <form
          className="space-y-3 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!outcome) return;
            run(() => closeSafevoiceCase({ caseId, outcome, message }), "Case closed.", () => setClosing(false));
          }}
        >
          <h2 className="text-lg font-semibold">Close with an outcome</h2>
          <div className="space-y-1.5">
            <Label htmlFor="sv-outcome">Outcome</Label>
            <NativeSelect id="sv-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as SafevoiceOutcome | "")} required>
              <option value="">Choose an outcome</option>
              {SAFEVOICE_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {/* eslint-disable-next-line security/detect-object-injection -- `o` is from the fixed outcome list */}
                  {OUTCOME_LABELS[o]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sv-close-message">Closing message to the reporter (optional)</Label>
            <Textarea id="sv-close-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={4000} />
          </div>
          <p className="text-xs text-muted-foreground">The reporter will see the outcome and cannot write again unless you reopen the case.</p>
          <Button type="submit" disabled={pending || !outcome}>
            Close case
          </Button>
        </form>
      ) : null}
    </div>
  );
}
