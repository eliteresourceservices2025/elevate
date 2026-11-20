"use client";

import { SendHorizontal } from "lucide-react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useRun } from "@/modules/recruiting/components/use-run";
import { releaseStatements } from "../actions";
import { STATEMENT_LABELS as S } from "../constants";

// The one decision: release every statement of an approved real run to the people on it. The server decides everything (the Approver level,
// a real run, approval, once); this button only asks first, with the count, and is off with the reason when it can't work.

export function ReleaseStatementsButton({ runId, count, refusal }: { runId: string; count: number; refusal: string | null }) {
  const { run, pending } = useRun();
  const confirm = useConfirm();
  return (
    <Button
      type="button"
      disabled={pending || refusal !== null}
      title={refusal ?? undefined}
      onClick={async () => {
        const ok = await confirm({ title: S.releaseTitle(count), description: S.releaseBody(count), confirmLabel: S.releaseConfirm, cancelLabel: "Go back" });
        if (ok) run(() => releaseStatements({ runId }), (d) => S.releaseDone(d?.people ?? count));
      }}
    >
      <SendHorizontal className="size-4" aria-hidden />
      {S.releaseAction}
    </Button>
  );
}
