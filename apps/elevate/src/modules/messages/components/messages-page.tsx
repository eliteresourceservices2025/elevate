import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { ActionFailure } from "@/lib/run-action";
import { listMyConversations, loadMessages } from "../queries";
import { MessagesView } from "./messages-view";

/** The Messages page, with one chat open when `conversationId` is given. A chat that is not in the person's own list is a 404. */
export async function MessagesPage({ conversationId = null }: { conversationId?: string | null }) {
  const user = await requireUser();
  const conversations = await orNotFound(listMyConversations());
  if (conversationId && !conversations.some((c) => c.id === conversationId)) notFound();
  let initialThread = null;
  if (conversationId) {
    try {
      const { messages, hasMore, members } = await orNotFound(loadMessages({ conversationId }));
      initialThread = { messages, hasMore, members };
    } catch (error) {
      if (error instanceof ActionFailure) notFound();
      throw error;
    }
  }
  return (
    <PageContainer width="canvas">
      <PageHeader title="Messages" description="Chat with your team and groups." />
      <MessagesView userId={user.id} timeZone={DEFAULT_TIMEZONE} initialConversations={conversations} initialConversationId={conversationId} initialThread={initialThread} />
    </PageContainer>
  );
}
