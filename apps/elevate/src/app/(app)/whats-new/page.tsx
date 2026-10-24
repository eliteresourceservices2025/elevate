import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { APP_VERSION, RELEASES } from "@/lib/releases";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";

export const metadata: Metadata = { title: "What's new" };

export default async function WhatsNewPage() {
  await requireUser();
  return (
    <PageContainer width="medium">
      <PageHeader title="What's new" description={`You are using ELEVATE ${APP_VERSION}. Every release is listed here, newest first. We call it version 1.0 once everyone has been invited.`} />
      <ol className="space-y-4">
        {RELEASES.map((r) => (
          <li key={r.version}>
            <article aria-label={`Version ${r.version}`} className="space-y-2 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{r.title}</h2>
                <Badge variant={r.version === APP_VERSION ? "default" : "secondary"}>Version {r.version}</Badge>
                <span className="text-sm text-muted-foreground">{formatInZone(new Date(`${r.date}T12:00:00Z`), DEFAULT_TIMEZONE, "MMM d, yyyy")}</span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {r.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              {r.announcementId ? (
                <Link href={`/announcements/${r.announcementId}`} className="inline-block text-sm text-primary underline-offset-4 hover:underline">
                  Watch the video and read the announcement
                </Link>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
    </PageContainer>
  );
}
