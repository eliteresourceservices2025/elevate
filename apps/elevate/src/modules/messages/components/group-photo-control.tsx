"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { setChatConversationPhoto } from "../actions";
import { uploadGroupPhoto } from "./upload-attachment";

/** "Add picture" / "Change picture" / "Remove picture" for a group, channel or client group (HR Admin and Super Admin). */
export function GroupPhotoControl({ conversationId, hasPhoto, onChanged, disabled = false }: { conversationId: string; hasPhoto: boolean; onChanged: () => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const attachmentId = await uploadGroupPhoto(conversationId, file);
      const result = await setChatConversationPhoto({ conversationId, attachmentId });
      if (!result.ok) return void toast.error(result.error);
      toast.success("Picture saved.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const result = await setChatConversationPhoto({ conversationId, attachmentId: null });
      if (!result.ok) return void toast.error(result.error);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void onFile(e)} className="sr-only" tabIndex={-1} aria-hidden data-testid="group-photo-input" />
      <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => input.current?.click()}>
        <ImagePlus aria-hidden /> {hasPhoto ? "Change picture" : "Add picture"}
      </Button>
      {hasPhoto ? (
        <Button type="button" variant="ghost" size="sm" disabled={busy || disabled} onClick={() => void remove()}>
          <Trash2 aria-hidden /> Remove picture
        </Button>
      ) : null}
    </span>
  );
}
