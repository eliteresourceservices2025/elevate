"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type FeedbackKind = "success" | "error" | "warning" | "message";
type FeedbackOptions = { description?: ReactNode };
type Feedback = { id: number; kind: FeedbackKind; title: ReactNode; description?: ReactNode };

const listeners = new Set<(feedback: Feedback) => void>();
let nextId = 0;

function show(kind: FeedbackKind, title: ReactNode, options?: FeedbackOptions) {
  const feedback = { id: ++nextId, kind, title, description: options?.description };
  listeners.forEach((listener) => listener(feedback));
  return feedback.id;
}

/**
 * A single, centered result message for the app. It intentionally replaces transient corner toasts so a saved action or a problem
 * is easy to notice. Success and informational messages close after a short pause; warnings and errors wait for acknowledgment.
 */
export const toast = {
  success: (title: ReactNode, options?: FeedbackOptions) => show("success", title, options),
  error: (title: ReactNode, options?: FeedbackOptions) => show("error", title, options),
  warning: (title: ReactNode, options?: FeedbackOptions) => show("warning", title, options),
  message: (title: ReactNode, options?: FeedbackOptions) => show("message", title, options),
};

const PRESENTATION: Record<FeedbackKind, { title: string; icon: ReactNode; className: string }> = {
  success: { title: "Done", icon: <CircleCheckIcon className="size-5" />, className: "text-success" },
  error: { title: "Something needs attention", icon: <OctagonXIcon className="size-5" />, className: "text-destructive" },
  warning: { title: "Please review", icon: <TriangleAlertIcon className="size-5" />, className: "text-warning" },
  message: { title: "ELEVATE", icon: <InfoIcon className="size-5" />, className: "text-primary" },
};

export function FeedbackProvider() {
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const receive = (next: Feedback) => setFeedback(next);
    listeners.add(receive);
    return () => {
      listeners.delete(receive);
    };
  }, []);

  useEffect(() => {
    if (!feedback || (feedback.kind !== "success" && feedback.kind !== "message")) return;
    const timeout = window.setTimeout(() => setFeedback((current) => (current?.id === feedback.id ? null : current)), 4500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const presentation = feedback ? PRESENTATION[feedback.kind] : null;

  return (
    <Dialog open={feedback !== null} onOpenChange={(open) => !open && setFeedback(null)}>
      <DialogContent className="gap-5" showCloseButton={feedback?.kind !== "error" && feedback?.kind !== "warning"}>
        <DialogHeader className="gap-3 pr-8">
          <div className={`flex size-10 items-center justify-center rounded-full bg-muted ${presentation?.className ?? ""}`}>{presentation?.icon}</div>
          <DialogTitle>{presentation?.title}</DialogTitle>
          <DialogDescription className="text-pretty text-foreground">{feedback?.title}</DialogDescription>
          {feedback?.description ? <DialogDescription>{feedback.description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => setFeedback(null)}>
            {feedback?.kind === "success" || feedback?.kind === "message" ? "Close" : "I understand"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
