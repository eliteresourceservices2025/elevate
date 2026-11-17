"use client";

import { MessageSquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { listChatPins, loadChatMessages, loadConversationList, markConversationRead } from "../actions";
import type { ChatMessage, ConversationSummary, PinnedMessage } from "../queries";
import type { ChatSignal } from "../realtime-types";
import { ConversationList } from "./conversation-list";
import { RenameGroupDialog, useDeleteGroup, useRemovePerson } from "./group-admin";
import { AddPeopleDialog, NewConversationDialog } from "./new-conversation-dialog";
import { Thread, type ThreadMember } from "./thread";
import { ThreadPanel } from "./thread-panel";
import { useChatLive } from "./use-chat-live";

type ThreadData = { messages: ChatMessage[]; hasMore: boolean; members: ThreadMember[] };

/** Newest page from the server, keeping any older messages the person already scrolled back to. */
function mergeNewest(previous: ThreadData | null, next: ThreadData): ThreadData {
  if (!previous || next.messages.length === 0) return next;
  const firstNew = next.messages[0].seq;
  const older = previous.messages.filter((m) => m.seq < firstNew);
  return { messages: [...older, ...next.messages], hasMore: older.length > 0 ? previous.hasMore : next.hasMore, members: next.members };
}

export type { ThreadData };

export function MessagesView({ userId, timeZone, canManage, initialConversations, initialConversationId, initialThread }: { userId: string; timeZone: string; canManage: boolean; initialConversations: ConversationSummary[]; initialConversationId: string | null; initialThread: ThreadData | null }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId);
  const [thread, setThread] = useState<ThreadData | null>(initialThread);
  const [showDetails, setShowDetails] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [pins, setPins] = useState<PinnedMessage[]>([]);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [panelVersion, setPanelVersion] = useState(0);
  const request = useRef(0);
  const activeRef = useRef(initialConversationId);
  const listTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const router = useRouter();
  const lastUnreadTotal = useRef(initialConversations.reduce((sum, c) => sum + c.unread, 0));

  const refreshList = useCallback(async () => {
    const result = await loadConversationList();
    if (!result.ok) return;
    setConversations(result.data);
    // The header and menu counts come from the server render; when the total changes here (new message, or a chat just read), refresh them too.
    const total = result.data.reduce((sum, c) => sum + c.unread, 0);
    if (total !== lastUnreadTotal.current) {
      lastUnreadTotal.current = total;
      router.refresh();
    }
  }, [router]);

  const refreshListSoon = useCallback(() => {
    if (listTimer.current) clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => void refreshList(), 250);
  }, [refreshList]);

  const loadPins = useCallback(async (id: string) => {
    try {
      const result = await listChatPins({ conversationId: id });
      if (result.ok && activeRef.current === id) setPins(result.data);
    } catch {
      // The pinned bar is a nicety: the chat itself keeps working.
    }
  }, []);

  const loadThread = useCallback(async (id: string, reset: boolean) => {
    const mine = ++request.current;
    let result: Awaited<ReturnType<typeof loadChatMessages>>;
    try {
      result = await loadChatMessages({ conversationId: id });
    } catch {
      // A dropped connection must not leave "Loading messages…" on screen for good.
      result = { ok: false, error: "Could not reach ELEVATE. Check your connection and try again." };
    }
    if (mine !== request.current || activeRef.current !== id) return; // a newer request or another chat took over
    if (!result.ok) {
      setThreadError(result.error);
      setThread(null);
      return;
    }
    setThreadError(null);
    setThread((previous) => (reset ? result.data : mergeNewest(previous, result.data)));
    void loadPins(id);
  }, [loadPins]);

  // Opening a chat with unread messages marks it read up to the newest message.
  useEffect(() => {
    if (!activeId || !thread || thread.messages.length === 0) return;
    const summary = conversations.find((c) => c.id === activeId);
    if (!summary || summary.unread === 0) return;
    const newest = thread.messages[thread.messages.length - 1].seq;
    void markConversationRead({ conversationId: activeId, seq: newest }).then(() => refreshListSoon());
  }, [activeId, thread, conversations, refreshListSoon]);

  const onSignal = useCallback(
    (signal: ChatSignal) => {
      refreshListSoon();
      const active = activeRef.current;
      if (!active || signal.type === "read") return;
      if (signal.conversationId !== "" && signal.conversationId !== active) return;
      setPanelVersion((v) => v + 1); // an open thread reloads too
      if (signal.type === "delete" && signal.messageId) {
        // A removed message disappears at once, even one far back in an open history (the newest-page merge would never touch it).
        const removed = signal.messageId;
        setThread((previous) => (previous ? { ...previous, messages: previous.messages.map((m) => (m.id === removed ? { ...m, deleted: true, body: null } : m)) } : previous));
        return;
      }
      // An edit can be to a message anywhere in the history, so reload it from the newest page (the live list merge only fills in new messages).
      void loadThread(active, signal.type === "edit" || signal.type === "reaction" || signal.type === "pin");
    },
    [refreshListSoon, loadThread],
  );
  useChatLive(userId, onSignal);

  useEffect(
    () => () => {
      if (listTimer.current) clearTimeout(listTimer.current);
    },
    [],
  );

  function open(id: string) {
    activeRef.current = id;
    setShowDetails(false);
    setOpenRoot(null);
    setPins([]);
    setActiveId(id);
    setThread(null);
    setThreadError(null);
    void loadThread(id, true);
    window.history.replaceState(null, "", `/messages/${id}`);
  }

  function close() {
    activeRef.current = null;
    request.current += 1;
    setShowDetails(false);
    setOpenRoot(null);
    setPins([]);
    setActiveId(null);
    setThread(null);
    window.history.replaceState(null, "", "/messages");
  }

  async function opened(id: string) {
    await refreshList();
    open(id);
  }

  async function loadEarlier() {
    if (!activeId || !thread || thread.messages.length === 0) return;
    const id = activeId;
    setLoadingEarlier(true);
    try {
      const result = await loadChatMessages({ conversationId: id, beforeSeq: thread.messages[0].seq });
      if (activeRef.current !== id) return; // the person opened another chat meanwhile: these belong to the old one
      if (!result.ok) return void toast.error(result.error);
      setThread((previous) => (previous ? { messages: [...result.data.messages, ...previous.messages], hasMore: result.data.hasMore, members: previous.members } : previous));
    } catch {
      toast.error("Could not reach ELEVATE. Check your connection and try again.");
    } finally {
      setLoadingEarlier(false);
    }
  }

  // HR Admin / Super Admin controls (the server checks the right on every action).
  const removePerson = useRemovePerson((removedUserId) => {
    if (removedUserId === userId) close(); // they took themself out: the chat is no longer theirs
    else if (activeRef.current) void loadThread(activeRef.current, false);
    void refreshList();
  });
  const deleteGroup = useDeleteGroup(() => {
    close();
    void refreshList();
  });

  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-[calc(100dvh-13rem)] min-h-[34rem] overflow-hidden rounded-xl border bg-card">
      <div className={`w-full shrink-0 border-r md:block md:w-80 ${active ? "hidden" : "block"}`}>
        <ConversationList conversations={conversations} activeId={activeId} onOpen={open} newButton={<NewConversationDialog onOpened={(id) => void opened(id)} canCreateGroup={canManage} />} timeZone={timeZone} />
      </div>

      <div className={`min-w-0 flex-1 ${active ? (showDetails || openRoot ? "hidden md:block" : "block") : "hidden md:block"}`}>
        {active ? (
          threadError ? (
            <div className="p-4">
              <EmptyState icon={MessageSquare} title="This chat isn't available" description={threadError} action={<Button type="button" variant="outline" onClick={close}>Back to chats</Button>} />
            </div>
          ) : thread ? (
            <Thread
              conversation={active}
              messages={thread.messages}
              hasMore={thread.hasMore}
              members={thread.members}
              myUserId={userId}
              timeZone={timeZone}
              loadingEarlier={loadingEarlier}
              pins={pins}
              restricted={active.posting === "admins" && !canManage}
              onOpenThread={(rootId) => {
                setShowDetails(false);
                setOpenRoot(rootId);
              }}
              onLoadEarlier={() => void loadEarlier()}
              onBack={close}
              onChanged={() => {
                void loadThread(active.id, false);
                refreshListSoon();
              }}
              onToggleDetails={() => {
                setOpenRoot(null);
                setShowDetails((v) => !v);
              }}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground" role="status">
              Loading messages…
            </p>
          )
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={MessageSquare} title="Pick a chat" description="Choose a conversation on the left, or start a new message." className="border-0" />
          </div>
        )}
      </div>

      {active && openRoot && thread ? (
        <ThreadPanel
          key={openRoot}
          conversationId={active.id}
          conversationTitle={active.title}
          rootId={openRoot}
          members={thread.members}
          myUserId={userId}
          timeZone={timeZone}
          version={panelVersion}
          onClose={() => setOpenRoot(null)}
          onChanged={() => {
            void loadThread(active.id, false);
            refreshListSoon();
          }}
        />
      ) : null}

      {active && showDetails && !openRoot && thread ? (
        <aside aria-label="People in this chat" className="flex w-full shrink-0 flex-col gap-4 border-l p-4 md:w-64">
          <div className="flex items-center justify-between">
            <h3 className="font-heading text-base font-semibold">People</h3>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => setShowDetails(false)} aria-label="Close people list">
              <X aria-hidden />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{thread.members.length} {thread.members.length === 1 ? "person" : "people"}</p>
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-sm">
            {thread.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {m.name}
                  {m.userId === userId ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                {canManage && active.kind === "group" ? (
                  <Button type="button" variant="ghost" size="xs" onClick={() => void removePerson(active.id, m)} aria-label={`Remove ${m.name}`}>
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage && active.kind === "group" ? (
            <div className="mt-auto flex flex-col gap-2">
              <RenameGroupDialog conversationId={active.id} current={active.title} onDone={() => { void loadThread(active.id, false); void refreshList(); }} />
              <AddPeopleDialog conversationId={active.id} existing={thread.members.map((m) => m.userId)} onAdded={() => { void loadThread(active.id, false); void refreshList(); }} />
              <Button type="button" variant="outline" size="sm" onClick={() => void deleteGroup(active.id, active.title)}>
                Delete group
              </Button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
