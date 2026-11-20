"use client";

import { BarChart3, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog, useFormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createChatPoll } from "../actions";
import { MAX_POLL_OPTIONS } from "../validators";

/** A button in the message box that opens the poll form. */
export function PollDialog({ conversationId, onCreated }: { conversationId: string; onCreated: () => void }) {
  return (
    <FormDialog label="Poll" title="Create a poll" description="Ask the group a quick question. Everyone in the chat can vote." size="md" variant="outline" triggerSize="sm" icon={<BarChart3 aria-hidden />}>
      <PollForm conversationId={conversationId} onCreated={onCreated} />
    </FormDialog>
  );
}

function PollForm({ conversationId, onCreated }: { conversationId: string; onCreated: () => void }) {
  const dialog = useFormDialog();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [pending, startTransition] = useTransition();
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2 && new Set(filled.map((o) => o.toLowerCase())).size === filled.length;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || pending) return;
        startTransition(async () => {
          const result = await createChatPoll({ conversationId, question, options: filled, multiple, anonymous });
          if (!result.ok) return void toast.error(result.error);
          await dialog?.close(true);
          onCreated();
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="poll-question" className="text-sm font-medium">
          Question
        </label>
        <Input id="poll-question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} placeholder="For example, which time works for Friday's huddle?" />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Options (2 to {MAX_POLL_OPTIONS})</legend>
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <label htmlFor={`poll-option-${i}`} className="sr-only">
              Option {i + 1}
            </label>
            <Input id={`poll-option-${i}`} value={o} onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))} maxLength={100} placeholder={`Option ${i + 1}`} />
            {options.length > 2 ? (
              <Button type="button" variant="ghost" size="icon" onClick={() => setOptions((list) => list.filter((_, j) => j !== i))} aria-label={`Remove option ${i + 1}`}>
                <X aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {options.length < MAX_POLL_OPTIONS ? (
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setOptions((list) => [...list, ""])}>
            <Plus aria-hidden /> Add option
          </Button>
        ) : null}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="size-4" /> People can pick more than one option
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="size-4" /> Anonymous (show counts only, never who voted)
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={!ready || pending}>
          Post poll
        </Button>
      </div>
    </form>
  );
}
