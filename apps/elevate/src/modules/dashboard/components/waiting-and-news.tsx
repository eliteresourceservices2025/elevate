import Link from "next/link";
import { Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { DueBadge } from "@/modules/announcements/components/ack-display";
import { listAnnouncements, listMyPending } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";
import { cn } from "@/lib/utils";
import { guarded } from "./guard";
import { Panel, PanelList, ROW_LINK } from "./panel";

/** Policies and announcements that wait for this person's acknowledgment. */
export async function WaitingForYou() {
  return guarded("Waiting for you", async () => {
    const pending = await listMyPending();
    if (pending.length === 0) return null;
    const today = todayInZone();
    return (
      <Panel label="Waiting for you" title="Waiting for you" count={pending.length}>
        {/* Nothing waiting is ever hidden: a long list scrolls inside its own box so it cannot push the rest of the page away. */}
        <PanelList className="max-h-[26rem] overflow-y-auto" tabIndex={pending.length > 5 ? 0 : undefined} aria-label={pending.length > 5 ? "Everything waiting for you (scrolls)" : undefined}>
          {pending.map((p) => (
            <li key={`${p.kind}-${p.versionId ?? p.id}`}>
              <Link href={p.link} className={cn(ROW_LINK, "flex-wrap items-center gap-2")}>
                <span className="font-medium">{p.title}</span>
                <Badge variant="outline">{p.kind === "policy" ? `Policy, version ${p.version}` : "Announcement"}</Badge>
                <DueBadge due={p.due} dueOn={p.dueOn} today={today} />
              </Link>
            </li>
          ))}
        </PanelList>
      </Panel>
    );
  });
}

export async function LatestAnnouncements() {
  return guarded("Latest announcements", async () => {
    const latest = await listAnnouncements({ limit: 3 });
    if (latest.length === 0) return null;
    return (
      <Panel label="Latest announcements" title="Latest announcements" href="/announcements">
        <PanelList>
          {latest.map((a) => (
            <li key={a.id}>
              <Link href={`/announcements/${a.id}`} className={cn(ROW_LINK, "flex-col gap-0.5")}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {a.pinned ? <Pin className="size-4 text-primary" aria-label="Pinned" /> : null}
                  {a.title}
                </span>
                <span className="text-xs text-muted-foreground">{formatInZone(a.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</span>
              </Link>
            </li>
          ))}
        </PanelList>
      </Panel>
    );
  });
}
