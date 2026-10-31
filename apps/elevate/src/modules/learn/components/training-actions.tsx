"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { assignLearnTraining, changeLearnDueDate, grantLearnRetry } from "../actions";

/** What HR can do for one person: put them on the training, or give more tries or more exam time (with a reason). */
export function TrainingRowActions({ userId, employeeId, queued = false, assignmentId, dueOn, minDueOn, canAssign, canGrant, course = "hipaa", fixedTrack = false }: { userId: string | null; employeeId: string; queued?: boolean; assignmentId: string | null; dueOn: string | null; minDueOn: string; canAssign: boolean; canGrant: boolean; course?: string; fixedTrack?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"grant" | "due" | null>(null);
  const [track, setTrack] = useState<"full" | "essentials" | "refresher">("full");
  const [kind, setKind] = useState<"tries" | "time">("tries");
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [newDueOn, setNewDueOn] = useState(dueOn ?? "");

  const assign = () =>
    start(async () => {
      // Someone who has not signed in yet has no account: the request is queued and becomes an assignment after their first sign-in.
      const r = await assignLearnTraining({ ...(userId ? { userId } : { employeeId }), track, course });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.queued ? "Queued. It is assigned after they first sign in." : r.data.created ? "Training assigned." : "Already assigned.");
      router.refresh();
    });

  const grant = () =>
    start(async () => {
      const r = await grantLearnRetry(kind === "tries" ? { kind, assignmentId, amount, reason } : { kind, assignmentId, amount, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(kind === "tries" ? "More tries given." : "Extra time given.");
      setMode(null);
      setReason("");
      router.refresh();
    });

  const changeDue = () =>
    start(async () => {
      if (!assignmentId) return;
      const r = await changeLearnDueDate({ assignmentId, dueOn: newDueOn, reason });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.changed ? "Due date changed." : "The due date is already set to that day.");
      setMode(null);
      setReason("");
      router.refresh();
    });

  if (!assignmentId) {
    if (!canAssign) return null;
    if (queued) return <span className="text-xs text-muted-foreground">Queued until they sign in</span>;
    return (
      <div className="flex items-center gap-1">
        {fixedTrack ? null : (
        <NativeSelect aria-label="Track" value={track} onChange={(e) => setTrack(e.target.value as typeof track)} className="h-8 w-32 text-xs">
          <option value="full">Full</option>
          <option value="essentials">Essentials</option>
          <option value="refresher">Refresher</option>
        </NativeSelect>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={assign} title={userId ? undefined : "They have not signed in yet: this is queued and assigned after their first sign-in"}>
          {userId ? "Assign" : "Queue"}
        </Button>
      </div>
    );
  }

  if (!canGrant) return null;
  if (!mode)
    return (
      <span className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">Already assigned</span>
        <Button size="sm" variant="ghost" onClick={() => setMode("due")}>
          Change due date
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode("grant")}>
          More tries
        </Button>
      </span>
    );

  if (mode === "due")
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          changeDue();
        }}
      >
        <Input aria-label="New due date" type="date" value={newDueOn} min={minDueOn} onChange={(e) => setNewDueOn(e.target.value)} className="h-8 w-36 text-xs" required />
        <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-44 text-xs" required minLength={3} maxLength={500} />
        <Button size="sm" type="submit" disabled={pending || !newDueOn || reason.trim().length < 3}>
          Save
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
      </form>
    );

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        grant();
      }}
    >
      <NativeSelect aria-label="What to give" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setAmount(e.target.value === "tries" ? 1 : 15); }} className="h-8 w-32 text-xs">
        <option value="tries">Tries</option>
      </NativeSelect>
      <Input aria-label="Amount" type="number" min={kind === "tries" ? 1 : 5} max={kind === "tries" ? 5 : 60} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="h-8 w-20 text-xs" />
      <Input aria-label="Reason" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-44 text-xs" required minLength={3} maxLength={500} />
      <Button size="sm" type="submit" disabled={pending || reason.trim().length < 3}>
        Give
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setMode(null)}>
        Cancel
      </Button>
    </form>
  );
}
