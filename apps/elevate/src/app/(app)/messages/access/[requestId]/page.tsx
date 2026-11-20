import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { ForbiddenError } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { ActionFailure } from "@/lib/run-action";
import { myGrant, readGrantedChat } from "@/modules/chat-access/queries";

export const metadata: Metadata = { title: "Chat access" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Read-only view of what two administrators approved, for the person who asked. Every call re-checks the approval, the requester, the 72 hours
// and the dates; every opening is logged. No composer, no reactions, no files: names of attachments only. No loading.tsx (this route can call notFound()).
export default async function Page({ params, searchParams }: { params: Promise<{ requestId: string }>; searchParams: Promise<{ after?: string }> }) {
  await requireUser();
  const { requestId } = await params;
  if (!UUID.test(requestId)) notFound();
  const mine = await orNotFound(myGrant(requestId));
  if (!mine || !mine.open) notFound();
  const zone = DEFAULT_TIMEZONE;
  const stamp = (iso: string) => formatInZone(iso, zone, "MMM d, h:mm a");

  if (mine.kind === "recording") {
    return (
      <PageContainer width="wide">
        <PageHeader title="Recording" description={`${mine.title}. Read-only access until ${stamp(mine.accessExpiresAt ?? new Date().toISOString())}. Every play is logged.`} breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Chat access", href: "/messages/access" }, { label: "Recording" }]} />
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a call recording has no caption file */}
        <video controls preload="none" src={`/api/chat-access/${requestId}/recording`} className="aspect-video w-full max-w-4xl rounded-lg bg-black" />
      </PageContainer>
    );
  }

  const { after } = await searchParams;
  const afterSeq = after && /^\d{1,10}$/.test(after) ? Number(after) : undefined;
  // The 72 hours can end while the page is open: that is a not-found, not an error page.
  const chat = await readGrantedChat({ requestId, afterSeq }).catch((error) => {
    if (error instanceof ActionFailure || error instanceof ForbiddenError) notFound();
    throw error;
  });
  const last = chat.messages[chat.messages.length - 1];
  return (
    <PageContainer width="wide">
      <PageHeader
        title={chat.title}
        description={`Read-only. Messages from ${formatInZone(chat.windowFrom, zone, "MMM d, yyyy")} to ${formatInZone(new Date(new Date(chat.windowTo).getTime() - 1000).toISOString(), zone, "MMM d, yyyy")}. Access ends ${stamp(chat.accessExpiresAt)}.`}
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Chat access", href: "/messages/access" }, { label: chat.title }]}
      />
      <Alert variant="warning">
        <AlertDescription>Everything you open here is logged, and the people in this chat are told afterwards that it was read. Use it only for the reason you gave. Never copy messages elsewhere.</AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        {chat.members.length} {chat.members.length === 1 ? "person is" : "people are"} in this chat now: {chat.members.map((m) => m.name).join(", ")}.
      </p>
      {chat.messages.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No messages in these days.</p>
      ) : (
        <ol aria-label="Messages" className="flex max-w-4xl flex-col gap-3">
          {chat.messages.map((m) => (
            <li key={m.id} className="rounded-xl border bg-card p-3" data-testid="access-message">
              {m.kind === "system" ? (
                <p className="text-center text-xs text-muted-foreground">{m.body}</p>
              ) : (
                <>
                  <p className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-medium">{m.senderName}</span>
                    <span className="text-xs text-muted-foreground">{stamp(m.createdAt)}</span>
                    {m.threadRootId ? <span className="text-xs text-muted-foreground">reply</span> : null}
                    {m.edited && !m.deleted ? <span className="text-xs text-muted-foreground">edited</span> : null}
                  </p>
                  {m.deleted ? (
                    <p className="text-sm text-muted-foreground italic">Message removed</p>
                  ) : (
                    <>
                      {m.body ? <p className="text-sm break-words whitespace-pre-wrap">{m.body}</p> : null}
                      {m.attachments.length > 0 ? <p className="mt-1 text-xs text-muted-foreground">Attached (not shown here): {m.attachments.map((a) => a.name).join(", ")}</p> : null}
                      {m.kind !== "text" && m.kind !== "poll" && m.attachments.length === 0 && !m.body ? <p className="text-sm text-muted-foreground italic">A {m.kind} (not shown here)</p> : null}
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {chat.hasMore && last ? (
        <Link href={`/messages/access/${requestId}?after=${last.seq}`} className={buttonVariants({ variant: "outline" })}>
          Show the next messages
        </Link>
      ) : null}
    </PageContainer>
  );
}
