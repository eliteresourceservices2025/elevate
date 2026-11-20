"use client";

import { Pencil } from "lucide-react";
import { useState, useTransition } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteGroupChat, removeGroupMember, renameGroupChat } from "../actions";
import { MAX_TITLE } from "../validators";

// The group controls for HR Admins and Super Admins (the server checks the right on every action; hiding a button is never the guard).

/** Rename a group. */
export function RenameGroupDialog({ conversationId, current, onDone }: { conversationId: string; current: string; onDone: () => void }) {
  return (
    <FormDialog label="Rename" title="Rename group" description="Everyone in the group is told the new name." size="md" variant="outline" triggerSize="sm" icon={<Pencil aria-hidden />}>
      <RenameForm conversationId={conversationId} current={current} onDone={onDone} />
    </FormDialog>
  );
}

function RenameForm({ conversationId, current, onDone }: { conversationId: string; current: string; onDone: () => void }) {
  const dialog = useFormDialog();
  const [title, setTitle] = useState(current);
  const [pending, startTransition] = useTransition();
  const ready = title.trim().length > 0 && title.trim() !== current;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || pending) return;
        startTransition(async () => {
          const result = await renameGroupChat({ conversationId, title });
          if (!result.ok) return void toast.error(result.error);
          await dialog?.close(true);
          onDone();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`rename-${conversationId}`} className="text-sm font-medium">
          Group name
        </label>
        <Input id={`rename-${conversationId}`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={MAX_TITLE} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || pending}>
          Save name
        </Button>
      </div>
    </form>
  );
}

/** Asks first, then takes the person out of the group (they lose all access at once). */
export function useRemovePerson(onDone: (removedUserId: string) => void) {
  const confirm = useConfirm();
  return async (conversationId: string, person: { userId: string; name: string }) => {
    const ok = await confirm({ title: `Remove ${person.name}?`, description: "They lose access to this group at once. They can be added back later by an HR Admin or Super Admin, and then see only new messages.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    const result = await removeGroupMember({ conversationId, userId: person.userId });
    if (!result.ok) return void toast.error(result.error);
    onDone(person.userId);
  };
}

/** Asks first, then deletes (archives) the group for everyone. */
export function useDeleteGroup(onDone: () => void) {
  const confirm = useConfirm();
  return async (conversationId: string, title: string) => {
    const ok = await confirm({
      title: `Delete ${title}?`,
      description: "The group disappears for everyone and nobody can read or send in it. The messages are kept, encrypted, until the retention period ends.",
      confirmLabel: "Delete group",
      destructive: true,
    });
    if (!ok) return;
    const result = await deleteGroupChat({ conversationId });
    if (!result.ok) return void toast.error(result.error);
    onDone();
  };
}
