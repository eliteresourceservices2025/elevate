"use client";

import { Hash, SquarePen, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { addGroupMembers, createChannelConversation, createGroupConversation, openDirectMessage } from "../actions";
import { MAX_ADD_AT_ONCE, MAX_GROUP, MAX_TITLE, MIN_GROUP } from "../validators";
import { PeoplePicker, type ChatPerson } from "./people-picker";

/** "New message" button: a message to one person; HR Admins and Super Admins can also make a group (3 to 200 people). */
export function NewConversationDialog({ onOpened, canCreateGroup }: { onOpened: (conversationId: string) => void; canCreateGroup: boolean }) {
  return (
    <FormDialog
      label="New message"
      title="New message"
      description={canCreateGroup ? "Message one person, or make a group of up to 200 people." : "Message one person."}
      size="md"
      icon={<SquarePen aria-hidden />}
      triggerSize="sm"
    >
      <NewConversationForm onOpened={onOpened} canCreateGroup={canCreateGroup} />
    </FormDialog>
  );
}

/** "New group" button on the manage page (HR Admin and Super Admin). */
export function NewGroupDialog({ onOpened }: { onOpened: (conversationId: string) => void }) {
  return (
    <FormDialog label="New group" title="New group" description="Pick 2 to 199 people. You are in the group too; if you take yourself out, another HR Admin or Super Admin has to add you back." size="md" icon={<Users aria-hidden />}>
      <NewConversationForm onOpened={onOpened} canCreateGroup groupOnly />
    </FormDialog>
  );
}

/** "New channel" button on the manage page (HR Admin and Super Admin): a named channel with chosen people, optionally only HR posts. */
export function NewChannelDialog({ onOpened }: { onOpened: (conversationId: string) => void }) {
  return (
    <FormDialog label="New channel" title="New channel" description="A named channel for announcements or a topic. You choose who is in it. Up to 200 people." size="md" variant="outline" icon={<Hash aria-hidden />}>
      <NewConversationForm onOpened={onOpened} canCreateGroup groupOnly channel />
    </FormDialog>
  );
}

function NewConversationForm({ onOpened, canCreateGroup, groupOnly = false, channel = false }: { onOpened: (conversationId: string) => void; canCreateGroup: boolean; groupOnly?: boolean; channel?: boolean }) {
  const dialog = useFormDialog();
  const [mode, setMode] = useState<"dm" | "group">(groupOnly ? "group" : "dm");
  const [selected, setSelected] = useState<ChatPerson[]>([]);
  const [title, setTitle] = useState("");
  const [onlyHrPosts, setOnlyHrPosts] = useState(false);
  const [pending, startTransition] = useTransition();
  const limit = MAX_GROUP - 1; // the creator makes it 200 in total

  function toggle(person: ChatPerson) {
    setSelected((current) => {
      const has = current.some((p) => p.userId === person.userId);
      if (has) return current.filter((p) => p.userId !== person.userId);
      if (mode === "dm") return [person];
      return current.length >= limit ? current : [...current, person];
    });
  }

  function addAll(people: ChatPerson[]) {
    setSelected((current) => {
      const have = new Set(current.map((p) => p.userId));
      return [...current, ...people.filter((p) => !have.has(p.userId))].slice(0, limit);
    });
  }

  function switchMode(next: "dm" | "group") {
    setMode(next);
    setSelected((current) => (next === "dm" ? current.slice(0, 1) : current));
  }

  const ready = mode === "dm" ? selected.length === 1 : selected.length >= (channel ? 1 : MIN_GROUP - 1) && title.trim().length > 0;

  function submit() {
    startTransition(async () => {
      const result =
        mode === "dm"
          ? await openDirectMessage({ userId: selected[0].userId })
          : channel
            ? await createChannelConversation({ title, memberUserIds: selected.map((p) => p.userId), postingAdminsOnly: onlyHrPosts })
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
      {canCreateGroup && !groupOnly ? (
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Kind of message">
          {(["dm", "group"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => switchMode(k)} className={cn("rounded-md px-3 py-1 text-sm font-medium", mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {k === "dm" ? "One person" : "Group"}
            </button>
          ))}
        </div>
      ) : null}
      {mode === "group" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="chat-group-title" className="text-sm font-medium">
            {channel ? "Channel name" : "Group name"}
          </label>
          <Input id="chat-group-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} placeholder={channel ? "For example, Announcements" : "For example, Cutoff check crew"} />
          {channel ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={onlyHrPosts} onChange={(e) => setOnlyHrPosts(e.target.checked)} /> Only HR can post (everyone can still reply and react)
            </label>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Pick at least {channel ? 1 : MIN_GROUP - 1} other {channel ? "person" : "people"}, up to {limit}. {selected.length >= limit ? "That is the most a group can hold." : ""}
          </p>
        </div>
      ) : null}
      <PeoplePicker selected={selected} onToggle={toggle} onAddAll={mode === "group" ? addAll : undefined} />
      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || pending}>
          {mode === "dm" ? "Open chat" : channel ? "Create channel" : "Create group"}
        </Button>
      </div>
    </form>
  );
}

/** "Add people" on a group (HR Admin and Super Admin): pick more people; they read new messages from the moment they are added. */
export function AddPeopleDialog({ conversationId, existing, onAdded, disabled = false }: { conversationId: string; existing: string[]; onAdded: () => void; disabled?: boolean }) {
  return (
    <FormDialog label="Add people" title="Add people" description="They can read new messages from now on, not what was said before." size="md" variant="outline" triggerSize="sm" disabled={disabled} hint={disabled ? "Loading the people in this group…" : undefined}>
      <AddPeopleForm conversationId={conversationId} existing={existing} onAdded={onAdded} />
    </FormDialog>
  );
}

function AddPeopleForm({ conversationId, existing, onAdded }: { conversationId: string; existing: string[]; onAdded: () => void }) {
  const dialog = useFormDialog();
  const [selected, setSelected] = useState<ChatPerson[]>([]);
  const [pending, startTransition] = useTransition();
  const room = MAX_GROUP - existing.length; // how many more fit (200 in total)
  const most = Math.min(MAX_ADD_AT_ONCE, room);
  const toggle = (person: ChatPerson) => setSelected((c) => (c.some((p) => p.userId === person.userId) ? c.filter((p) => p.userId !== person.userId) : c.length >= most ? c : [...c, person]));
  const addAll = (people: ChatPerson[]) =>
    setSelected((c) => {
      const have = new Set(c.map((p) => p.userId));
      return [...c, ...people.filter((p) => !have.has(p.userId))].slice(0, most);
    });

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
      <p className="text-xs text-muted-foreground">
        {room <= 0 ? "This group is full (200 people)." : `Room for ${room} more (200 at most). Up to ${MAX_ADD_AT_ONCE} at a time.`}
      </p>
      <PeoplePicker selected={selected} onToggle={toggle} onAddAll={addAll} hide={existing} />
      <div className="flex justify-end">
        <Button type="submit" disabled={selected.length === 0 || pending || room <= 0}>
          Add {selected.length > 0 ? selected.length : ""}
        </Button>
      </div>
    </form>
  );
}
