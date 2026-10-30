"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { repairOrphanedLearnHistory } from "../actions";

/** An accountable, reviewed transfer of history that otherwise sits outside Training Status. */
export function OrphanedCertificateRepair({ sourceUserId, targets }: { sourceUserId: string; targets: { employeeId: string; name: string }[] }) {
  const [targetEmployeeId, setTargetEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const repair = () => start(async () => {
    const result = await repairOrphanedLearnHistory({ sourceUserId, targetEmployeeId, reason });
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Recovered ${result.data.certificatesMoved} certificate${result.data.certificatesMoved === 1 ? "" : "s"} and ${result.data.assignmentsMoved} training record${result.data.assignmentsMoved === 1 ? "" : "s"}.`);
    setReason("");
  });

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        repair();
      }}
    >
      <NativeSelect aria-label="Current employee" value={targetEmployeeId} onChange={(event) => setTargetEmployeeId(event.target.value)} className="h-8 max-w-56 text-xs" required>
        <option value="">Match to current employee…</option>
        {targets.map((target) => <option key={target.employeeId} value={target.employeeId}>{target.name}</option>)}
      </NativeSelect>
      <Input aria-label="Verification reason" placeholder="How this match was verified" value={reason} onChange={(event) => setReason(event.target.value)} className="h-8 w-56 text-xs" required minLength={10} maxLength={500} />
      <Button size="sm" type="submit" variant="outline" disabled={pending || !targetEmployeeId || reason.trim().length < 10}>Transfer history</Button>
    </form>
  );
}
