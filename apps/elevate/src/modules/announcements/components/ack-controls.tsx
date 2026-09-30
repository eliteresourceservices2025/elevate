"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acknowledge, archiveAnnouncement, exportAcknowledgments, sendReminder } from "../actions";

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) return void toast.error(result.error ?? "Something went wrong.");
      toast.success(success);
      after?.();
      router.refresh();
    });
  return { run, pending };
}

type Subject = { kind: "announcement" | "policy_version"; id: string };

/** The one click that records "I have read and understand" for this item (and, for a policy, this version). */
export function AcknowledgeButton({ subject }: { subject: Subject }) {
  const { run, pending } = useRun();
  return (
    <Button type="button" disabled={pending} onClick={() => run(() => acknowledge(subject), "Thank you. Your acknowledgment is recorded.")}>
      I have read and understand
    </Button>
  );
}

/** HR's reminder and CSV buttons for one item. */
export function StatusActions({ subject, canRemind, canExport, pendingCount }: { subject: Subject; canRemind: boolean; canExport: boolean; pendingCount: number }) {
  const { run, pending } = useRun();
  const [exporting, startExport] = useTransition();

  function download() {
    startExport(async () => {
      const result = await exportAcknowledgments(subject);
      if (!result.ok) return void toast.error(result.error);
      const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.fileName;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canRemind ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending || pendingCount === 0}
          onClick={() => run(() => sendReminder(subject), "Reminder sent.")}
        >
          Send reminder{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </Button>
      ) : null}
      {canExport ? (
        <Button type="button" variant="outline" disabled={exporting} onClick={download}>
          Export CSV
        </Button>
      ) : null}
    </div>
  );
}

export function ArchiveAnnouncementButton({ announcementId, title }: { announcementId: string; title: string }) {
  const { run, pending } = useRun();
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        window.confirm(`Archive "${title}"? It disappears from the list for everyone. Acknowledgments already recorded are kept.`) &&
        run(() => archiveAnnouncement({ announcementId }), "Announcement archived.", () => router.push("/announcements"))
      }
    >
      Archive
    </Button>
  );
}
