"use client";

import { useState } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * "Instructions for learners": the message HR can read, copy and send (by email or chat) to the people a course is assigned to.
 * The text is built on the server from the course's real rules; this only shows it and copies it.
 */
export function LearnerInstructions({ courseLabel, text }: { courseLabel: string; text: string }) {
  const [open, setOpen] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied. You can paste it into an email or a chat message.");
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Instructions for learners
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Instructions for learners: {courseLabel}</DialogTitle>
          <DialogDescription>A ready message to send to the people this course is assigned to. It holds no password: everyone signs in with their ELEVATE account.</DialogDescription>
          <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed">
            {text.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" onClick={() => void copy()}>
              Copy the message
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
