"use client";

import { SquarePen } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addGroupMembers, createGroupConversation, openDirectMessage } from "../actions";
import { MAX_GROUP, MAX_TITLE, MIN_GROUP } from "../validators";
import { PeoplePicker, type ChatPerson } from "./people-picker";

/** "New message" button: a message to one person, or a group of 3 or more. */
export function NewConversationDialog({ onOpened }: { onOpened: (conversationId: string) => void }) {
  return (
    <FormDialog label="New message" title="New message" description="Message one person, or make a group of three or more." size="md" icon={<SquarePen aria-hidden />} triggerSize="sm">
      <NewConversationForm onOpened={onOpened} />
    </FormDialog>
  );
}

function NewConversationForm({ onOpened }: { onOpened: (conversationId: string) => void }) {
  const dialog = useFormDialog();
  const [mode, setMode] = useState<"dm" | "group">("dm");
  const [selected, setSelected] = useState<ChatPerson[]>([]);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(person: ChatPerson) {
    setSelected((current) => {
      const has = current.some((p) => p.userId === person.userId);
      if (has) return current.filter((p) => p.userId !== person.userId);
      if (mode === "dm") return [person];
      return current.length >= MAX_GROUP - 1 ? current : [...current, person];
    });
  }

  function switchMode(next: "dm" | "group") {
    setMode(next);
    setSelected((current) => (next === "dm" ? current.slice(0, 1) : current));
  }

  const ready = mode === "dm" ? selected.length === 1 : selected.length >= MIN_GROUP - 1 && title.trim().length > 0;

  function submit() {
    startTransition(async () => {
      const result =
        mode === "dm"
          ? await openDirectMessage({ userId: selected[0].userId })
          : await createGroupConversation({ title, memberUserIds: selected.map((p) => p.userId) });
      if (!result.ok) return void toast.error(result.error);
      await dialog?.close(true);
      onOpened(result.data.conversationId);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) submit();
      }}
    >
      <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Kind of message">
        {(["dm", "group"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => switchMode(k)} className={cn("rounded-md px-3 py-1 text-sm font-medium", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {k === "dm" ? "One person" : "Group"}
          </button>
        ))}
      </div>
      {mode === "group" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="chat-group-title" className="text-sm font-medium">
            Group name
          </label>
          <Input id="chat-group-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder="For example, Cutoff check crew" />
          <p className="text-xs text-muted-foreground">Pick at least {MIN_GROUP - 1} other people. You can add more later.</p>
        </div>
      ) : null}
      <PeoplePicker selected={selected} onToggle={toggle} />
      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || pending}>
          {mode === "dm" ? "Open chat" : "Create group"}
        </Button>
      </div>
    </form>
  );
}

/** "Add people" on a group's details: pick more people (they see the chat from the moment they are added). */
export function AddPeopleDialog({ conversationId, existing, onAdded }: { conversationId: string; existing: string[]; onAdded: () => void }) {
  return (
    <FormDialog label="Add people" title="Add people" description="They can read new messages from now on." size="md" variant="outline" triggerSize="sm">
      <AddPeopleForm conversationId={conversationId} existing={existing} onAdded={onAdded} />
    </FormDialog>
  );
}

function AddPeopleForm({ conversationId, existing, onAdded }: { conversationId: string; existing: string[]; onAdded: () => void }) {
  const dialog = useFormDialog();
  const [selected, setSelected] = useState<ChatPerson[]>([]);
  const [pending, startTransition] = useTransition();
  const toggle = (person: ChatPerson) => setSelected((c) => (c.some((p) => p.userId === person.userId) ? c.filter((p) => p.userId !== person.userId) : [...c, person]));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await addGroupMembers({ conversationId, userIds: selected.map((p) => p.userId) });
          if (!result.ok) return void toast.error(result.error);
          await dialog?.close(true);
          onAdded();
        });
      }}
    >
      <PeoplePicker selected={selected} onToggle={toggle} hide={existing} />
      <div className="flex justify-end">
        <Button type="submit" disabled={selected.length === 0 || selected.length > 20 || pending}>
          Add {selected.length > 0 ? selected.length : ""}
        </Button>
      </div>
    </form>
  );
}
