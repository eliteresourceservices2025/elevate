import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pin } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DownloadButton } from "@/modules/documents/components/document-list";
import { AckedBadge, DueBadge, StatusTable } from "@/modules/announcements/components/ack-display";
import { AcknowledgeButton, ArchiveAnnouncementButton, StatusActions } from "@/modules/announcements/components/ack-controls";
import { getAckStatus, getAnnouncement } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Announcement" };

export default async function AnnouncementPage({ params }: PageProps<"/announcements/[id]">) {
  const { id } = await params;
  const a = await orNotFound(getAnnouncement(id));
  if (!a) notFound();
  const today = todayInZone();
  const status = a.canSeeStatus ? await orNotFound(getAckStatus({ kind: "announcement", id: a.id })) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/announcements" className="text-sm text-primary underline-offset-4 hover:underline">
          All announcements
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {a.pinned ? <Pin className="size-5 text-primary" aria-label="Pinned" /> : null}
          <h1 className="text-2xl font-bold">{a.title}</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Posted {formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}
          {a.audience === "teams" ? ` for ${a.teamNames.join(", ")}` : ""}
        </p>
      </div>

      <article className="rounded-xl border bg-card p-5">
        <Markdown source={a.body} />
        {a.attachment ? (
          <div className="mt-4 flex items-center gap-2 border-t pt-3 text-sm">
            <span className="font-medium">Attachment:</span> {a.attachment.title}
            <DownloadButton documentId={a.attachment.id} label={a.attachment.title} />
          </div>
        ) : null}
      </article>

      {a.requiresAck ? (
        <section aria-label="Acknowledgment" className="space-y-3 rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Acknowledgment</h2>
            {a.needsMyAck ? <DueBadge due={a.due} dueOn={a.dueOn} today={today} /> : null}
            {a.acknowledgedAt ? <AckedBadge at={a.acknowledgedAt} /> : null}
          </div>
          {a.needsMyAck ? (
            <>
              <p className="text-sm text-muted-foreground">Confirming records your name, this announcement and the time. Nothing else.</p>
              <AcknowledgeButton subject={{ kind: "announcement", id: a.id }} />
            </>
          ) : a.acknowledgedAt ? (
            <p className="text-sm text-muted-foreground">You acknowledged this on {formatInZone(a.acknowledgedAt, DEFAULT_TIMEZONE, "MMM d, yyyy 'at' h:mm a")}.</p>
          ) : (
            <p className="text-sm text-muted-foreground">This was not addressed to you, so you do not need to acknowledge it.</p>
          )}
        </section>
      ) : null}

      {a.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`/announcements/${a.id}/edit`} className={buttonVariants({ variant: "outline" })}>
            Edit
          </Link>
          <ArchiveAnnouncementButton announcementId={a.id} title={a.title} />
        </div>
      ) : null}

      {status ? (
        <section aria-label="Who has acknowledged" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              Who has acknowledged {status.scope === "team" ? <Badge variant="outline" className="ml-2">Your team</Badge> : null}
            </h2>
            <StatusActions
              subject={{ kind: "announcement", id: a.id }}
              canRemind={a.canRemind}
              canExport={a.canExport}
              pendingCount={status.rows.filter((r) => !r.acknowledgedAt && r.hasAccount).length}
            />
          </div>
          <StatusTable rows={status.rows} />
        </section>
      ) : null}
    </div>
  );
}
