"use client";

import { BellOff, Hash, MessageSquare, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ChatSettingsDialog } from "./chat-settings-dialogs";
import { MessageSearch } from "./message-search";
import type { ConversationSummary } from "../queries";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

/** "9:10 AM" today, "Mon" this week, "Nov 14" otherwise, in the viewer's time zone. */
export function shortTime(iso: string | null, zone: string, now = new Date()): string {
  if (!iso) return "";
  const day = formatInZone(iso, zone, "yyyy-MM-dd");
  if (day === formatInZone(now, zone, "yyyy-MM-dd")) return formatInZone(iso, zone, "h:mm a");
  const ageDays = (now.getTime() - new Date(iso).getTime()) / 86_400_000;
  return ageDays < 6 ? formatInZone(iso, zone, "EEE") : formatInZone(iso, zone, "MMM d");
}

export function ConversationAvatar({ conversation, size = "default" }: { conversation: Pick<ConversationSummary, "kind" | "title" | "photoUserId">; size?: "default" | "lg" | "sm" }) {
  return (
    <Avatar size={size}>
      {conversation.photoUserId ? <AvatarImage src={`/api/profile-photo/${conversation.photoUserId}`} alt="" /> : null}
      <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
        {conversation.kind === "group" || conversation.kind === "client" ? <Users className="size-4" aria-hidden /> : conversation.kind === "dm" ? initials(conversation.title) : <Hash className="size-4" aria-hidden />}
      </AvatarFallback>
    </Avatar>
  );
}

type Filter = "all" | "unread" | "chats" | "channels";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "chats", label: "Chats" },
  { key: "channels", label: "Channels" },
];
const isChannel = (c: ConversationSummary) => c.kind === "team" || c.kind === "department" || c.kind === "company";

export function ConversationList({
  conversations,
  activeId,
  onOpen,
  newButton,
  timeZone,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  newButton?: ReactNode;
  timeZone: string;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = conversations.filter((c) => (filter === "unread" ? c.unread > 0 : filter === "chats" ? !isChannel(c) : filter === "channels" ? isChannel(c) : true));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="font-heading text-base font-semibold">Chats</h2>
        <div className="flex items-center gap-1.5">
          <ChatSettingsDialog />
          {newButton}
        </div>
      </div>
      <MessageSearch onOpen={onOpen} timeZone={timeZone}>
      <>
      <div className="flex gap-1 border-b px-3 py-2" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", filter === f.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {f.label}
          </button>
        ))}
      </div>
      {conversations.length === 0 ? (
        <div className="p-3">
          <EmptyState icon={MessageSquare} title="No messages yet" description="Start a message with someone on your team." />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Your conversations">
          {shown.length === 0 ? <li className="p-4 text-center text-sm text-muted-foreground">Nothing here.</li> : null}
          {shown.map((c) => {
            const active = c.id === activeId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpen(c.id)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "bg-secondary shadow-[inset_3px_0_0_var(--primary)]",
                  )}
                >
                  <ConversationAvatar conversation={c} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("truncate text-sm", c.unread > 0 && !c.mutedUntil ? "font-semibold" : "font-medium")}>{c.title}</span>
                      {c.mutedUntil ? <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Muted" /> : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{shortTime(c.lastAt, timeZone)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={cn("truncate text-xs", c.unread > 0 ? "text-foreground" : "text-muted-foreground")}>{c.lastPreview ?? "No messages yet"}</span>
                      {c.unread > 0 ? (
                        <span className={cn("ml-auto shrink-0 rounded-full px-1.5 text-xs font-semibold", c.mutedUntil ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground")} aria-label={`${c.unread} unread`}>
                          {c.unread > 99 ? "99+" : c.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      </>
      </MessageSearch>
    </div>
  );
}
