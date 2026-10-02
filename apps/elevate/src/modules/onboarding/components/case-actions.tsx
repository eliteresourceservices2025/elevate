"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/modules/recruiting/components/use-run";
import { cancelOffboarding, completeOffboarding, completeOnboarding, issueCertificate, removeAccessNow, startOffboarding, submitExitInterview } from "../actions";
import { LEAVING_LABELS, LEAVING_REASONS, type LeavingReason } from "../constants";

export function CompleteOnboardingButton({ caseId, ready }: { caseId: string; ready: boolean }) {
  const { run, pending } = useRun();
  return (
    <div className="space-y-1">
      <Button disabled={pending || !ready} onClick={() => run(() => completeOnboarding({ caseId }), "Onboarding complete. The person is now active.")}>
        Complete onboarding
      </Button>
      {ready ? null : <p className="text-xs text-muted-foreground">Every required task has to be done first.</p>}
    </div>
  );
}

/** HR's controls on an offboarding: remove access now, cancel, complete, issue a certificate. */
export function OffboardingControls({ caseId, employeeId, accessRemoved, open, ready }: { caseId: string; employeeId: string; accessRemoved: boolean; open: boolean; ready: boolean }) {
  const { run, pending, router } = useRun();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">HR actions</h2>
      <div className="flex flex-wrap gap-2">
        {open && !accessRemoved ? (
          confirm ? (
            <>
              <Button variant="destructive" disabled={pending} onClick={() => run(() => removeAccessNow({ caseId }), "Access removed.", () => setConfirm(false))}>
                Yes, remove access now
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>
                Never mind
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              Remove access now
            </Button>
          )
        ) : null}
        {open && !accessRemoved ? (
          <Button variant="outline" disabled={pending} onClick={() => run(() => cancelOffboarding({ caseId }), "Offboarding cancelled.", () => router.push("/offboarding"))}>
            Cancel offboarding
          </Button>
        ) : null}
        {open && accessRemoved ? (
          <Button disabled={pending || !ready} onClick={() => run(() => completeOffboarding({ caseId }), "Offboarding complete.")}>
            Complete offboarding
          </Button>
        ) : null}
        <Button variant="outline" disabled={pending} onClick={() => run(() => issueCertificate({ employeeId }), (d) => `Certificate ${(d as { reference: string } | undefined)?.reference ?? ""} issued.`)}>
          Issue certificate of engagement
        </Button>
      </div>
      {confirm ? <p className="text-sm text-muted-foreground">They are marked separated, lose their client assignments and schedule, and can no longer sign in.</p> : null}
    </div>
  );
}

export function StartOffboardingForm({ people, today }: { people: { id: string; name: string; position: string | null }[]; today: string }) {
  const { run, pending, router } = useRun();
  const [employeeId, setEmployeeId] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState(today);
  const [reason, setReason] = useState<LeavingReason>("resignation");
  const [note, setNote] = useState("");
  return (
    <form
      className="max-w-xl space-y-4 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => startOffboarding({ employeeId, lastWorkingDay, reason, note }), "Offboarding started.", (d) => router.push(`/offboarding/${(d as { caseId: string }).caseId}`));
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="off-person">Person</Label>
        <NativeSelect id="off-person" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
          <option value="">Choose a person</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.position ? `, ${p.position}` : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="off-day">Last working day</Label>
        <Input id="off-day" type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Access is removed automatically when this day ends in their own time zone.</p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="off-reason">Reason</Label>
        <NativeSelect id="off-reason" value={reason} onChange={(e) => setReason(e.target.value as LeavingReason)}>
          {LEAVING_REASONS.map((r) => (
            <option key={r} value={r}>
              {/* eslint-disable-next-line security/detect-object-injection -- r comes from the fixed LEAVING_REASONS list */}
              {LEAVING_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1">
        <Label htmlFor="off-note">Note (only HR sees it)</Label>
        <Textarea id="off-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </div>
      <Button type="submit" disabled={pending || !employeeId}>
        Start offboarding
      </Button>
    </form>
  );
}

export function ExitInterviewForm({ caseId }: { caseId: string }) {
  const { run, pending } = useRun();
  const [reasonForLeaving, setReason] = useState("");
  const [wentWell, setWell] = useState("");
  const [toImprove, setImprove] = useState("");
  const [wouldReturn, setReturn] = useState<"yes" | "maybe" | "no">("maybe");
  return (
    <form
      className="space-y-3 rounded-xl border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => submitExitInterview({ caseId, reasonForLeaving, wentWell, toImprove, wouldReturn }), "Thank you. Your exit interview was sent to HR.");
      }}
    >
      <h2 className="text-lg font-semibold">Exit interview</h2>
      <p className="text-sm text-muted-foreground">Private: only HR reads it. Please do not include client or patient information.</p>
      <div className="space-y-1">
        <Label htmlFor="x-reason">Main reason for leaving</Label>
        <Textarea id="x-reason" value={reasonForLeaving} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-well">What went well</Label>
        <Textarea id="x-well" value={wentWell} onChange={(e) => setWell(e.target.value)} maxLength={2000} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-improve">What could be better</Label>
        <Textarea id="x-improve" value={toImprove} onChange={(e) => setImprove(e.target.value)} maxLength={2000} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="x-return">Would you work with ERS again?</Label>
        <NativeSelect id="x-return" value={wouldReturn} onChange={(e) => setReturn(e.target.value as "yes" | "maybe" | "no")}>
          <option value="yes">Yes</option>
          <option value="maybe">Maybe</option>
          <option value="no">No</option>
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending || reasonForLeaving.trim().length < 3}>
        Submit
      </Button>
    </form>
  );
}
