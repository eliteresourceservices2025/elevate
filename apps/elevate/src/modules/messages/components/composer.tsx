"use client";

import { AtSign, Mic, Paperclip, SendHorizontal, Square, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ChangeEvent, type KeyboardEvent } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/modules/documents/files";
import { sendChatMessage } from "../actions";
import { applyMention, findMentionQuery, suggestMentions, type MentionOption } from "../mention-suggest";
import { mentionToken } from "../mentions";
import { MAX_ATTACHMENTS, MAX_VOICE_SECONDS } from "../media";
import type { FinishedUpload } from "../uploads";
import { MAX_BODY } from "../validators";
import { EmojiPicker } from "./emoji-picker";
import { GifDialog } from "./gif-dialog";
import { PollDialog } from "./poll-dialog";
import { uploadAttachment } from "./upload-attachment";

const COUNTER_FROM = 3500;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp";
const VOICE_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

/**
 * The message box. `members` fills the @mention list; `threadRootId` makes it a thread reply; `restricted` shows why a person cannot post
 * (a channel only HR posts in). Files, pictures and voice notes are uploaded first and travel with the message.
 */
export function Composer({
  conversationId,
  label,
  onSent,
  members = [],
  threadRootId,
  restricted = false,
  idSuffix = "",
  quote = null,
  onClearQuote,
}: {
  conversationId: string;
  label: string;
  onSent: () => void;
  members?: { userId: string; name: string }[];
  threadRootId?: string;
  restricted?: boolean;
  idSuffix?: string;
  /** The message being quoted in this reply, shown above the box. */
  quote?: { id: string; senderName: string; snippet: string } | null;
  onClearQuote?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [mentioning, setMentioning] = useState(false);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const [attachments, setAttachments] = useState<FinishedUpload[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const tooLong = draft.length > MAX_BODY;
  // Typing "@" opens the list of people you can mention, right away; it narrows as you type.
  const mentionQuery = findMentionQuery(draft, caret);
  const options: MentionOption[] = mentionQuery && members.length > 0 && dismissedAt !== mentionQuery.start ? suggestMentions(members, mentionQuery.query) : [];
  const suggesting = options.length > 0;
  const active = Math.min(highlight, Math.max(0, options.length - 1));
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !tooLong && !pending && !uploading && recordingSeconds === null;

  function send() {
    if (!canSend) return;
    const body = draft;
    const attachmentIds = attachments.map((a) => a.id);
    startTransition(async () => {
      const result = await sendChatMessage({ conversationId, body, threadRootId, quotedMessageId: quote?.id, attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined });
      if (!result.ok) return void toast.error(result.error);
      setDraft("");
      setAttachments([]);
      onClearQuote?.();
      onSent();
      field.current?.focus();
    });
  }

  useEffect(() => {
    if (pendingCaret.current === null) return;
    field.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function choose(option: MentionOption) {
    if (!mentionQuery) return;
    const insert = option.kind === "everyone" ? "@everyone" : mentionToken(option.name, option.userId);
    const next = applyMention(draft, mentionQuery, insert);
    setDraft(next.text);
    setCaret(next.caret);
    setHighlight(0);
    pendingCaret.current = next.caret;
    field.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggesting && !event.nativeEvent.isComposing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((active + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(options[active]);
        return;
      }
      if (event.key === "Escape" && mentionQuery) {
        event.preventDefault();
        setDismissedAt(mentionQuery.start);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function insert(text: string) {
    setDraft((d) => (d && !d.endsWith(" ") && !d.endsWith("\n") ? `${d} ${text}` : `${d}${text}`));
    field.current?.focus();
  }

  async function addUpload(file: Blob & { name?: string }, kind: "image" | "file" | "voice", durationS?: number) {
    setUploading(true);
    try {
      const done = await uploadAttachment(conversationId, file, kind, durationS);
      setAttachments((list) => [...list, done]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload did not go through. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    for (const file of files) {
      if (attachments.length + 1 > MAX_ATTACHMENTS) return void toast.error(`A message can have up to ${MAX_ATTACHMENTS} attachments.`);
      await addUpload(file, file.type.startsWith("image/") ? "image" : "file");
    }
  }

  async function startVoice() {
    if (attachments.length >= MAX_ATTACHMENTS) return void toast.error(`A message can have up to ${MAX_ATTACHMENTS} attachments.`);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return void toast.error("This browser can't record voice notes.");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return void toast.error("Allow the microphone to record a voice note.");
    }
    const type = VOICE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (tick.current) clearInterval(tick.current);
      setRecordingSeconds(null);
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      if (blob.size > 0) void addUpload(blob, "voice", Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAt) / 1000)));
    };
    recorder.current = rec;
    rec.start();
    setRecordingSeconds(0);
    tick.current = setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      setRecordingSeconds(seconds);
      if (seconds >= MAX_VOICE_SECONDS) rec.stop();
    }, 500);
  }

  function stopVoice() {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }

  if (restricted) {
    return <div className="border-t p-3 text-center text-sm text-muted-foreground">Only HR can post in this channel. You can react and reply in a thread.</div>;
  }

  return (
    <div className="border-t p-3">
      {quote ? (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-primary/60 bg-muted px-2.5 py-1.5 text-xs" role="group" aria-label="Quoting">
          <div className="min-w-0 flex-1">
            <span className="block font-semibold">Replying to {quote.senderName}</span>
            <span className="line-clamp-2 break-words text-muted-foreground">{quote.snippet}</span>
          </div>
          <button type="button" onClick={onClearQuote} aria-label="Cancel quote" className="rounded-full p-0.5 hover:bg-background">
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
      {attachments.length > 0 || uploading ? (
        <div className="mb-2 flex flex-col gap-1">
          <ul className="flex flex-wrap gap-1.5" aria-label="Attachments">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {a.kind === "voice" ? `Voice note (${a.durationS ?? 0}s)` : a.name} · {formatBytes(a.size)}
                <button type="button" onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))} aria-label={`Remove ${a.name}`} className="rounded-full hover:bg-muted">
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
            {uploading ? <li className="text-xs text-muted-foreground" role="status">Uploading…</li> : null}
          </ul>
          <p className="text-xs text-muted-foreground">Don&apos;t upload client records or anything with patient details.</p>
        </div>
      ) : null}
      {recordingSeconds !== null ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-destructive px-3 py-2 text-sm" role="status">
          <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
          Recording a voice note · {recordingSeconds}s of {MAX_VOICE_SECONDS}s
          <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={stopVoice}>
            <Square aria-hidden /> Stop and attach
          </Button>
        </div>
      ) : null}
      <div className="relative flex items-end gap-2">
        {suggesting ? (
          <ul role="listbox" aria-label="People you can mention" className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-64 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
            {options.map((option, i) => (
              <li key={option.kind === "everyone" ? "everyone" : option.userId} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                  className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted ${i === active ? "bg-muted" : ""} ${option.kind === "everyone" ? "font-semibold" : ""}`}
                >
                  {option.kind === "everyone" ? "@everyone (notify all)" : option.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label htmlFor={`chat-composer${idSuffix}`} className="sr-only">
          {threadRootId ? "Reply in thread" : `Message ${label}`}
        </label>
        <Textarea
          id={`chat-composer${idSuffix}`}
          ref={field}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart);
            setHighlight(0);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          rows={2}
          placeholder={threadRootId ? "Reply in thread" : `Message ${label}`}
          aria-invalid={tooLong}
          className="max-h-40 min-h-12 resize-none"
        />
        <Button type="button" onClick={send} disabled={!canSend} aria-label={threadRootId ? "Send reply" : "Send message"}>
          <SendHorizontal aria-hidden />
          Send
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <EmojiPicker onPick={insert} label="Add an emoji to your message" />
        <input ref={fileInput} type="file" multiple accept={ACCEPT} onChange={(e) => void onFiles(e)} className="sr-only" tabIndex={-1} aria-hidden data-testid="chat-file-input" />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach a file or picture" onClick={() => fileInput.current?.click()} disabled={uploading || recordingSeconds !== null}>
          <Paperclip aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Record a voice note" onClick={() => void startVoice()} disabled={uploading || recordingSeconds !== null}>
          <Mic aria-hidden />
        </Button>
        <GifDialog conversationId={conversationId} threadRootId={threadRootId} onSent={onSent} />
        {!threadRootId ? <PollDialog conversationId={conversationId} onCreated={onSent} /> : null}
        {members.length > 0 ? (
          <span className="relative inline-flex">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Mention someone" aria-expanded={mentioning} onClick={() => setMentioning((v) => !v)}>
              <AtSign aria-hidden />
            </Button>
            {mentioning ? (
              <ul role="listbox" aria-label="Mention someone" className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-56 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
                {members.length > 1 ? (
                  <li>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        insert("@everyone ");
                        setMentioning(false);
                      }}
                    >
                      @everyone (notify all)
                    </button>
                  </li>
                ) : null}
                {members.map((m) => (
                  <li key={m.userId}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                      onClick={() => {
                        insert(`${mentionToken(m.name, m.userId)} `);
                        setMentioning(false);
                      }}
                    >
                      {m.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        ) : null}
        <span className="min-w-0 flex-1">Enter to send, Shift+Enter for a new line. Don&apos;t share client or patient details here.</span>
        {draft.length >= COUNTER_FROM ? (
          <span className={tooLong ? "font-semibold text-destructive" : undefined} aria-live="polite">
            {draft.length} / {MAX_BODY}
          </span>
        ) : null}
      </div>
    </div>
  );
}
