import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { listMyConversations, loadMessages } from "../queries";
import { getChatSettings } from "../settings";
import { MessagesView } from "./messages-view";

/** The Messages page, with one chat open when `conversationId` is given. A chat that is not in the person's own list is a 404. */
export async function MessagesPage({ conversationId = null }: { conversationId?: string | null }) {
  const user = await requireUser({ allowGuest: true });
  const canManage = can(user, "messages.manage_group");
  const conversations = await orNotFound(listMyConversations());
  const settings = await orNotFound(getChatSettings());
  if (conversationId && !conversations.some((c) => c.id === conversationId)) notFound();
  let initialThread = null;
  if (conversationId) {
    try {
      const { messages, hasMore, latestSeq, members } = await orNotFound(loadMessages({ conversationId }));
      initialThread = { messages, hasMore, latestSeq, members };
    } catch (error) {
      if (error instanceof ActionFailure) notFound();
      throw error;
    }
  }
  return (
    <PageContainer width="canvas">
      <PageHeader
        title="Messages"
        description={user.isGuest ? "The chats you were added to." : "Chat with your team and groups."}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/messages/guests" className={buttonVariants({ variant: "outline" })}>
                Client guests
              </Link>
              <Link href="/messages/manage" className={buttonVariants({ variant: "outline" })}>
                Manage groups
              </Link>
            </div>
          ) : undefined
        }
      />
      <MessagesView userId={user.id} timeZone={DEFAULT_TIMEZONE} canManage={canManage} isGuest={Boolean(user.isGuest)} appearOffline={settings.appearOffline} initialConversations={conversations} initialConversationId={conversationId} initialThread={initialThread} />
    </PageContainer>
  );
}
