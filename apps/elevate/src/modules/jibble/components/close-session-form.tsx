"use client";

import { fromZonedTime } from "date-fns-tz";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { useFormDialog } from "@/components/form-dialog";
import { TextField } from "@/components/form-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatInZone } from "@/lib/time";
import { closeSessionAndUseElevateClock } from "../clock-source-actions";

/**
 * For a person on the Jibble clock whom ELEVATE still shows as clocked in: HR enters the time they really stopped and a reason. The
 * session ends then (a normal, audited correction shown to the person) and they move to the ELEVATE clock in one step.
 */
export function CloseSessionForm({ employeeId, name, open }: { employeeId: string; name: string; open: { since: string; onBreak: boolean; zone: string } }) {
  const dialog = useFormDialog();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState("");
  const [reason, setReason] = useState("");
  const ready = at !== "" && reason.trim().length >= 5;

  const save = () =>
    start(async () => {
      try {
        const result = await closeSessionAndUseElevateClock({ employeeId, closeAt: fromZonedTime(at, open.zone).toISOString(), reason });
        if (!result.ok) return void toast.error(result.error);
        toast.success(`${name} uses the ELEVATE clock now. The session was closed and their days are rebuilt.`);
        dialog?.close(true);
        router.refresh();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  return (
    <div className="space-y-4">
      <Alert variant="warning">
        ELEVATE shows {name} clocked in{open.onBreak ? " (on a break)" : ""} since {formatInZone(open.since, open.zone, "EEE MMM d, h:mm a")} ({open.zone}). Jibble left that entry open: closing the Jibble app does not stop its timer.
      </Alert>
      <p className="text-sm text-muted-foreground">
        If they are still clocked in in Jibble, it is better to ask them to clock out there; the next import then closes the session by itself. Otherwise enter the time they really stopped. Hours from the clock-in to that
        time count as worked (a session can be 16 hours at most, and the time cannot be in the future). The change is saved at once, kept in the record with your reason, and shown to {name}.
      </p>
      <TextField id={`cs-at-${employeeId}`} label={`When did they stop? (${open.zone})`} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
      <div className="space-y-1">
        <Label htmlFor={`cs-reason-${employeeId}`}>Why is the session being closed?</Label>
        <Textarea id={`cs-reason-${employeeId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} required />
        <p className="text-xs text-muted-foreground">Recorded with the change, and shown to the person. No client or patient information.</p>
      </div>
      <Button type="button" disabled={pending || !ready} onClick={save}>
        Close the session and use the ELEVATE clock
      </Button>
    </div>
  );
}
