"use client";

import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { convertLearnEssentialsToFull } from "../actions";

/** HR replaces one legacy Essentials assignment with the Full course; finished modules are kept. */
export function EssentialsConversionForm({ assignmentId }: { assignmentId: string }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const convert = () => start(async () => {
    const result = await convertLearnEssentialsToFull({ assignmentId, reason });
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Moved to the full course. ${result.data.creditedModules} finished module${result.data.creditedModules === 1 ? "" : "s"} kept.`);
    setReason("");
  });

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        convert();
      }}
    >
      <Input aria-label="Reason for moving to the full course" placeholder="Why this moves to Full" value={reason} onChange={(event) => setReason(event.target.value)} className="h-8 w-56 text-xs" required minLength={10} maxLength={500} />
      <Button size="sm" type="submit" variant="outline" disabled={pending || reason.trim().length < 10}>Move to Full</Button>
    </form>
  );
}
