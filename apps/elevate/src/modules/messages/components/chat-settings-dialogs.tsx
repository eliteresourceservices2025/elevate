"use client";

import { BellOff, Settings } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { getMyChatSettings, muteChatConversation, saveMyChatSettings } from "../actions";

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
          const result = await saveMyChatSettings({ appearOffline, emailDigest });
          if (!result.ok) return void toast.error(result.error);
          toast.success("Saved.");
          await dialog?.close(true);
        });
      }}
    >
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
