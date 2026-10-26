"use client";

import { Eye } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * A "View" button that opens the document inside the page, so nobody has to download it just to read it. The picture, PDF or plain Word
 * preview comes from our own signed-in route, which runs the same checks as the download and records the view.
 */
export function PreviewButton({ documentId, title }: { documentId: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="sm" aria-label={`View ${title}`} onClick={() => setOpen(true)}>
        <Eye aria-hidden /> View
      </Button>
      {open ? (
        <Dialog open onOpenChange={(next) => !next && setOpen(false)}>
          <DialogContent className="max-h-[92dvh] gap-3 sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="truncate">{title}</DialogTitle>
              <DialogDescription>If it does not show, close this and use Download instead.</DialogDescription>
            </DialogHeader>
            <iframe title={title} src={`/api/documents/${documentId}/preview`} className="h-[72dvh] w-full rounded-lg border bg-white" />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
