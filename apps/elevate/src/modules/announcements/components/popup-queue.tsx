"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { acknowledge } from "../actions";
import { dismissPopup } from "../popup-actions";

export type PopupItem = {
  /** announcement id, or policy version id. */
  subjectId: string;
  kind: "announcement" | "policy";
  title: string;
  requiresAck: boolean;
  /** "Due Oct 20" style text, when acknowledgment has a due date. */
  dueText: string | null;
  version: number | null;
  /** Version stamp of the announcement text shown, sent back with the acknowledgment (null for a policy). */
  revision: string | null;
  link: string;
  /** The text, already rendered on the server. */
  content: ReactNode;
};

/**
 * The pop-ups HR queued, one at a time, before the person sees the page they signed in to. One that needs acknowledgment cannot be
 * closed: they acknowledge it to go on (the X, Escape and a click outside do nothing). One that does not can be closed and then does
 * not come back. When the line is empty, `onDone` lets the quick tour start.
 */
export function PopupQueue({ items: initial, onDone }: { items: PopupItem[]; onDone: () => void }) {
  // The line is fixed when the person signs in. Acknowledging refreshes the page data, and a list that shrank under the position
  // would skip the next pop-up and end the line early.
  const [items] = useState(initial);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const item = items[index] ?? null;
  const finished = useRef(false);

  useEffect(() => {
    if (item || finished.current) return;
    finished.current = true;
    onDone();
  }, [item, onDone]);

  if (!item) return null;
  const next = () => setIndex((i) => i + 1);

  const confirm = () =>
    startTransition(async () => {
      try {
        const result = await acknowledge({ kind: item.kind === "policy" ? "policy_version" : "announcement", id: item.subjectId, revision: item.revision ?? undefined });
        if (!result.ok) return void toast.error(result.error);
        next();
      } catch {
        toast.error("No connection. Try again.");
      }
    });

  const close = () =>
    startTransition(async () => {
      try {
        const result = await dismissPopup({ kind: item.kind === "policy" ? "policy_version" : "announcement", id: item.subjectId });
        if (!result.ok) toast.error(result.error);
      } catch {
        // Not saved: it may show again next time, but the person is not held up.
      }
      next();
    });

  return (
    <Dialog open onOpenChange={(open) => (!open && !item.requiresAck && !pending ? close() : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!item.requiresAck} data-popup-queue>
        <DialogHeader>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.kind === "policy" ? "Policy" : "Announcement"}
            {items.length > 1 ? ` · ${index + 1} of ${items.length}` : ""}
          </p>
          <DialogTitle className="text-xl">{item.title}</DialogTitle>
          <DialogDescription>
            {item.requiresAck ? `Please read this and acknowledge it${item.dueText ? ` (${item.dueText})` : ""}.` : "For your information. You can close this."}
            {item.version ? ` Version ${item.version}.` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50dvh] overflow-y-auto rounded-lg border bg-background p-4">{item.content}</div>
        <DialogFooter>
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="self-center text-sm text-primary underline-offset-4 hover:underline sm:mr-auto">
            Open the full page (new tab)
          </a>
          {item.requiresAck ? (
            <Button onClick={confirm} disabled={pending}>
              I acknowledge
            </Button>
          ) : (
            <Button onClick={close} disabled={pending}>
              {index + 1 < items.length ? "Close and continue" : "Close"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
