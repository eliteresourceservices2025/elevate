"use client";

import { BarChart3 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { cn } from "@/lib/utils";
import { voteChatPoll } from "../actions";
import type { PollView } from "../queries";

/** A poll in the chat: the question, each option with its share of the votes, and a button to vote (or take the vote back). */
export function PollCard({ messageId, question, poll, onChanged }: { messageId: string; question: string; poll: PollView; onChanged: () => void }) {
  const [pending, startTransition] = useTransition();
  const total = poll.options.reduce((sum, o) => sum + o.count, 0);

  function vote(optionId: string) {
    startTransition(async () => {
      const result = await voteChatPoll({ messageId, optionId });
      if (!result.ok) return void toast.error(result.error);
      onChanged();
    });
  }

  return (
    <div className="flex w-80 max-w-full flex-col gap-2 rounded-xl border bg-card p-3 text-card-foreground" role="group" aria-label={`Poll: ${question}`}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        <BarChart3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="break-words">{question}</span>
      </p>
      <ul className="flex flex-col gap-1.5">
        {poll.options.map((o) => {
          const pct = total > 0 ? Math.round((o.count / total) * 100) : 0;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => vote(o.id)}
                disabled={pending}
                aria-pressed={o.mine}
                title={o.voters && o.voters.length > 0 ? o.voters.join(", ") : undefined}
                className={cn("relative flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50", o.mine ? "border-primary" : "hover:bg-muted")}
              >
                <span className="absolute inset-y-0 left-0 bg-secondary" style={{ width: `${pct}%` }} aria-hidden />
                <span className="relative min-w-0 flex-1 truncate">{o.label}{o.mine ? " ✓" : ""}</span>
                <span className="relative shrink-0 font-semibold">{o.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {poll.totalVoters} {poll.totalVoters === 1 ? "person" : "people"} voted · {poll.multiple ? "pick any" : "pick one"} · {poll.anonymous ? "anonymous" : "names shown on hover"}
      </p>
    </div>
  );
}
