"use client";

import { BellOff, Settings, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { getMyChatSettings, muteChatConversation, saveMyChatSettings } from "../actions";
import { CHAT_SOUNDS, CHAT_SOUND_LABELS, DEFAULT_CHAT_SOUND, type ChatSound } from "../sound-options";
import { playChatSound, unlockAudio } from "./play-sound";

type MuteChoice = "1h" | "8h" | "forever" | "off";
const CHOICES: { value: MuteChoice; label: string }[] = [
  { value: "1h", label: "For 1 hour" },
  { value: "8h", label: "For 8 hours" },
  { value: "forever", label: "Until I turn it back on" },
  { value: "off", label: "Don't mute (turn notifications back on)" },
];

/** Mute one chat: it stops adding to your unread count and email. */
export function MuteDialog({ conversationId, muted, onDone }: { conversationId: string; muted: boolean; onDone: () => void }) {
  return (
    <FormDialog label={muted ? "Muted" : "Mute"} title="Mute this chat" description="A muted chat stops adding to your unread count and your daily email. You still see its messages." size="md" variant="outline" triggerSize="sm" icon={<BellOff aria-hidden />}>
      <MuteForm conversationId={conversationId} muted={muted} onDone={onDone} />
    </FormDialog>
  );
}

function MuteForm({ conversationId, muted, onDone }: { conversationId: string; muted: boolean; onDone: () => void }) {
  const dialog = useFormDialog();
  const [choice, setChoice] = useState<MuteChoice>(muted ? "off" : "8h");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await muteChatConversation({ conversationId, until: choice });
          if (!result.ok) return void toast.error(result.error);
          await dialog?.close(true);
          onDone();
        });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Mute notifications</legend>
        {CHOICES.map((c) => (
          <label key={c.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="mute" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="size-4" /> {c.label}
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** The person's own chat settings: the online dot and the daily email. */
export function ChatSettingsDialog() {
  return (
    <FormDialog label="Settings" title="Chat settings" description="These are only about you." size="md" variant="outline" triggerSize="sm" icon={<Settings aria-hidden />}>
      <SettingsForm />
    </FormDialog>
  );
}

function SettingsForm() {
  const dialog = useFormDialog();
  const router = useRouter();
  const [sound, setSound] = useState<ChatSound>(DEFAULT_CHAT_SOUND);
  const [appearOffline, setAppearOffline] = useState(false);
  const [emailDigest, setEmailDigest] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await getMyChatSettings().catch(() => null);
      if (cancelled || !result?.ok) return;
      setAppearOffline(result.data.appearOffline);
      setEmailDigest(result.data.emailDigest);
      setSound(result.data.sound);
      setLoaded(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await saveMyChatSettings({ appearOffline, emailDigest, sound });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Saved.");
          router.refresh(); // the sound is read when the page loads
          await dialog?.close(true);
        });
      }}
    >
      <div className="flex flex-col gap-1.5 text-sm">
        <label htmlFor="chat-sound" className="font-medium">
          Sound for new messages
        </label>
        <div className="flex items-center gap-2">
          <select
            id="chat-sound"
            value={sound}
            disabled={!loaded}
            onChange={(e) => {
              const next = e.target.value as ChatSound;
              setSound(next);
              unlockAudio();
              playChatSound(next, true);
            }}
            className="h-(--control-h) rounded-lg border border-input bg-background px-3 text-sm"
          >
            {CHAT_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {CHAT_SOUND_LABELS[s]}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={!loaded || sound === "off"} onClick={() => playChatSound(sound, true)}>
            <Volume2 aria-hidden /> Play
          </Button>
        </div>
        <span className="text-muted-foreground">Plays when a message arrives in a chat you have not muted, and you are not already looking at Messages. Mute a chat to silence just that chat.</span>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={appearOffline} onChange={(e) => setAppearOffline(e.target.checked)} disabled={!loaded} className="mt-0.5 size-4" />
        <span>
          <span className="block font-medium">Appear offline</span>
          <span className="block text-muted-foreground">People in your chats won&apos;t see a green &quot;online&quot; dot for you.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={emailDigest} onChange={(e) => setEmailDigest(e.target.checked)} disabled={!loaded} className="mt-0.5 size-4" />
        <span>
          <span className="block font-medium">Daily email about unread messages</span>
          <span className="block text-muted-foreground">One email a day with a count and a link, never the messages themselves.</span>
        </span>
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={!loaded || pending}>
          Save
        </Button>
      </div>
    </form>
  );
}
