"use client";

import { MessageSquare, Send } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MESSAGE_MAX, type ReportType } from "@/modules/reports/constants";
import { loadReportThread, postReportMessage } from "@/modules/reports/actions";
import type { ReportThread as Thread } from "@/modules/reports/queries";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The conversation on one report: the person it is about and whoever handles it. It is kept with the report (encrypted, never edited or deleted)
 * and the other person gets a notice with no text. Please do not put client or patient information in a message.
 */
export function ReportThread({ type, id, heading = "Messages" }: { type: ReportType; id: string; heading?: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadReportThread({ type, id }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setThread(result.data);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [type, id, version]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await postReportMessage({ type, id, body });
      if (!result.ok) return void toast.error(result.error);
      setBody("");
      setVersion((v) => v + 1);
    });
  }

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>;
  if (!thread) return <p className="text-sm text-muted-foreground" role="status">Loading messages…</p>;
  return (
    <section aria-label={heading} className="space-y-2">
      <h3 className="text-sm font-semibold">{heading}</h3>
      {thread.messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet. {thread.standing === "handler" ? `Ask ${thread.reporterName} for anything you need.` : "Write here if you want to add something."}</p>
      ) : (
        <ul className="space-y-2" aria-live="polite">
          {thread.messages.map((m) => (
            <li key={m.id} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm", m.mine ? "ml-auto bg-primary text-primary-foreground" : "bg-muted")}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={cn("mt-1 text-xs", m.mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {m.mine ? "You" : m.authorKind === "handler" ? "Handler" : thread.reporterName} · {when(m.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={send} className="space-y-1.5">
        <Label htmlFor={`rt-${id}`} className="sr-only">
          Write a message
        </Label>
        <Textarea id={`rt-${id}`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={MESSAGE_MAX} rows={2} placeholder="Write a message…" />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Please do not include passwords, client names or patient information. {body.length}/{MESSAGE_MAX}</p>
          <Button type="submit" size="sm" disabled={pending || body.trim().length === 0}>
            <Send aria-hidden /> Send
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The conversation behind a "Messages" button on a card in a list (loaded only when it is opened). */
export function ThreadToggle({ type, id }: { type: ReportType; id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MessageSquare aria-hidden /> {open ? "Hide messages" : "Messages"}
      </Button>
      {open ? <ReportThread type={type} id={id} /> : null}
    </div>
  );
}
