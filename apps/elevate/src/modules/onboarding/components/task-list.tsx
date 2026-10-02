"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRun } from "@/modules/recruiting/components/use-run";
import { formatDateOnly } from "@/lib/time";
import { completeTask, reopenTask, sendTaskAgreement, skipTask } from "../actions";
import { OWNER_LABELS } from "../constants";
import type { TaskView } from "../queries";

/** The checklist of one case. Ticking, skipping and sending an agreement are all checked again on the server. */
export function TaskList({ tasks, canManage, open }: { tasks: TaskView[]; canManage: boolean; open: boolean }) {
  const { run, pending } = useRun();
  const [skipping, setSkipping] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {tasks.map((t) => (
        <li key={t.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={t.status === "todo" ? "font-medium" : "font-medium text-muted-foreground line-through"}>{t.title}</p>
              {t.details ? <p className="text-sm text-muted-foreground">{t.details}</p> : null}
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{OWNER_LABELS[t.owner]}</span>
                <span>Due {formatDateOnly(t.dueOn)}</span>
                {t.required ? null : <Badge variant="outline">Optional</Badge>}
                {t.overdue ? <Badge variant="destructive">Late</Badge> : null}
                {t.status === "done" ? <Badge variant="secondary">{t.auto ? "Done automatically" : "Done"}</Badge> : null}
                {t.status === "skipped" ? <Badge variant="outline">Skipped</Badge> : null}
                {t.check !== "manual" && t.status === "todo" ? <span>ELEVATE ticks this when it is done.</span> : null}
              </p>
              {t.note ? <p className="mt-1 text-xs text-muted-foreground">Note: {t.note}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {t.href && t.status === "todo" ? (
                <Link href={t.href} className="text-sm text-primary underline-offset-2 hover:underline">
                  Open
                </Link>
              ) : null}
              {t.canAct ? (
                <Button size="sm" disabled={pending} onClick={() => run(() => completeTask({ taskId: t.id }), "Task done.")}>
                  Mark done
                </Button>
              ) : null}
              {t.canSendAgreement ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => sendTaskAgreement({ taskId: t.id }), "Agreement sent for signature.")}>
                  Send agreement
                </Button>
              ) : null}
              {canManage && open && t.status === "todo" ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => (setSkipping(skipping === t.id ? null : t.id), setReason(""))}>
                  Skip
                </Button>
              ) : null}
              {canManage && open && t.status === "done" && !t.auto ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reopenTask({ taskId: t.id }), "Task reopened.")}>
                  Reopen
                </Button>
              ) : null}
            </div>
          </div>
          {skipping === t.id ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => skipTask({ taskId: t.id, reason }), "Task skipped.", () => setSkipping(null));
              }}
            >
              <div className="space-y-1">
                <Label htmlFor={`skip-${t.id}`}>Why is it skipped?</Label>
                <Input id={`skip-${t.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="w-72" />
              </div>
              <Button size="sm" type="submit" disabled={pending || reason.trim().length < 3}>
                Skip task
              </Button>
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
