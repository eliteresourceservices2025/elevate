"use client";

import { ImagePlay } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Input } from "@/components/ui/input";
import { searchChatGifs, sendChatGif } from "../actions";
import type { GifResult } from "../gif-rules";

/** A button in the message box that opens the GIF picker. Searches and previews both go through our server (KLIPY never sees who is looking). */
export function GifDialog({ conversationId, threadRootId, onSent }: { conversationId: string; threadRootId?: string; onSent: () => void }) {
  return (
    <FormDialog label="GIF" title="Send a GIF" description="Search for a GIF. GIFs are not for patient or client information." size="md" variant="outline" triggerSize="sm" icon={<ImagePlay aria-hidden />}>
      <GifPicker conversationId={conversationId} threadRootId={threadRootId} onSent={onSent} />
    </FormDialog>
  );
}

function GifPicker({ conversationId, threadRootId, onSent }: { conversationId: string; threadRootId?: string; onSent: () => void }) {
  const dialog = useFormDialog();
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<GifResult[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!q.trim()) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchChatGifs({ q }).catch(() => null);
      if (cancelled) return;
      if (!result || !result.ok) {
        setError(result?.error ?? "Could not reach ELEVATE. Check your connection and try again.");
        return;
      }
      setError(null);
      setEnabled(result.data.enabled);
      setGifs(result.data.gifs);
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  function send(gif: GifResult) {
    startTransition(async () => {
      const result = await sendChatGif({ conversationId, url: gif.url, ...(threadRootId ? { threadRootId } : {}) });
      if (!result.ok) return void toast.error(result.error);
      await dialog?.close(true);
      onSent();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="gif-search" className="sr-only">
        Search GIFs
      </label>
      <Input id="gif-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search GIFs" autoComplete="off" maxLength={60} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {!enabled ? <p className="text-sm text-muted-foreground">GIFs are not set up yet. Ask an administrator to add the GIF service key.</p> : null}
      {enabled && gifs && gifs.length === 0 ? <p className="text-sm text-muted-foreground">No GIFs found.</p> : null}
      <ul className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto">
        {(gifs ?? []).map((g) => (
          <li key={g.id}>
            <button type="button" disabled={pending} onClick={() => send(g)} className="block w-full overflow-clip rounded-md border outline-none hover:ring-2 hover:ring-primary focus-visible:ring-3 focus-visible:ring-ring/50" aria-label={`Send GIF: ${g.title}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- previews come through our own route, not the image optimizer */}
              <img src={`/api/messages/gif-preview?u=${encodeURIComponent(g.previewUrl)}`} alt="" loading="lazy" className="aspect-square w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
